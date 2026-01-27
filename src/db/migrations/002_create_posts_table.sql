-- ============================================================================
-- Migration: Create posts table
-- Purpose: Store generated social media posts with content and metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS posts (
  -- Primary Key
  post_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  
  -- Scheduling
  scheduled_date DATE NOT NULL,
  scheduled_time TIME, -- Optional: specific time of day
  
  -- Content
  caption TEXT NOT NULL,
  hashtags TEXT[] DEFAULT '{}',
  call_to_action TEXT,
  
  -- Image
  image_url TEXT NOT NULL,
  image_prompt TEXT, -- The prompt used to generate the image
  image_model VARCHAR(100), -- e.g., "FLUX.1-schnell"
  
  -- Metadata
  content_pillar VARCHAR(100), -- e.g., "Education", "Trust", "Promotion"
  topic VARCHAR(255), -- Post topic/title
  content_type VARCHAR(50) DEFAULT 'image', -- image, video, carousel
  is_festival BOOLEAN DEFAULT false,
  festival_name VARCHAR(255),
  
  -- Status tracking
  status VARCHAR(50) DEFAULT 'draft', -- draft, scheduled, published, failed
  published_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT posts_status_check CHECK (status IN ('draft', 'scheduled', 'published', 'failed', 'deleted'))
);

-- Indexes for performance
CREATE INDEX idx_posts_campaign_id ON posts(campaign_id);
CREATE INDEX idx_posts_scheduled_date ON posts(scheduled_date);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_is_festival ON posts(is_festival);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

-- Composite index for common query pattern
CREATE INDEX idx_posts_campaign_date ON posts(campaign_id, scheduled_date);

-- Update timestamp trigger
CREATE TRIGGER update_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Notes:
-- - image_url can be temporary placeholder during generation
-- - status progression: draft -> scheduled -> published
-- - error_message populated only when status = 'failed'
-- - scheduled_time is optional (defaults to morning if not set)
-- ============================================================================
