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
import { runContentPipeline } from './pipeline/runContentPipeline';
import { getCampaignFromDB, getPostsByCampaign, getPostsByDate } from './db/database';
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
      const output = await runContentPipeline(input);
      const processingTime = Date.now() - startTime;

      console.log(`[API] ✓ Content generation completed in ${processingTime}ms`);

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
    console.log(`  GET  http://localhost:${PORT}/health`);
    console.log(`  POST http://localhost:${PORT}/api/v1/generate-content`);
    console.log(`  POST http://localhost:${PORT}/api/v1/campaigns/:id/generate`);
    console.log(`  GET  http://localhost:${PORT}/api/v1/campaigns/:id/posts`);
    console.log(`  POST http://localhost:${PORT}/api/v1/test`);
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
