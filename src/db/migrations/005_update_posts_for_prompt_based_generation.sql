-- ============================================================================
-- Migration: Update posts table for prompt-based image generation
-- Purpose: Support deferred image generation workflow
-- 
-- Changes:
-- 1. Make image_url nullable (image generated on-demand)
-- 2. Add detailed_image_prompt field (store comprehensive prompt)
-- 3. Keep existing image_prompt for backward compatibility
-- ============================================================================

-- Make image_url nullable (since images are generated on-demand)
ALTER TABLE posts 
  ALTER COLUMN image_url DROP NOT NULL;

-- Add detailed_image_prompt field for comprehensive prompt storage
ALTER TABLE posts 
  ADD COLUMN IF NOT EXISTS detailed_image_prompt TEXT;

-- Add comment to clarify field usage
COMMENT ON COLUMN posts.image_url IS 'Public URL of generated image (null until image is generated on-demand)';
COMMENT ON COLUMN posts.image_prompt IS 'Original short prompt used for generation';
COMMENT ON COLUMN posts.detailed_image_prompt IS 'Comprehensive prompt with layout, lighting, text, format specifications';

-- Add index for filtering posts without generated images
CREATE INDEX IF NOT EXISTS idx_posts_needs_image ON posts(post_id) WHERE image_url IS NULL;

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_posts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_posts_timestamp ON posts;
CREATE TRIGGER trigger_update_posts_timestamp
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION update_posts_updated_at();
