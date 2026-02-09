-- ============================================================================
-- Migration: Create strategies table
-- Purpose: Persist AI-generated content strategies for campaigns
-- 
-- WHY: Strategy must be stored to ensure:
-- - Consistency during post regeneration
-- - Audit trail of what strategy was used
-- - Ability to edit/reuse strategies
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategies (
  -- Primary Key
  strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  
  -- Strategy Content (AI-generated)
  content_pillars TEXT[] NOT NULL,
  tone TEXT NOT NULL,
  cta_style TEXT NOT NULL,
  
  -- Content Mix Percentages (must sum to 100)
  content_mix_education INTEGER NOT NULL CHECK (content_mix_education >= 0 AND content_mix_education <= 100),
  content_mix_trust INTEGER NOT NULL CHECK (content_mix_trust >= 0 AND content_mix_trust <= 100),
  content_mix_promotion INTEGER NOT NULL CHECK (content_mix_promotion >= 0 AND content_mix_promotion <= 100),
  
  -- Campaign Phases (Temporal Logic)
  -- JSON array of phases with day ranges and focus areas
  -- Example: [{"dayRange": [1, 7], "focus": "awareness", "contentMixOverride": {...}}]
  campaign_phases JSONB,
  
  -- Metadata
  model_used VARCHAR(100), -- e.g., "gpt-4-turbo-preview"
  generation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT strategies_content_mix_sum_check 
    CHECK (content_mix_education + content_mix_trust + content_mix_promotion = 100)
);

-- Indexes
CREATE INDEX idx_strategies_campaign_id ON strategies(campaign_id);

-- Only one active strategy per campaign
CREATE UNIQUE INDEX idx_strategies_campaign_unique ON strategies(campaign_id);

-- Comments
COMMENT ON TABLE strategies IS 'AI-generated content strategies for campaigns';
COMMENT ON COLUMN strategies.content_pillars IS 'Array of 3-5 content themes relevant to industry';
COMMENT ON COLUMN strategies.campaign_phases IS 'Temporal phases for early/mid/late campaign progression';
COMMENT ON COLUMN strategies.content_mix_education IS 'Percentage of educational content (0-100)';
COMMENT ON COLUMN strategies.content_mix_trust IS 'Percentage of trust-building content (0-100)';
COMMENT ON COLUMN strategies.content_mix_promotion IS 'Percentage of promotional content (0-100)';
