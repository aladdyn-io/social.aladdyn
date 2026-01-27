-- ============================================================================
-- Migration: Create campaigns table
-- Purpose: Store campaign configuration and metadata
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
  -- Primary Key
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User/Organization
  user_id UUID,
  organization_name VARCHAR(255),
  
  -- Campaign Configuration
  industry VARCHAR(100) NOT NULL,
  total_days INTEGER NOT NULL CHECK (total_days > 0),
  frequency_per_week INTEGER NOT NULL CHECK (frequency_per_week BETWEEN 1 AND 7),
  festival_enabled BOOLEAN DEFAULT true,
  geography VARCHAR(100) DEFAULT 'India',
  
  -- Branding
  logo_url TEXT,
  font_style VARCHAR(100),
  accent_color VARCHAR(7), -- Hex color code
  base_color VARCHAR(7),   -- Hex color code
  
  -- Services (PostgreSQL array type)
  services TEXT[] NOT NULL,
  
  -- Metadata
  status VARCHAR(50) DEFAULT 'active', -- active, paused, completed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_hex_accent CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT valid_hex_base CHECK (base_color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Indexes for performance
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_created_at ON campaigns(created_at DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Sample Data (for testing)
-- ============================================================================

INSERT INTO campaigns (
  campaign_id,
  industry,
  total_days,
  frequency_per_week,
  festival_enabled,
  logo_url,
  font_style,
  accent_color,
  base_color,
  services,
  geography
) VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid, -- Valid UUID format
  'Fitness',
  30,
  3,
  true,
  'https://example.com/logo.png',
  'Roboto',
  '#FF6B35',
  '#004E89',
  ARRAY['Personal Training', 'Nutrition Coaching', 'Group Classes'],
  'India'
) ON CONFLICT (campaign_id) DO NOTHING;
