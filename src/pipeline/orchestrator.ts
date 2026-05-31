import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'campaign-orchestrator' });

/**
 * Sequential execution order of the upgraded campaign content pipeline stages
 * mapped directly to the modular services in the social.aladdyn ecosystem.
 */
export const STAGE_ORDER = [
  'genieContext',
  'normalizeInput',
  'brandIntelligence',
  'audiencePersona',
  'platformStrategy',
  'campaignStrategy',
  'generateCalendar',
  'generatePosts'
];

export class CampaignPipelineOrchestrator {
  /**
   * Initializes a pipeline run in the database with all stages pending.
   * Atomically wrapped in a transaction to satisfy the DB write guard guidelines.
   * 
   * @param campaignId - String ID matching the target SocialCampaign.id
   * @param brandInput - The raw content input payload submitted by the user
   */
  static async initializeRun(campaignId: string, brandInput: any) {
    logger.info(`Initializing pipeline run tracking records for campaign: ${campaignId}`);

    return await prisma.$transaction(async (tx) => {
      // 1. Check if a pipeline run already exists for this campaign and delete it
      await tx.pipelineRun.deleteMany({ where: { campaignId } });

      // 2. Create the primary PipelineRun row mapped to 'social.pipeline_runs'
      const run = await tx.pipelineRun.create({
        data: {
          campaignId,
          status: 'PENDING',
          brandInput: brandInput as any,
        }
      });

      // 3. Prepare list of stage tracking rows mapped to 'social.pipeline_stage_outputs'
      const stageData = STAGE_ORDER.map(stageName => ({
        runId: run.id,
        stageName,
        status: 'PENDING' as const,
      }));

      // 4. Atomically insert all stage outputs in bulk
      await tx.pipelineStageOutput.createMany({ data: stageData });

      logger.info(`✓ Successfully initialized run ${run.id} with ${stageData.length} pending stages.`);
      return run;
    });
  }

  /**
   * Executes or resumes a campaign pipeline execution from the first pending/failed stage.
   * Runs as a background task.
   * 
   * @param runId - String UUID of the PipelineRun to execute
   */
  static async executeRun(runId: string): Promise<void> {
    logger.info(`Executing pipeline run loop for: ${runId}`);

    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: { stages: true }
    });

    if (!run) {
      throw new Error(`Pipeline run not found: ${runId}`);
    }

    if (run.status === 'RUNNING') {
      logger.warn(`Pipeline run ${runId} is already executing. Ignoring launch request.`);
      return;
    }

    // Update execution status of the run to RUNNING
    await prisma.pipelineRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() }
    });

    // Order stages in chronological STAGE_ORDER sequence
    const sortedStages = STAGE_ORDER.map(
      name => run.stages.find(s => s.stageName === name)!
    );

    try {
      for (const stage of sortedStages) {
        if (stage.status === 'COMPLETED' || stage.status === 'OVERRIDDEN') {
          logger.info(`Stage '${stage.stageName}' is already ${stage.status}. Skipping.`);
          continue;
        }

        // Execute the stage with exponential backoff and maximum 3 attempts
        await this.executeStageWithRetry(runId, stage.stageName);
      }

      // Mark the entire run completed
      await prisma.pipelineRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date() }
      });

      // Update campaigns status to READY
      await prisma.socialCampaign.update({
        where: { id: run.campaignId },
        data: { status: 'READY' }
      });

      logger.info(`✓ Pipeline run ${runId} execution completed successfully.`);

    } catch (error: any) {
      logger.error(`✗ Pipeline run ${runId} aborted due to critical error: ${error.message}`);
      
      await prisma.pipelineRun.update({
        where: { id: runId },
        data: { status: 'FAILED' }
      });

      await prisma.socialCampaign.update({
        where: { id: run.campaignId },
        data: { status: 'FAILED' }
      });
    }
  }

  /**
   * Core retry loop implementing exponential backoff.
   */
  private static async executeStageWithRetry(runId: string, stageName: string): Promise<void> {
    let attempt = 0;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt++;
      logger.info(`Starting stage '${stageName}' | Attempt ${attempt}/${maxAttempts}`);

      await prisma.pipelineStageOutput.update({
        where: { runId_stageName: { runId, stageName } },
        data: { status: 'RUNNING', attemptCount: attempt }
      });

      try {
        const outputJson = await this.runStageLogic(runId, stageName);

        // Update stage record with generated payload
        await prisma.pipelineStageOutput.update({
          where: { runId_stageName: { runId, stageName } },
          data: {
            status: 'COMPLETED',
            outputJson: outputJson as any,
            errorMessage: null,
            completedAt: new Date()
          }
        });

        logger.info(`✓ Stage '${stageName}' completed successfully.`);
        return;

      } catch (error: any) {
        logger.error(`Error in stage '${stageName}' (attempt ${attempt}): ${error.message}`);

        if (attempt >= maxAttempts) {
          // Terminal failure
          await prisma.pipelineStageOutput.update({
            where: { runId_stageName: { runId, stageName } },
            data: { status: 'FAILED', errorMessage: error.message }
          });
          throw error;
        }

        // Exponential backoff delay (1s, 2s, 4s)
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        logger.info(`Waiting ${delayMs}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Resolves inputs and calls the respective campaign pipeline modular service logic.
   */
  private static async runStageLogic(runId: string, stageName: string): Promise<any> {
    const run = await prisma.pipelineRun.findUniqueOrThrow({
      where: { id: runId },
      include: { stages: true }
    });

    const inputs = run.brandInput as any;

    switch (stageName) {
      case 'genieContext': {
        const { fetchGenieContext } = await import('../services/genieContext');
        const output = await fetchGenieContext(inputs.funnelId || 'direct');
        return output || { websiteSummary: 'Direct Business Input Context' };
      }

      case 'normalizeInput': {
        const { normalizeInput } = await import('../services/normalizeInput');
        // Genie scraped content acts as enrichment input
        const genieOutput = run.stages.find(s => s.stageName === 'genieContext')?.outputJson as any;
        const enrichedInput = {
          ...inputs,
          industry: inputs.industry || genieOutput?.industry || 'General Business',
          geography: inputs.geography || genieOutput?.geography || 'India',
        };
        return normalizeInput(enrichedInput);
      }

      case 'brandIntelligence': {
        const genieOutput = run.stages.find(s => s.stageName === 'genieContext')?.outputJson as any;
        const normalized = run.stages.find(s => s.stageName === 'normalizeInput')?.outputJson as any;
        const { runBrandIntelligence } = await import('../services/generateStrategy');
        const brandProfile = await runBrandIntelligence(normalized, genieOutput?.websiteSummary);
        return brandProfile;
      }

      case 'audiencePersona': {
        const brandProfile = run.stages.find(s => s.stageName === 'brandIntelligence')?.outputJson as any;
        if (!brandProfile) {
          throw new Error("Missing 'brandIntelligence' stage output for 'audiencePersona'");
        }
        const { runAudiencePersona } = await import('../services/generateStrategy');
        const personas = await runAudiencePersona(brandProfile);
        return personas;
      }

      case 'platformStrategy': {
        const brandProfile = run.stages.find(s => s.stageName === 'brandIntelligence')?.outputJson as any;
        const personas = run.stages.find(s => s.stageName === 'audiencePersona')?.outputJson as any;
        if (!brandProfile || !personas) {
          throw new Error("Missing preceding brandProfile or personas outputs for 'platformStrategy'");
        }
        const { runPlatformStrategy } = await import('../services/generateStrategy');
        const platforms = await runPlatformStrategy(brandProfile, personas);
        return platforms;
      }

      case 'campaignStrategy': {
        const genieOutput = run.stages.find(s => s.stageName === 'genieContext')?.outputJson as any;
        const normalized = run.stages.find(s => s.stageName === 'normalizeInput')?.outputJson as any;
        const brandProfile = run.stages.find(s => s.stageName === 'brandIntelligence')?.outputJson as any;
        const personas = run.stages.find(s => s.stageName === 'audiencePersona')?.outputJson as any;
        const platforms = run.stages.find(s => s.stageName === 'platformStrategy')?.outputJson as any;

        if (!brandProfile || !personas || !platforms) {
          throw new Error("Missing preceding brand, personas, or platform outputs for 'campaignStrategy'");
        }

        const { runCampaignStrategy } = await import('../services/generateStrategy');
        const strategy = await runCampaignStrategy(normalized, brandProfile, personas, platforms);

        // Save strategy to database (re-uses existing save helper for 100% backward compatibility)
        const { saveStrategyToDB } = await import('../db/database');
        await saveStrategyToDB(run.campaignId, strategy);

        return strategy;
      }

      case 'generateCalendar': {
        const normalized = run.stages.find(s => s.stageName === 'normalizeInput')?.outputJson as any;
        const strategy = run.stages.find(s => s.stageName === 'campaignStrategy')?.outputJson as any;
        
        // Fetch festivals if enabled
        let festivals: any[] = [];
        if (normalized.festival_enabled) {
          try {
            const { getFestivalsForDateRange, getCountryCode } = await import('../services/festivalApi');
            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + normalized.total_days);
            
            const countryCode = getCountryCode(normalized.geography);
            
            festivals = await getFestivalsForDateRange(startDate, endDate, countryCode);
          } catch (err: any) {
            logger.warn(`Festival API call skipped or failed (non-fatal): ${err.message}`);
          }
        }

        const { generateCalendar } = await import('../services/generateCalendar');
        const calendar = await generateCalendar(normalized, strategy, festivals, run.campaignId);
        return calendar;
      }

      case 'generatePosts': {
        const calendar = run.stages.find(s => s.stageName === 'generateCalendar')?.outputJson as any as any[];
        const normalized = run.stages.find(s => s.stageName === 'normalizeInput')?.outputJson as any;
        const strategy = run.stages.find(s => s.stageName === 'campaignStrategy')?.outputJson as any;
        const genieOutput = run.stages.find(s => s.stageName === 'genieContext')?.outputJson as any;

        const { generatePosts } = await import('../services/generatePosts');
        const { savePostsToDB } = await import('../db/database');

        const scheduledTime = normalized.scheduledTime || '10:00';
        const timezone = normalized.timezone || 'Asia/Kolkata';

        const allGeneratedPosts: any[] = [];

        // Check if calendar items have explicit platform assignments
        const hasAssignedPlatforms = calendar && calendar.length > 0 && calendar.every(item => item.platform);

        if (hasAssignedPlatforms) {
          logger.info('Calendar has platform-specific slot assignments. Generating posts dynamically per platform.');
          
          // Group calendar items by platform
          const platformGroups: Record<string, any[]> = {};
          for (const item of calendar) {
            const plat = item.platform;
            if (!platformGroups[plat]) platformGroups[plat] = [];
            platformGroups[plat].push(item);
          }

          for (const [plat, items] of Object.entries(platformGroups)) {
            logger.info(`Generating platform-specific posts for: ${plat} (${items.length} posts)`);
            const platformInput = { ...normalized, platform: plat };
            const platformPosts = await generatePosts(items, platformInput, strategy, genieOutput?.websiteSummary);
            
            await savePostsToDB(run.campaignId, platformPosts, plat, scheduledTime, timezone);
            
            allGeneratedPosts.push(...platformPosts.map(p => ({ ...p, platform: plat })));
          }
        } else {
          // Legacy duplicate-across-all-platforms path
          const platforms = normalized.platforms || [normalized.platform || 'instagram'];
          logger.info(`Legacy mode: duplicating ${calendar.length} posts across platforms: ${platforms.join(', ')}`);
          for (const plat of platforms) {
            logger.info(`Generating platform-specific posts for: ${plat}`);
            const platformInput = { ...normalized, platform: plat };
            const platformPosts = await generatePosts(calendar, platformInput, strategy, genieOutput?.websiteSummary);
            
            await savePostsToDB(run.campaignId, platformPosts, plat, scheduledTime, timezone);
            
            allGeneratedPosts.push(...platformPosts.map(p => ({ ...p, platform: plat })));
          }
        }

        return allGeneratedPosts;
      }

      default:
        throw new Error(`Execution handler not mapped for stage: ${stageName}`);
    }
  }

  /**
   * Applies an interactive manual override to a target stage.
   * Transactionally sets the target stage to OVERRIDDEN, clears/resets all downstream stages
   * back to PENDING, and sets the PipelineRun status to PAUSED for manual inspection.
   * 
   * @param runId - The active pipeline run ID
   * @param stageName - The stage that is being overridden (e.g. 'generateStrategy')
   * @param outputJson - The customized JSON object submitted by the user
   */
  static async applyOverride(runId: string, stageName: string, outputJson: any): Promise<void> {
    const stageIndex = STAGE_ORDER.indexOf(stageName);
    if (stageIndex === -1) {
      throw new Error(`Invalid stage name: ${stageName}`);
    }

    const downstreamStages = STAGE_ORDER.slice(stageIndex + 1);

    logger.info(`Applying manual override to stage '${stageName}' on run ${runId}`);

    await prisma.$transaction(async (tx) => {
      // 1. Update the overrode stage status and output
      await tx.pipelineStageOutput.update({
        where: { runId_stageName: { runId, stageName } },
        data: {
          status: 'OVERRIDDEN',
          outputJson: outputJson as any,
          errorMessage: null,
          completedAt: new Date()
        }
      });

      // 2. Wipe and reset downstream stages to PENDING
      await tx.pipelineStageOutput.updateMany({
        where: {
          runId,
          stageName: { in: downstreamStages }
        },
        data: {
          status: 'PENDING',
          outputJson: Prisma.DbNull,
          errorMessage: null,
          completedAt: null,
          attemptCount: 0
        }
      });

      // 3. Mark the overall PipelineRun status as PAUSED
      await tx.pipelineRun.update({
        where: { id: runId },
        data: { status: 'PAUSED' }
      });
    });

    logger.info(`✓ Stage override applied. Downstream stages reset: ${downstreamStages.join(', ')}`);
  }
}
