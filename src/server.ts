/**
 * Express API Server
 * 
 * HTTP REST API for the content generation pipeline
 * 
 * Endpoints:
 * - POST /api/v1/generate-content       - Direct generation with inline input
 * - POST /api/v1/campaigns/:id/generate - Generate from database campaign
 * - GET  /api/v1/jobs/:id               - Get job status (future: async processing)
 * - GET  /health                        - Health check
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { runContentPipeline } from './pipeline/runContentPipeline';
import { getCampaignFromDB, getPostsByCampaign, getPostsByDate, saveCampaignToDB } from './db/database';
import {
  editPost,
  regeneratePost,
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

// ============================================================================
// SERVER SETUP
// ============================================================================

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces

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
app.get('/health', (req: Request, res: Response) => {
  const response: ApiResponse<HealthCheckResponse> = {
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        database: 'ok', // TODO: Add actual health checks
        openai: 'ok',
        storage: 'ok',
        imageGeneration: 'ok',
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };

  res.json(response);
});

/**
 * Generate content with direct input
 * POST /api/v1/generate-content
 * 
 * Request body: { input: ContentInput }
 * Returns: Complete content generation result
 */
app.post(
  '/api/v1/generate-content',
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    console.log('[API] Starting content generation with direct input...');

    // Validate request body
    const requestData = req.body as GenerateContentRequest;
    
    if (!requestData.input) {
      throw new AppError(
        ApiErrorCode.INVALID_INPUT,
        'Request body must include "input" field with ContentInput data',
        400
      );
    }

    const input: ContentInput = requestData.input;

    // Validate required fields
    const requiredFields = [
      'industry',
      'total_days',
      'frequency_per_week',
      'services',
    ] as const;
    const missingFields = requiredFields.filter((field) => !input[field as keyof ContentInput]);
    
    if (missingFields.length > 0) {
      throw new AppError(
        ApiErrorCode.MISSING_REQUIRED_FIELD,
        `Missing required fields: ${missingFields.join(', ')}`,
        400,
        { missingFields }
      );
    }

    // Run pipeline
    try {
      // Generate a campaign ID and save campaign to database
      const campaignId = uuidv4();
      
      // Convert ContentInput to DatabaseInput format for saving
      const dbInput: any = {
        industry: input.industry,
        total_days: input.total_days,
        frequency_per_week: input.frequency_per_week,
        festival_enabled: input.festival_enabled ?? true,
        logo_url: input.logo_url || 'https://example.com/logo.png',
        font_style: input.font_style || 'Roboto',
        accent_color: input.accent_color || '#667eea',
        base_color: input.base_color || '#764ba2',
        services: input.services,
        geography: input.geography || 'India',
      };
      
      // Save campaign first (posts have foreign key constraint)
      await saveCampaignToDB(campaignId, dbInput);
      
      const output = await runContentPipeline(input, campaignId);
      const processingTime = Date.now() - startTime;

      console.log(`[API] ✓ Content generation completed in ${processingTime}ms`);

      // Try to fetch posts with IDs from database; if DB is unreachable, fall back to in-memory posts
      let postsWithIds = output.posts;
      let dbWarning: string | undefined;

      try {
        const postsFromDB = await getPostsByCampaign(campaignId);
        postsWithIds = postsFromDB.map((dbPost: any) => ({
          entryId: dbPost.entry_id || dbPost.post_id,
          postId: dbPost.post_id,
          scheduledDate: dbPost.scheduled_date,
          caption: dbPost.caption,
          hashtags: dbPost.hashtags,
          callToAction: dbPost.call_to_action,
          imageUrl: dbPost.image_url,
          metadata: {
            contentPillar: dbPost.content_pillar,
            festival: dbPost.festival_name,
            generatedAt: dbPost.created_at,
            imagePrompt: dbPost.image_prompt,
            imageModel: dbPost.image_model,
          },
        }));
      } catch (dbError) {
        console.error('[API] ⚠ Failed to fetch posts from DB, returning in-memory posts:', dbError);
        dbWarning = 'Database unavailable; returned in-memory posts without IDs';

        // Attach synthetic IDs so frontend actions still work in-memory
        postsWithIds = output.posts.map((p, idx) => ({
          ...p,
          postId: p.metadata?.imagePrompt ? `mem-${idx}-${Date.now()}` : `mem-${idx}`,
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
 * Reads campaign data from database and generates content
 */
app.post(
  '/api/v1/campaigns/:campaignId/generate',
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const { campaignId } = req.params;

    console.log(`[API] Starting content generation for campaign: ${campaignId}`);

    // Fetch campaign from database
    let campaignData: ContentInput;
    try {
      campaignData = await getCampaignFromDB(campaignId);
    } catch (error) {
      throw new AppError(
        ApiErrorCode.CAMPAIGN_NOT_FOUND,
        `Campaign not found: ${campaignId}`,
        404,
        { campaignId }
      );
    }

    // Run pipeline
    try {
      const output = await runContentPipeline(campaignData, campaignId);
      const processingTime = Date.now() - startTime;

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
 * Edit post caption/image
 * PUT /api/v1/posts/:postId
 * 
 * Request body: { caption?, imageUrl?, hashtags?, callToAction? }
 */
app.put(
  '/api/v1/posts/:postId',
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
 * Request body: { regenerateImage?: boolean }
 */
app.post(
  '/api/v1/posts/:postId/regenerate',
  asyncHandler(async (req: Request, res: Response) => {
    const { postId } = req.params;
    const { regenerateImage = false } = req.body;

    console.log(`[API] Regenerating post: ${postId} (image: ${regenerateImage})`);

    try {
      const regeneratedPost = await regeneratePost(postId, regenerateImage);

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
        ApiErrorCode.DATABASE_ERROR,
        `Failed to delete post: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        { postId }
      );
    }
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
  app.listen(PORT, HOST, () => {
    console.log('='.repeat(80));
    console.log('Social Scene Content Generation API');
    console.log('='.repeat(80));
    console.log(`Server running on:`);
    console.log(`  - Local:   http://localhost:${PORT}`);
    console.log(`  - Network: http://${getNetworkIP()}:${PORT} (if available)`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Image Provider: ${process.env.IMAGE_PROVIDER || 'huggingface'}`);
    console.log('');
    console.log('Available endpoints:');
    console.log(`  GET    http://localhost:${PORT}/health`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/generate-content`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/campaigns/:id/generate`);
    console.log(`  GET    http://localhost:${PORT}/api/v1/campaigns/:id/posts`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/campaigns/:id/posts/add`);
    console.log(`  PUT    http://localhost:${PORT}/api/v1/posts/:id`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/posts/:id/regenerate`);
    console.log(`  DELETE http://localhost:${PORT}/api/v1/posts/:id`);
    console.log(`  POST   http://localhost:${PORT}/api/v1/test`);
    console.log('='.repeat(80));
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
