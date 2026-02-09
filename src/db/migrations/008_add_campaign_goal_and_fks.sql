-- ============================================================================
-- Migration: Add campaign_goal and link posts to calendar entries
-- Purpose: Add strategic goal to campaigns and proper foreign key relationships
-- 
-- WHY:
-- - Campaign goal determines strategy (awareness vs conversion require different content)
-- - Posts must reference calendar entries (single source of truth)
-- - Proper cascade behavior for deletions
-- ============================================================================

-- Add campaign_goal to campaigns table
ALTER TABLE campaigns 
  ADD COLUMN IF NOT EXISTS campaign_goal VARCHAR(50) DEFAULT 'awareness';

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_goal_check 
    CHECK (campaign_goal IN ('awareness', 'consideration', 'conversion', 'retention'));

COMMENT ON COLUMN campaigns.campaign_goal IS 'Primary objective: awareness, consideration, conversion, or retention';

-- Add calendar_entry_id to posts table
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS calendar_entry_id UUID REFERENCES calendar_entries(entry_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_calendar_entry_id ON posts(calendar_entry_id);

COMMENT ON COLUMN posts.calendar_entry_id IS 'Reference to calendar entry (single source of truth)';

-- Add strategy_id to posts for quick reference
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES strategies(strategy_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_strategy_id ON posts(strategy_id);

COMMENT ON COLUMN posts.strategy_id IS 'Strategy used to generate this post (for consistency)';
