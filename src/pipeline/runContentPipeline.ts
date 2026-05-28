/**
 * Main Content Generation Pipeline
 *
 * Orchestrates: normalize → genie context → strategy → calendar → posts → save
 * Entry point: called from server.ts routes.
 */

import { ContentInput, ContentOutput, FestivalEvent } from '../types/content';
import { normalizeInput } from '../services/normalizeInput';
import { generateStrategy } from '../services/generateStrategy';
import { generateCalendar } from '../services/generateCalendar';
import { generatePosts } from '../services/generatePosts';
import { fetchGenieContext } from '../services/genieContext';
import {
  savePostsToDB,
  saveStrategyToDB,
  saveCalendarToDB,
} from '../db/database';
import { createLogger } from '../utils/logger';
import prisma from '../lib/prisma';
import { CampaignPipelineOrchestrator } from './orchestrator';

const logger = createLogger({ service: 'content-pipeline' });



export async function runContentPipeline(
  input: ContentInput,
  campaignId?: string,
  funnelId?: string
): Promise<ContentOutput> {
  try {
    // ── Upgraded Path: Use Resumable Staged State Machine Orchestrator ───────
    if (campaignId) {
      logger.info(`Running pipeline via Staged State Machine Orchestrator for campaign: ${campaignId}`);

      let run = await prisma.pipelineRun.findUnique({
        where: { campaignId }
      });

      if (!run) {
        // Ingest Genie Scrape funnel ID snapshot
        const enrichedInput = { ...input, funnelId };
        run = await CampaignPipelineOrchestrator.initializeRun(campaignId, enrichedInput);
      }

      // Synchronously execute run stages with automatic retries and overrides support
      await CampaignPipelineOrchestrator.executeRun(run.id);

      // Verify execution succeeded by checking final status
      const updatedRun = await prisma.pipelineRun.findUniqueOrThrow({
        where: { id: run.id },
        include: { stages: true }
      });

      if (updatedRun.status === 'FAILED') {
        const failedStage = updatedRun.stages.find(s => s.status === 'FAILED');
        throw new Error(`Orchestrator stage failed: ${failedStage?.stageName || 'Unknown'} - ${failedStage?.errorMessage || 'Execution error'}`);
      }

      // Load generated stage outputs from the database
      const strategy = updatedRun.stages.find(s => s.stageName === 'campaignStrategy')?.outputJson as any;
      const calendar = updatedRun.stages.find(s => s.stageName === 'generateCalendar')?.outputJson as any;
      const posts = updatedRun.stages.find(s => s.stageName === 'generatePosts')?.outputJson as any;

      if (!strategy || !calendar || !posts) {
        throw new Error('Completed pipeline run was missing required stage output records.');
      }

      return { strategy, calendar, posts };
    }

    // ── Fallback Path: Legacy Sequential black-box workflow (if no campaignId) ───
    logger.info('Running legacy sequential content generation pipeline (No campaign ID)');

    let websiteContext: string | undefined;
    let enrichedInput = input;
    if (funnelId) {
      const genieCtx = await fetchGenieContext(funnelId);
      if (genieCtx) {
        if (genieCtx.websiteSummary) {
          websiteContext = genieCtx.websiteSummary;
          logger.info('Got website context from genie', { chars: String(websiteContext.length) });
        }
        enrichedInput = {
          ...input,
          industry: input.industry?.trim() || genieCtx.industry || 'General Business',
          geography: input.geography?.trim() || genieCtx.geography || 'India',
          services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
        };
      }
    }

    const normalizedInput = normalizeInput(enrichedInput);
    const strategy = await generateStrategy(normalizedInput, websiteContext);
    
    let festivals: FestivalEvent[] = [];
    if (normalizedInput.festival_enabled) {
      try {
        const { getFestivalsForDateRange, getCountryCode } = await import('../services/festivalApi');
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + normalizedInput.total_days);
        festivals = await getFestivalsForDateRange(
          startDate,
          endDate,
          getCountryCode(normalizedInput.geography)
        );
      } catch (err: any) {
        logger.error(`Festival fetch failed: ${err.message}`);
      }
    }

    const calendar = await generateCalendar(normalizedInput, strategy, festivals);
    
    const allPosts: any[] = [];
    const hasAssignedPlatforms = calendar && calendar.length > 0 && calendar.every(item => item.platform);

    if (hasAssignedPlatforms) {
      const platformGroups: Record<string, any[]> = {};
      for (const item of calendar) {
        const plat = item.platform!;
        if (!platformGroups[plat]) platformGroups[plat] = [];
        platformGroups[plat].push(item);
      }

      for (const [plat, items] of Object.entries(platformGroups)) {
        logger.info(`Generating legacy platform-specific posts for: ${plat} (${items.length} posts)`);
        const platformInput = { ...normalizedInput, platform: plat };
        const platformPosts = await generatePosts(items, platformInput, strategy, websiteContext);
        allPosts.push(...platformPosts.map(p => ({ ...p, platform: plat })));
      }
    } else {
      const platforms = normalizedInput.platforms || [normalizedInput.platform || 'instagram'];
      for (const plat of platforms) {
        const platformInput = { ...normalizedInput, platform: plat };
        const platformPosts = await generatePosts(calendar, platformInput, strategy, websiteContext);
        allPosts.push(...platformPosts.map(p => ({ ...p, platform: plat })));
      }
    }

    return { strategy, calendar, posts: allPosts };

  } catch (error: any) {
    throw new Error(
      `Pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
