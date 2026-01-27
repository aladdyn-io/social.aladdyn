-- ============================================================================
-- Migration: Create scheduled_posts table
-- Purpose: Track posts scheduled for auto-publishing
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_posts (
  -- Primary Key
  schedule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  post_id UUID NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES social_accounts(account_id) ON DELETE CASCADE,
  
  -- Scheduling
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  timezone VARCHAR(100) DEFAULT 'UTC', -- e.g., "Asia/Kolkata"
  
  -- Status tracking
  status VARCHAR(50) DEFAULT 'pending', -- pending, processing, published, failed, cancelled
  
  -- Publishing results
  published_at TIMESTAMP WITH TIME ZONE,
  platform_post_id VARCHAR(255), -- Post ID returned by social platform
  platform_post_url TEXT, -- Public URL to the published post
  
  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT scheduled_posts_status_check CHECK (
    status IN ('pending', 'processing', 'published', 'failed', 'cancelled')
  ),
  CONSTRAINT scheduled_posts_retry_check CHECK (retry_count <= max_retries)
);

-- Indexes for performance
CREATE INDEX idx_scheduled_posts_post_id ON scheduled_posts(post_id);
CREATE INDEX idx_scheduled_posts_account_id ON scheduled_posts(account_id);
CREATE INDEX idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX idx_scheduled_posts_scheduled_time ON scheduled_posts(scheduled_time);

-- Index for job queue processing
CREATE INDEX idx_scheduled_posts_pending ON scheduled_posts(status, scheduled_time) 
  WHERE status = 'pending';

-- Update timestamp trigger
CREATE TRIGGER update_scheduled_posts_updated_at
  BEFORE UPDATE ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Notes:
-- - scheduled_time is when the post should be published
-- - Job queue should query pending posts where scheduled_time <= NOW()
-- - retry_count increments on failure, stops at max_retries
-- - platform_post_id and platform_post_url populated on success
-- ============================================================================
