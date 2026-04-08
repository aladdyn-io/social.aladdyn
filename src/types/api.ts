/**
 * API Request/Response Types
 * 
 * Defines the structure of HTTP API requests and responses
 */

import { ContentInput, ContentOutput, PostItem, Strategy, CalendarItem } from './content';

// ============================================================================
// API RESPONSE WRAPPER
// ============================================================================

/**
 * Standard API response envelope
 * Wraps all API responses with consistent structure
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta: {
    timestamp: string;
    requestId?: string;
    processingTime?: number; // milliseconds
  };
}

/**
 * Error structure for API responses
 */
export interface ApiError {
  code: string;
  message: string;
  details?: any;
  stack?: string; // Only in development mode
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

/**
 * POST /api/v1/generate-content
 * Direct generation with inline input
 */
export interface GenerateContentRequest {
  input: ContentInput;
  options?: {
    saveToDatabase?: boolean; // Default: false
    webhookUrl?: string; // Optional callback URL when complete
  };
}

/**
 * POST /api/v1/campaigns/:campaignId/generate
 * Generate from existing campaign in database
 */
export interface GenerateCampaignRequest {
  options?: {
    overrides?: Partial<ContentInput>; // Override specific fields
    webhookUrl?: string;
  };
}

/**
 * GET /api/v1/jobs/:jobId
 * Check job status (for async processing)
 */
export interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: {
    currentStep: string;
    stepsCompleted: number;
    totalSteps: number;
    postsGenerated: number;
    totalPosts: number;
  };
  result?: ContentOutput; // Only present when status is 'completed'
  error?: ApiError; // Only present when status is 'failed'
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

/**
 * Successful content generation response
 */
export interface GenerateContentResponse {
  campaign_id?: string; // Campaign ID if posts were saved to database
  output: ContentOutput;
  summary: {
    totalPosts: number;
    strategyPillars: number;
    calendarDays: number;
    festivalPosts: number;
    processingTime: number;
  };
  warning?: string;
}

/**
 * Async job creation response
 */
export interface JobCreatedResponse {
  jobId: string;
  status: 'pending';
  statusUrl: string; // URL to poll for status
  estimatedCompletionTime?: string; // ISO timestamp
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  version: string;
  services: {
    database: 'ok' | 'error';
    openai: 'ok' | 'error';
    storage: 'ok' | 'error';
    imageGeneration: 'ok' | 'error';
  };
}

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * Standard error codes for API responses
 */
export enum ApiErrorCode {
  // Validation errors (400)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // Not found errors (404)
  CAMPAIGN_NOT_FOUND = 'CAMPAIGN_NOT_FOUND',
  POST_NOT_FOUND = 'POST_NOT_FOUND',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  
  // Processing errors (500)
  PIPELINE_FAILED = 'PIPELINE_FAILED',
  AI_GENERATION_ERROR = 'AI_GENERATION_ERROR',
  IMAGE_GENERATION_ERROR = 'IMAGE_GENERATION_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  
  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Service errors (503)
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  OPENAI_UNAVAILABLE = 'OPENAI_UNAVAILABLE',
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  
  // Generic
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

// ============================================================================
// PAGINATION & FILTERING (for future endpoints)
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
