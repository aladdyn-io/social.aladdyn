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

const logger = createLogger({ service: 'content-pipeline' });

function getCountryCode(geography: string): string {
  const mapping: Record<string, string> = {
    india: 'IN',
    'united states': 'US',
    usa: 'US',
    uk: 'GB',
    'united kingdom': 'GB',
    canada: 'CA',
    australia: 'AU',
    singapore: 'SG',
    uae: 'AE',
  };
  return mapping[geography.toLowerCase()] || 'IN';
}

export async function runContentPipeline(
  input: ContentInput,
  campaignId?: string,
  funnelId?: string
): Promise<ContentOutput> {
  try {
    // ── Step 1: Fetch Genie Context (website knowledge + business profile) ───
    let websiteContext: string | undefined;
    let enrichedInput = input;
    if (funnelId) {
      const genieCtx = await fetchGenieContext(funnelId);
      if (genieCtx) {
        if (genieCtx.websiteSummary) {
          websiteContext = genieCtx.websiteSummary;
          logger.info('Got website context from genie', { chars: String(websiteContext.length) });
        }
        // Auto-populate missing input fields from scraped data
        enrichedInput = {
          ...input,
          industry: input.industry?.trim() || genieCtx.industry || 'General Business',
          geography: input.geography?.trim() || genieCtx.geography || 'India',
          services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
        };
        logger.info('Enriched input', { industry: enrichedInput.industry ?? '', geography: enrichedInput.geography ?? '' });
      } else {
        logger.info('No genie context available — using input data only');
        enrichedInput = {
          ...input,
          industry: input.industry?.trim() || 'General Business',
          geography: input.geography?.trim() || 'India',
          services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
        };
      }
    } else {
      // No funnelId — still apply fallbacks so normalizeInput doesn't throw
      enrichedInput = {
        ...input,
        industry: input.industry?.trim() || 'General Business',
        geography: input.geography?.trim() || 'India',
        services: (input.services?.length ?? 0) > 0 ? input.services : ['Our Services'],
      };
    }

    // ── Step 2: Normalize ────────────────────────────────────────────────────
    const normalizedInput = normalizeInput(enrichedInput);

    // ── Step 3: Generate Strategy ─────────────────────────────────────────────
    const strategy = await generateStrategy(normalizedInput, websiteContext);

    let strategyId: string | undefined;
    if (campaignId) {
      try {
        strategyId = await saveStrategyToDB(campaignId, strategy);
        logger.info('Strategy saved', { strategyId });
      } catch (err) {
        logger.error('Failed to save strategy (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Step 4: Fetch Festivals ──────────────────────────────────────────────
    let festivals: FestivalEvent[] = [];
    if (normalizedInput.festival_enabled) {
      try {
        const { getFestivalsForDateRange } = await import('../services/festivalApi');
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + normalizedInput.total_days);
        festivals = await getFestivalsForDateRange(
          startDate,
          endDate,
          getCountryCode(normalizedInput.geography)
        );
        logger.info('Loaded festivals', { count: String(festivals.length) });
      } catch (err) {
        logger.error('Festival fetch failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Step 5: Generate Calendar ────────────────────────────────────────────
    const calendar = await generateCalendar(normalizedInput, strategy, festivals, campaignId);

    if (campaignId && strategyId) {
      try {
        await saveCalendarToDB(campaignId, strategyId, calendar);
        logger.info('Calendar saved', { entries: String(calendar.length) });
      } catch (err) {
        logger.error('Failed to save calendar (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Step 6: Generate Posts (captions + image prompts) ────────────────────
    // Determine all platforms — multi-platform campaigns generate a post set per platform
    const campaignPlatforms = enrichedInput.platforms;
    const platformsToGenerate =
      campaignPlatforms && campaignPlatforms.length > 1
        ? campaignPlatforms
        : [normalizedInput.platform];

    const postingTimes = (enrichedInput as any).postingTimes as
      | Record<string, string[]>
      | null
      | undefined;

    let allPosts = [] as typeof posts;
    // Declare posts outside the loop so TypeScript is happy
    let posts: Awaited<ReturnType<typeof generatePosts>> = [];

    for (const platform of platformsToGenerate) {
      logger.info('Generating posts for platform', { platform });
      const platformInput = { ...normalizedInput, platform };
      const platformPosts = await generatePosts(
        calendar,
        platformInput,
        strategy,
        websiteContext
      );

      // ── Step 7: Save Posts ─────────────────────────────────────────────────
      if (campaignId) {
        try {
          const platformTime =
            postingTimes?.[platform]?.[0] ?? normalizedInput.scheduledTime;
          const savedIds = await savePostsToDB(
            campaignId,
            platformPosts,
            platform,
            platformTime,
            normalizedInput.timezone
          );
          logger.info('Posts saved', {
            count: String(savedIds.length),
            platform,
          });
        } catch (err) {
          logger.error('Failed to save posts (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
            platform,
          });
        }
      }

      allPosts = allPosts.concat(platformPosts);
    }

    posts = allPosts;

    return { strategy, calendar, posts };
  } catch (error) {
    throw new Error(
      `Pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
