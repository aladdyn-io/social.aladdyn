/**
 * Express API Server
 *
 * HTTP REST API for the content generation pipeline
 *
 * Endpoints:
 * - POST /api/v1/generate-content       - Direct generation with inline input
 * - POST /api/v1/campaigns/:id/generate - Generate from database campaign
 * - POST /api/v1/campaigns/:id/regenerate - Regenerate DRAFT posts (reuses strategy)
 * - GET  /api/v1/jobs/:id               - Get job status (future: async processing)
 * - GET  /health                        - Health check
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { runContentPipeline } from './pipeline/runContentPipeline';
import {
  getCampaignFromDB,
  getPostsByCampaign,
  getPostsByDate,
  getCalendarGrouped,
  getPublishLogsForPost,
} from './db/database';
import prisma from './lib/prisma';
import { CampaignStatus } from '@prisma/client';
import {
  editPost,
  regeneratePost,
  regenerateCampaignPosts,
  deletePost as deletePostService,
  addExtraPost,
} from './services/postManagement';
import {
  ApiResponse,
  GenerateContentRequest,
  GenerateContentResponse,
  HealthCheckResponse,
  ApiErrorCode,
} from './types/api';
import { ContentInput } from './types/content';
import {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
} from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';
import { fetchGenieContext } from './services/genieContext';
import cache from './services/cache';
import { generateAiPostForDate, createManualPostForDate } from './services/calendarPost';
import { uploadBufferToStorage } from './services/objectStorage';
import { ManualPostData } from './types/calendar';

// ============================================================================
// SERVER SETUP
// ============================================================================

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

// Multer for multipart/form-data (user media uploads, max 10 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);

  // Log response time
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });

  next();
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check endpoint
 * GET /health
 *
 * Returns server health and service availability
 */
app.get('/health', async (req: Request, res: Response) => {
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }

  const allOk = dbStatus === 'ok';

  const response: ApiResponse<HealthCheckResponse> = {
    success: allOk,
    data: {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: dbStatus,
        openai: 'ok',
        storage: 'ok',
        imageGeneration: 'ok',
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  res.status(allOk ? 200 : 503).json(response);
});

/**
 * Cache statistics endpoint
 * GET /api/v1/cache/stats
 *
 * Returns cache performance metrics
 */
app.get('/api/v1/cache/stats', (req: Request, res: Response) => {
  const stats = cache.getStats();
  res.json({
    success: true,
    data: stats,
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * Clear cache endpoint
 * POST /api/v1/cache/clear
 *
 * Clears all cached data (or specific patterns)
 */
app.post('/api/v1/cache/clear', (req: Request, res: Response) => {
  const { pattern } = req.body;

  if (pattern) {
    const count = cache.invalidatePattern(pattern);
    res.json({
      success: true,
      data: { message: `Cleared ${count} cache entries matching pattern: ${pattern}` },
    });
  } else {
    cache.clear();
    res.json({
      success: true,
      data: { message: 'All cache cleared' },
    });
  }
});

/**
 * Generate content with direct input
 * POST /api/v1/generate-content
 *
 * Request body: { input: ContentInput, funnelId?: string }
 * Returns: Complete content generation result
 */
app.post(
  '/api/v1/generate-content',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();

    console.log('[API] Starting content generation with direct input...');

    // Validate request body
    const { input, funnelId } = req.body as GenerateContentRequest & { funnelId?: string };

    if (!input) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Request body must include "input" field with ContentInput data',
        400
      );
    }

    // campaignId declared outside try so the catch block can mark it FAILED
    let campaignId: string | undefined;

    try {
      const userId = (req as any).user?.id || 'anonymous';

      // Allow caller to supply explicit start/end dates and a campaign name
      const { startDate: rawStart, endDate: rawEnd, name: campaignName } = req.body as {
        startDate?: string;
        endDate?: string;
        name?: string;
      };
      const startDate = rawStart ? new Date(rawStart) : new Date();
      let endDate: Date;
      if (rawEnd) {
        endDate = new Date(rawEnd);
      } else {
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (input.total_days || 30));
      }
      // Recalculate total_days from actual dates if both supplied
      if (rawStart && rawEnd) {
        input.total_days = Math.round(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // Create SocialCampaign in Prisma (social.* schema)
      const campaign = await prisma.socialCampaign.create({
        data: {
          funnelId: funnelId || 'direct',
          userId,
          name: campaignName || `${input.industry || 'Social'} Campaign`,
          startDate,
          endDate,
          timezone: 'Asia/Kolkata',
          totalDays: input.total_days,
          frequencyPerWeek: input.frequency_per_week,
          platforms: input.platforms ?? ['instagram'],
          contentMix: { photo: 4, reel: 2, carousel: 2, story: 1, written: 2 },
          industry: input.industry,
          geography: input.geography || 'India',
          companyDesc: undefined,
          brandLogo: input.logo_url || undefined,
          brandColor: input.base_color || undefined,
          accentColor: input.accent_color || undefined,
          services: input.services || [],
          festivalEnabled: input.festival_enabled ?? true,
          status: 'GENERATING',
        },
      });
      campaignId = campaign.id;

      const output = await runContentPipeline(input, campaignId, funnelId);

      // Mark campaign as ready
      await prisma.socialCampaign.update({
        where: { id: campaignId },
        data: { status: 'READY' },
      });
      const processingTime = Date.now() - startTime;

      console.log(`[API] ✓ Content generation completed in ${processingTime}ms`);

      // Try to fetch posts with IDs from database; if DB is unreachable, fall back to in-memory posts
      let postsWithIds = output.posts;
      let dbWarning: string | undefined;

      try {
        const postsFromDB = await getPostsByCampaign(campaignId);
        console.log(`[API] DEBUG: First post from DB:`, postsFromDB[0]);
        postsWithIds = postsFromDB.map((dbPost: any) => ({
          entryId: dbPost.id,
          postId: dbPost.id,
          scheduledDate: dbPost.scheduledDate,
          caption: dbPost.caption,
          hashtags: dbPost.hashtags,
          callToAction: dbPost.callToAction,
          imageUrl: dbPost.imageUrl,
          detailedImagePrompt: dbPost.imagePrompt,
          platform: dbPost.platform,
          contentType: dbPost.contentType,
          status: dbPost.status,
          metadata: {
            contentPillar: dbPost.contentPillar,
            festival: dbPost.festivalName,
            generatedAt: dbPost.createdAt,
            topic: dbPost.topic,
            imageModel: dbPost.imageModel,
            imageGenerated: dbPost.imageGenerated,
          },
        }));
        console.log(`[API] DEBUG: First mapped post:`, postsWithIds[0]);
      } catch (dbError) {
        console.error('[API] ⚠ Failed to fetch posts from DB, returning in-memory posts:', dbError);
        dbWarning = 'Database unavailable; returned in-memory posts without IDs';

        // Attach synthetic IDs so frontend actions still work in-memory
        postsWithIds = output.posts.map((p, idx) => ({
          ...p,
          postId: p.entryId || `mem-${idx}-${Date.now()}`,
        }));
      }

      // Build response
      const responseData: GenerateContentResponse = {
        campaign_id: campaignId,
        output: {
          ...output,
          posts: postsWithIds,
        } as any,
        summary: {
          totalPosts: output.posts.length,
          strategyPillars: output.strategy.content_pillars.length,
          calendarDays: output.calendar.length,
          festivalPosts: output.calendar.filter((item) => item.is_festival).length,
          processingTime,
        },
        warning: dbWarning,
      };

      const response: ApiResponse<GenerateContentResponse> = {
        success: true,
        data: responseData,
        meta: {
          timestamp: new Date().toISOString(),
          processingTime,
        },
      };

      res.json(response);
    } catch (error) {
      console.error('[API] ✗ Pipeline failed:', error);

      // Mark campaign FAILED so it's not stuck in GENERATING
      if (campaignId) {
        await prisma.socialCampaign
          .update({ where: { id: campaignId }, data: { status: 'FAILED' as CampaignStatus } })
          .catch(() => {});
      }

      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  })
);

/**
 * Generate content from existing campaign
 * POST /api/v1/campaigns/:campaignId/generate
 *
 * Reads campaign data from database and generates content.
 * Guards against concurrent runs (campaign must not already be GENERATING).
 */
app.post(
  '/api/v1/campaigns/:campaignId/generate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { campaignId } = req.params;

    console.log(`[API] Starting content generation for campaign: ${campaignId}`);

    // Guard: reject if already generating
    const campaign = await prisma.socialCampaign
      .findUnique({ where: { id: campaignId }, select: { id: true, status: true } })
      .catch(() => null);

    if (!campaign) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, `Campaign not found: ${campaignId}`, 404, { campaignId });
    }

    if (campaign.status === 'GENERATING') {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Campaign is already generating — wait for it to complete before retrying',
        409,
        { campaignId }
      );
    }

    // Mark as GENERATING
    await prisma.socialCampaign.update({
      where: { id: campaignId },
      data: { status: 'GENERATING' },
    });

    let campaignData: ContentInput;
    try {
      campaignData = await getCampaignFromDB(campaignId);
    } catch (error) {
      await prisma.socialCampaign
        .update({ where: { id: campaignId }, data: { status: 'FAILED' as CampaignStatus } })
        .catch(() => {});
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, `Campaign not found: ${campaignId}`, 404, { campaignId });
    }

    // Run pipeline
    try {
      const output = await runContentPipeline(campaignData, campaignId);
      const processingTime = Date.now() - startTime;

      await prisma.socialCampaign.update({
        where: { id: campaignId },
        data: { status: 'READY' },
      });

      console.log(`[API] ✓ Campaign content generated in ${processingTime}ms`);

      // Build response
      const responseData: GenerateContentResponse = {
        output,
        summary: {
          totalPosts: output.posts.length,
          strategyPillars: output.strategy.content_pillars.length,
          calendarDays: output.calendar.length,
          festivalPosts: output.calendar.filter((item) => item.is_festival).length,
          processingTime,
        },
      };

      const response: ApiResponse<GenerateContentResponse> = {
        success: true,
        data: responseData,
        meta: {
          timestamp: new Date().toISOString(),
          processingTime,
        },
      };

      res.json(response);
    } catch (error) {
      console.error('[API] ✗ Pipeline failed:', error);

      await prisma.socialCampaign
        .update({ where: { id: campaignId }, data: { status: 'FAILED' as CampaignStatus } })
        .catch(() => {});

      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Content generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { campaignId, originalError: error instanceof Error ? error.message : String(error) }
      );
    }
  })
);

/**
 * Regenerate posts for an existing campaign (without re-running strategy)
 * POST /api/v1/campaigns/:campaignId/regenerate
 *
 * Regenerates captions + image prompts for all DRAFT posts.
 * APPROVED / SCHEDULED / POSTED posts are never touched.
 * Uses the campaign's saved strategy from DB — no strategy re-generation.
 */
app.post(
  '/api/v1/campaigns/:campaignId/regenerate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { campaignId } = req.params;
    const userId = (req as any).user?.id;

    const campaign = await prisma.socialCampaign.findFirst({
      where: { id: campaignId, userId },
      select: { id: true, status: true },
    });

    if (!campaign) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Campaign not found', 404, { campaignId });
    }

    if (campaign.status === 'GENERATING') {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Campaign is already generating — wait for it to complete before retrying',
        409,
        { campaignId }
      );
    }

    await prisma.socialCampaign.update({
      where: { id: campaignId },
      data: { status: 'GENERATING' },
    });

    try {
      const { regenerated, skipped } = await regenerateCampaignPosts(campaignId);
      const processingTime = Date.now() - startTime;

      await prisma.socialCampaign.update({
        where: { id: campaignId },
        data: { status: 'READY' },
      });

      res.json({
        success: true,
        data: {
          campaignId,
          regenerated,
          skipped,
          message: `Regenerated ${regenerated} posts`,
        },
        meta: { timestamp: new Date().toISOString(), processingTime },
      });
    } catch (error) {
      console.error('[API] ✗ Campaign regeneration failed:', error);

      await prisma.socialCampaign
        .update({ where: { id: campaignId }, data: { status: 'FAILED' as CampaignStatus } })
        .catch(() => {});

      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Campaign regeneration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { campaignId }
      );
    }
  })
);

/**
 * Test endpoint - Quick validation
 * POST /api/v1/test
 *
 * Validates input without running full pipeline
 */
app.post('/api/v1/test', (req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    data: {
      message: 'API is working',
      receivedBody: req.body,
      timestamp: new Date().toISOString(),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  res.json(response);
});

/**
 * Get all posts for a campaign
 * GET /api/v1/campaigns/:campaignId/posts
 *
 * Query params:
 * - date: Optional date filter (YYYY-MM-DD)
 */
app.get(
  '/api/v1/campaigns/:campaignId/posts',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const { date } = req.query;

    console.log(`[API] Fetching posts for campaign: ${campaignId}${date ? ` on ${date}` : ''}`);

    let posts: any[];

    try {
      if (date) {
        // Fetch posts for specific date
        posts = await getPostsByDate(campaignId, date as string);
      } else {
        // Fetch all posts for campaign
        posts = await getPostsByCampaign(campaignId);
      }

      const response: ApiResponse = {
        success: true,
        data: {
          campaignId,
          date: date || null,
          totalPosts: posts.length,
          posts,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.DATABASE_ERROR,
        `Failed to fetch posts: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { campaignId, date }
      );
    }
  })
);

/**
 * Edit post caption/image/prompt
 * PUT /api/v1/posts/:postId
 *
 * Request body: { caption?, imageUrl?, imagePrompt?, hashtags?, callToAction? }
 */
app.put(
  '/api/v1/posts/:postId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;
    const updates = req.body;

    console.log(`[API] Editing post: ${postId}`);

    if (!updates || Object.keys(updates).length === 0) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Request body must include at least one field to update',
        400
      );
    }

    try {
      const updatedPost = await editPost(postId, updates);

      const response: ApiResponse = {
        success: true,
        data: {
          post: updatedPost,
          message: 'Post updated successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.DATABASE_ERROR,
        `Failed to edit post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postId }
      );
    }
  })
);

/**
 * Regenerate post content
 * POST /api/v1/posts/:postId/regenerate
 *
 * Request body:
 *   regenerateCaption?: boolean  — regenerate caption text (default: true)
 *   regeneratePrompt?:  boolean  — regenerate image prompt only, no actual image (default: false)
 *   regenerateImage?:   boolean  — regenerate image prompt + generate actual image (default: false)
 */
app.post(
  '/api/v1/posts/:postId/regenerate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;
    const {
      regenerateCaption = true,
      regeneratePrompt = false,
      regenerateImage = false,
    } = req.body;

    console.log(
      `[API] Regenerating post: ${postId} (caption:${regenerateCaption} prompt:${regeneratePrompt} image:${regenerateImage})`
    );

    try {
      const regeneratedPost = await regeneratePost(postId, {
        regenerateCaption,
        regeneratePrompt,
        regenerateImage,
      });

      const response: ApiResponse = {
        success: true,
        data: {
          post: regeneratedPost,
          message: 'Post regenerated successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Failed to regenerate post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postId }
      );
    }
  })
);

/**
 * Delete post
 * DELETE /api/v1/posts/:postId
 */
app.delete(
  '/api/v1/posts/:postId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;

    console.log(`[API] Deleting post: ${postId}`);

    try {
      await deletePostService(postId);

      const response: ApiResponse = {
        success: true,
        data: {
          message: 'Post deleted successfully',
          postId,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Failed to delete post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postId }
      );
    }
  })
);

/**
 * Generate image for a specific post (ON-DEMAND)
 * POST /api/v1/posts/:postId/generate-image
 *
 * NEW WORKFLOW:
 * - User views posts with captions and prompts (no images)
 * - User selects specific posts to generate images for
 * - This endpoint generates and uploads the image
 * - Returns the public image URL
 *
 * Request body: {} (optional - can include provider overrides)
 * Returns: { imageUrl, model, generatedAt }
 */
app.post(
  '/api/v1/posts/:postId/generate-image',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;
    const startTime = Date.now();

    console.log(`[API] Generating image on-demand for post: ${postId}`);

    try {
      // Import on-demand service
      const { generatePostImage } = await import('./services/onDemandImageGeneration');

      // Generate image using detailed prompt from database
      const imageUrl = await generatePostImage(postId);

      const duration = Date.now() - startTime;

      const response: ApiResponse = {
        success: true,
        data: {
          postId,
          imageUrl,
          message: 'Image generated successfully',
          generatedAt: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: duration,
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Failed to generate image: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postId }
      );
    }
  })
);

/**
 * Batch generate images for multiple posts
 * POST /api/v1/posts/generate-images/batch
 *
 * Request body: { postIds: string[] }
 * Returns: { results: { postId: string, success: boolean, imageUrl?: string, error?: string }[] }
 */
app.post(
  '/api/v1/posts/generate-images/batch',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postIds } = req.body;
    const startTime = Date.now();

    if (!Array.isArray(postIds) || postIds.length === 0) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Request body must include "postIds" array with at least one post ID',
        400
      );
    }

    console.log(`[API] Batch generating images for ${postIds.length} posts`);

    try {
      const { generatePostImages } = await import('./services/onDemandImageGeneration');

      const resultsMap = await generatePostImages(postIds);

      // Convert map to array for response
      const results = Array.from(resultsMap.entries()).map(([postId, result]) => ({
        postId,
        ...result,
      }));

      const successCount = results.filter(r => r.success).length;
      const duration = Date.now() - startTime;

      const response: ApiResponse = {
        success: true,
        data: {
          totalRequested: postIds.length,
          successCount,
          failureCount: postIds.length - successCount,
          results,
        },
        meta: {
          timestamp: new Date().toISOString(),
          processingTime: duration,
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Failed to batch generate images: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postIds }
      );
    }
  })
);

/**
 * List all campaigns for the authenticated user
 * GET /api/v1/campaigns
 */
app.get(
  '/api/v1/campaigns',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const campaigns = await prisma.socialCampaign.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { posts: true } } },
    });

    res.json({
      success: true,
      data: { campaigns },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Get a single campaign with its posts
 * GET /api/v1/campaigns/:campaignId
 */
app.get(
  '/api/v1/campaigns/:campaignId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const campaign = await prisma.socialCampaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { strategy: true, _count: { select: { posts: true } } },
    });

    res.json({
      success: true,
      data: { campaign },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Sync Instagram credentials from server.aladdyn into campaign
 * POST /api/v1/campaigns/:campaignId/connect-instagram
 *
 * Fetches igUserId + accessToken from server.aladdyn's internal API
 * and stores them on the SocialCampaign record.
 */
app.post(
  '/api/v1/campaigns/:campaignId/connect-instagram',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const userId = (req as any).user?.id;

    const campaign = await prisma.socialCampaign.findFirst({
      where: { id: campaignId, userId },
      select: { id: true, funnelId: true },
    });

    if (!campaign) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Campaign not found', 404);
    }

    // Fetch credentials from server.aladdyn
    const serverApiUrl = process.env.SERVER_API_URL || 'http://localhost:3001';
    const internalSecret = process.env.INTERNAL_API_SECRET || 'aladdyn-internal-secret';

    const credRes = await fetch(
      `${serverApiUrl}/api/instagram/credentials/${campaign.funnelId}`,
      {
        headers: { 'x-internal-secret': internalSecret },
      }
    );

    if (!credRes.ok) {
      const errData = (await credRes.json().catch(() => ({}))) as Record<string, unknown>;
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        (errData.error as string) || 'No Instagram account connected to this genie',
        credRes.status === 404 ? 404 : 500
      );
    }

    const credData = (await credRes.json()) as {
      data: { igUserId: string; accessToken: string };
    };

    // Store on campaign
    await prisma.socialCampaign.update({
      where: { id: campaignId },
      data: {
        igUserId: credData.data.igUserId,
        accessToken: credData.data.accessToken,
      },
    });

    res.json({
      success: true,
      data: {
        campaignId,
        igUserId: credData.data.igUserId,
        connected: true,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Delete a campaign and all its posts
 * DELETE /api/v1/campaigns/:campaignId
 */
app.delete(
  '/api/v1/campaigns/:campaignId',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const userId = (req as any).user?.id;

    const campaign = await prisma.socialCampaign.findFirst({
      where: { id: campaignId, userId },
      select: { id: true, status: true },
    });

    if (!campaign) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Campaign not found', 404);
    }

    // Cascade delete — Prisma handles posts + strategy via onDelete: Cascade
    await prisma.socialCampaign.delete({ where: { id: campaignId } });

    res.json({
      success: true,
      data: { campaignId, message: 'Campaign deleted' },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Approve a post (moves it to APPROVED — scheduler will enqueue it)
 * POST /api/v1/posts/:postId/approve
 */
app.post(
  '/api/v1/posts/:postId/approve',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;

    const existing = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { status: true },
    });

    if (!existing) {
      throw new AppError(ApiErrorCode.INVALID_INPUT, 'Post not found', 404);
    }

    if (existing.status !== 'DRAFT') {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        `Cannot approve post in '${existing.status}' status — only DRAFT posts can be approved`,
        400
      );
    }

    const post = await prisma.socialPost.update({
      where: { id: postId },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });

    res.json({
      success: true,
      data: { post, message: 'Post approved — will be published at scheduled time' },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Reject a post (moves it to REJECTED — will not be published)
 * POST /api/v1/posts/:postId/reject
 */
app.post(
  '/api/v1/posts/:postId/reject',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;

    const existing = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { status: true },
    });

    if (!existing) {
      throw new AppError(ApiErrorCode.INVALID_INPUT, 'Post not found', 404);
    }

    const rejectableStatuses = ['DRAFT', 'APPROVED'];
    if (!rejectableStatuses.includes(existing.status)) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        `Cannot reject post in '${existing.status}' status`,
        400
      );
    }

    const post = await prisma.socialPost.update({
      where: { id: postId },
      data: { status: 'REJECTED' },
    });

    res.json({
      success: true,
      data: { post, message: 'Post rejected — will not be published' },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Add extra post for specific date
 * POST /api/v1/campaigns/:campaignId/posts/add
 *
 * Request body: { date, pillar?, topic?, isFestival?, festivalName? }
 */
app.post(
  '/api/v1/campaigns/:campaignId/posts/add',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const { date, pillar, topic, isFestival, festivalName } = req.body;

    if (!date) {
      throw new AppError(
        ApiErrorCode.MISSING_REQUIRED_FIELD,
        'Request body must include "date" field (YYYY-MM-DD)',
        400
      );
    }

    console.log(`[API] Adding extra post for campaign ${campaignId} on ${date}`);

    try {
      const newPost = await addExtraPost(campaignId, date, {
        pillar,
        topic,
        isFestival,
        festivalName,
      });

      const response: ApiResponse = {
        success: true,
        data: {
          post: newPost,
          message: 'Post created successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      };

      res.json(response);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.PIPELINE_FAILED,
        `Failed to add post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { campaignId, date }
      );
    }
  })
);

/**
 * Update campaign status (run / pause / complete)
 * PATCH /api/v1/campaigns/:campaignId/status
 *
 * Body: { status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' }
 */
app.patch(
  '/api/v1/campaigns/:campaignId/status',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const userId = req.user?.id;
    const { status } = req.body as { status: string };

    const allowedStatuses: string[] = [
      CampaignStatus.ACTIVE,
      CampaignStatus.PAUSED,
      CampaignStatus.COMPLETED,
    ];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(ApiErrorCode.INVALID_INPUT, 'status must be ACTIVE, PAUSED, or COMPLETED', 400);
    }

    const campaign = await prisma.socialCampaign.findFirst({
      where: { id: campaignId, userId },
    });

    if (!campaign) {
      throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, 'Campaign not found', 404);
    }

    const updated = await prisma.socialCampaign.update({
      where: { id: campaignId },
      data: { status: status as CampaignStatus },
    });

    res.json({
      success: true,
      data: { campaignId, status: updated.status },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Get activation context for a funnel (scraped business data preview)
 * GET /api/v1/funnels/:funnelId/activation-context
 *
 * Returns derived campaign params from genie scraped data.
 */
app.get(
  '/api/v1/funnels/:funnelId/activation-context',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { funnelId } = req.params;

    const genieCtx = await fetchGenieContext(funnelId);

    res.json({
      success: true,
      data: {
        companyName: genieCtx?.companyName ?? null,
        industry: genieCtx?.industry ?? null,
        geography: genieCtx?.geography ?? null,
        tone: genieCtx?.tone ?? null,
        websiteUrl: genieCtx?.websiteUrl ?? null,
        websiteSummary: genieCtx?.websiteSummary ?? null,
        // Fixed campaign defaults
        total_days: 30,
        frequency_per_week: 4,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

// ============================================================================
// CALENDAR ENDPOINTS
// ============================================================================

/**
 * Full content calendar for a campaign, grouped by date
 * GET /api/v1/campaigns/:campaignId/calendar
 *
 * Returns every post grouped into CalendarDayGroup objects sorted by date.
 */
app.get(
  '/api/v1/campaigns/:campaignId/calendar',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;
    const calendar = await getCalendarGrouped(campaignId);

    res.json({
      success: true,
      data: {
        campaignId,
        totalDays: calendar.length,
        calendar,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Posts for a specific calendar date
 * GET /api/v1/campaigns/:campaignId/calendar/:date
 */
app.get(
  '/api/v1/campaigns/:campaignId/calendar/:date',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId, date } = req.params;
    const posts = await getPostsByDate(campaignId, date);

    res.json({
      success: true,
      data: { campaignId, date, posts },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Generate an AI-authored post for a specific date
 * POST /api/v1/campaigns/:campaignId/calendar/:date/generate
 *
 * Body: { pillar?: string, topic?: string }
 *
 * Creates a DRAFT post with AI caption + image prompt (no image yet).
 * Use POST /posts/:id/generate-image to add media afterwards.
 */
app.post(
  '/api/v1/campaigns/:campaignId/calendar/:date/generate',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId, date } = req.params;
    const { pillar, topic } = req.body ?? {};

    const post = await generateAiPostForDate(campaignId, date, { pillar, topic });

    res.status(201).json({
      success: true,
      data: {
        post,
        message: 'AI post created — use generate-image to add media',
      },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Add a manual post for a specific date
 * POST /api/v1/campaigns/:campaignId/calendar/:date/post
 *
 * Content-Type: multipart/form-data
 * Fields: platform (required), contentType, scheduledTime, title, caption,
 *         hashtags (JSON array or comma-sep), callToAction, imageUrl
 * File:   image (optional, max 10 MB — used when imageUrl not provided)
 */
app.post(
  '/api/v1/campaigns/:campaignId/calendar/:date/post',
  requireAuth,
  upload.single('image'),
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId, date } = req.params;

    const platform = req.body?.platform as string | undefined;
    if (!platform) {
      throw new AppError(ApiErrorCode.INVALID_INPUT, '"platform" field is required', 400);
    }

    // Resolve image URL: uploaded file takes precedence over explicit imageUrl
    let imageUrl: string | undefined = req.body?.imageUrl as string | undefined;
    if (req.file) {
      imageUrl = await uploadBufferToStorage(
        req.file.buffer,
        req.file.mimetype,
        campaignId
      );
    }

    // Parse hashtags: accept JSON array string or comma-separated plain string
    let hashtags: string[] = [];
    const rawHashtags = req.body?.hashtags as string | string[] | undefined;
    if (Array.isArray(rawHashtags)) {
      hashtags = rawHashtags;
    } else if (typeof rawHashtags === 'string') {
      try {
        const parsed = JSON.parse(rawHashtags);
        hashtags = Array.isArray(parsed) ? parsed : rawHashtags.split(',').map((h) => h.trim());
      } catch {
        hashtags = rawHashtags.split(',').map((h) => h.trim()).filter(Boolean);
      }
    }

    const data: ManualPostData = {
      scheduledDate: new Date(date),
      scheduledTime: (req.body?.scheduledTime as string) || '10:00',
      platform,
      contentType: (req.body?.contentType as string) || 'photo',
      topic: (req.body?.title as string) || undefined,
      caption: (req.body?.caption as string) || undefined,
      hashtags,
      callToAction: (req.body?.callToAction as string) || undefined,
      imageUrl,
    };

    const post = await createManualPostForDate(campaignId, date, data);

    res.status(201).json({
      success: true,
      data: { post, message: 'Manual post created as DRAFT' },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

// ============================================================================
// FAILURE VISIBILITY ENDPOINTS
// ============================================================================

/**
 * Full publish attempt history for a post
 * GET /api/v1/posts/:postId/publish-logs
 */
app.get(
  '/api/v1/posts/:postId/publish-logs',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;
    const logs = await getPublishLogsForPost(postId);

    res.json({
      success: true,
      data: { postId, logs },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * Retry a permanently failed post (reset to APPROVED)
 * POST /api/v1/posts/:postId/retry
 *
 * Post must be in FAILED status. Resets to APPROVED so the scheduler
 * picks it up on the next tick.
 */
app.post(
  '/api/v1/posts/:postId/retry',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;

    const existing = await prisma.socialPost.findUnique({
      where: { id: postId },
      select: { status: true },
    });

    if (!existing) {
      throw new AppError(ApiErrorCode.POST_NOT_FOUND, 'Post not found', 404);
    }

    if (existing.status !== 'FAILED') {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        `Cannot retry post in '${existing.status}' status — only FAILED posts can be retried`,
        400
      );
    }

    const post = await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        publishError: null,
      },
    });

    res.json({
      success: true,
      data: { post, message: 'Post queued for retry — will publish at next scheduler tick' },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

/**
 * All failed posts for a campaign
 * GET /api/v1/campaigns/:campaignId/posts/failed
 */
app.get(
  '/api/v1/campaigns/:campaignId/posts/failed',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { campaignId } = req.params;

    const posts = await prisma.socialPost.findMany({
      where: { campaignId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({
      success: true,
      data: { campaignId, totalFailed: posts.length, posts },
      meta: { timestamp: new Date().toISOString() },
    });
  })
);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Error handler - must be last
app.use(errorHandler);

// ============================================================================
// SERVER START
// ============================================================================

/**
 * Start the server
 */
function startServer() {
  app.listen(PORT, HOST, async () => {
    console.log('='.repeat(80));
    console.log('Social Scene Content Generation API');
    console.log('='.repeat(80));
    console.log(`Server running on:`);
    console.log(`  - Local:   http://localhost:${PORT}`);
    console.log(`  - Network: http://${getNetworkIP()}:${PORT} (if available)`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Image Provider: ${process.env.IMAGE_PROVIDER || 'local'}`);
    console.log('');
    console.log('Available endpoints:');
    console.log(`  GET    http://localhost:${PORT}/health`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/generate-content`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/campaigns/:id/generate`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/campaigns/:id/regenerate`);
    console.log(`  GET    http://localhost:${PORT}/api/v1/campaigns/:id/posts`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/campaigns/:id/posts/add`);
    console.log(`  PUT    http://localhost:${PORT}/api/v1/posts/:id`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/posts/:id/regenerate`);
    console.log(`  DELETE http://localhost:${PORT}/api/v1/posts/:id`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/test`);
    console.log('='.repeat(80));

    // ── BullMQ workers + scheduler ─────────────────────────────────────────
    // Only start if Redis is reachable; failure is non-fatal in dev
    try {
      const { startPublishWorker } = await import('./jobs/workers/publishWorker');
      const { startImageGenWorker } = await import('./jobs/workers/imageGenWorker');
      const { startEngagementPollWorker } = await import('./jobs/workers/engagementPoller');
      const { startScheduler } = await import('./jobs/scheduler');

      startPublishWorker();
      startImageGenWorker();
      startEngagementPollWorker();
      startScheduler();

      console.log('[Server] BullMQ workers + scheduler running');
    } catch (err) {
      console.warn('[Server] BullMQ init skipped (Redis unavailable?):', (err as Error).message);
    }
  });
}

/**
 * Get network IP address for display
 */
function getNetworkIP(): string {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  return 'N/A';
}

// Start server if this is the main module
if (require.main === module) {
  startServer();
}

export { app, startServer };
