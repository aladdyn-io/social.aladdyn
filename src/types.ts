/**
 * Data Contracts for Content Generation Pipeline
 * 
 * These interfaces define the exact shape of data flowing between modules.
 * Each module's input and output must conform to these contracts.
 */

// ============================================================================
// DATABASE INPUT (what we read from PostgreSQL)
// ============================================================================

export interface DatabaseInput {
  campaign_id: string;
  industry: string;
  total_days: number;
  frequency_per_week: number;
  festival_enabled: boolean;
  logo_url: string;
  font_style: string;
  accent_color: string;
  base_color: string;
  services: string[]; // Array of service names
  geography: string; // Always "India" for V1
}

// ============================================================================
// NORMALIZED INPUT (after validation and normalization)
// ============================================================================

export interface NormalizedInput {
  campaignId: string;
  industry: string;
  totalDays: number;
  frequencyPerWeek: number;
  festivalEnabled: boolean;
  branding: {
    logoUrl: string;
    fontStyle: string;
    accentColor: string;
    baseColor: string;
  };
  services: string[];
  geography: string;
  // Computed fields
  totalPostsRequired: number;
  startDate: Date;
  endDate: Date;
}

// ============================================================================
// CONTENT STRATEGY (LLM-generated, must be JSON)
// ============================================================================

export interface ContentPillar {
  name: string;
  description: string;
  percentage: number; // e.g., 30 means 30% of posts
  keywords: string[];
}

export interface ContentStrategy {
  targetAudience: string;
  brandVoice: string;
  contentPillars: ContentPillar[];
  postingGuidelines: string[];
  hashtagStrategy: string[];
}

// ============================================================================
// FESTIVAL DATA
// ============================================================================

export interface Festival {
  name: string;
  date: Date;
  category: string; // "national" | "religious" | "cultural"
  relevance: "high" | "medium" | "low";
}

// ============================================================================
// CONTENT CALENDAR
// ============================================================================

export interface CalendarEntry {
  entryId: string;
  scheduledDate: Date;
  postType: "regular" | "festival";
  contentPillar?: ContentPillar; // For regular posts
  festival?: Festival; // For festival posts
  themeHint: string; // Human-readable hint for content generation
}

export interface ContentCalendar {
  entries: CalendarEntry[];
  summary: {
    totalPosts: number;
    regularPosts: number;
    festivalPosts: number;
    distribution: Record<string, number>; // pillar name -> count
  };
}

// ============================================================================
// GENERATED POST
// ============================================================================

export interface GeneratedCaption {
  caption: string;
  hashtags: string[];
  callToAction?: string;
}

export interface GeneratedPost {
  entryId: string;
  scheduledDate: Date;
  caption: GeneratedCaption;
  imageUrl: string; // S3 URL after upload
  imagePrompt: string; // What was sent to Stable Diffusion
  metadata: {
    contentPillar?: string;
    festival?: string;
    generatedAt: Date;
  };
}

// ============================================================================
// FINAL PIPELINE RESPONSE
// ============================================================================

export interface PipelineResponse {
  campaignId: string;
  strategy: ContentStrategy;
  calendar: ContentCalendar;
  posts: GeneratedPost[];
  summary: {
    totalGenerated: number;
    successCount: number;
    failureCount: number;
    processingTime: number; // milliseconds
  };
}

// ============================================================================
// MODULE-SPECIFIC TYPES
// ============================================================================

// For Image Generation Adapter
export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
}

export interface ImageGenerationResponse {
  imageBuffer: Buffer;
  metadata: {
    model: string;
    seed?: number;
    dimensions: { width: number; height: number };
  };
}

// For S3 Upload
export interface S3UploadRequest {
  buffer: Buffer;
  key: string; // File path in S3
  contentType: string;
  metadata?: Record<string, string>;
}

export interface S3UploadResponse {
  url: string;
  key: string;
  bucket: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AIGenerationError extends Error {
  constructor(message: string, public retryable: boolean = true) {
    super(message);
    this.name = 'AIGenerationError';
  }
}

export class ImageGenerationError extends Error {
  constructor(message: string, public retryable: boolean = true) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}
