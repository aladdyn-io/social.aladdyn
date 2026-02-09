-- ============================================================================
-- Migration: Create calendar_entries table
-- Purpose: Persist content calendar as single source of truth
-- 
-- WHY: Calendar must be stored to ensure:
-- - Single source of truth for date/pillar/topic mappings
-- - Posts can reference calendar entries instead of reconstructing
-- - Calendar can be edited without breaking posts
-- - CRUD operations work correctly
-- ============================================================================

CREATE TABLE IF NOT EXISTS calendar_entries (
  -- Primary Key
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES strategies(strategy_id) ON DELETE SET NULL,
  
  -- Scheduling
  scheduled_date DATE NOT NULL,
  day_number INTEGER NOT NULL, -- Day within campaign (1-based)
  
  -- Content Planning
  pillar VARCHAR(255) NOT NULL,
  topic TEXT NOT NULL,
  content_type VARCHAR(50) DEFAULT 'image',
  
  -- Festival Integration
  is_festival BOOLEAN DEFAULT false,
  festival_name VARCHAR(255),
  festival_category VARCHAR(100), -- e.g., "national", "religious", "cultural"
  
  -- Campaign Phase Context
  campaign_phase VARCHAR(50), -- e.g., "awareness", "consideration", "conversion"
  
  -- Status
  status VARCHAR(50) DEFAULT 'planned', -- planned, generated, published, skipped
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT calendar_entries_status_check 
    CHECK (status IN ('planned', 'generated', 'published', 'skipped', 'deleted'))
);

-- Indexes for performance
CREATE INDEX idx_calendar_entries_campaign_id ON calendar_entries(campaign_id);
CREATE INDEX idx_calendar_entries_scheduled_date ON calendar_entries(scheduled_date);
CREATE INDEX idx_calendar_entries_strategy_id ON calendar_entries(strategy_id);
CREATE INDEX idx_calendar_entries_day_number ON calendar_entries(campaign_id, day_number);

-- Unique constraint: one entry per campaign per date
CREATE UNIQUE INDEX idx_calendar_entries_campaign_date 
  ON calendar_entries(campaign_id, scheduled_date);

-- Update trigger
CREATE OR REPLACE FUNCTION update_calendar_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_calendar_entries_timestamp ON calendar_entries;
CREATE TRIGGER trigger_update_calendar_entries_timestamp
  BEFORE UPDATE ON calendar_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_entries_updated_at();

-- Comments
COMMENT ON TABLE calendar_entries IS 'Content calendar - single source of truth for scheduled posts';
COMMENT ON COLUMN calendar_entries.day_number IS 'Day number within campaign for temporal phase logic';
COMMENT ON COLUMN calendar_entries.campaign_phase IS 'Which phase of campaign this entry belongs to';
COMMENT ON COLUMN calendar_entries.topic IS 'AI-generated topic specific to this date/context';
