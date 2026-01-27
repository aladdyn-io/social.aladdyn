-- ============================================================================
-- Migration: Create social_accounts table
-- Purpose: Store connected social media account credentials
-- ============================================================================

CREATE TABLE IF NOT EXISTS social_accounts (
  -- Primary Key
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User/Campaign relationship
  user_id UUID,
  campaign_id UUID REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  
  -- Platform information
  platform VARCHAR(50) NOT NULL, -- facebook, instagram, linkedin, twitter
  platform_account_id VARCHAR(255), -- Account ID from the platform
  account_name VARCHAR(255) NOT NULL, -- Display name (e.g., "John's Fitness Page")
  account_handle VARCHAR(255), -- @username or page slug
  
  -- OAuth credentials (encrypted in production)
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Account metadata
  profile_picture_url TEXT,
  follower_count INTEGER,
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT social_accounts_platform_check CHECK (
    platform IN ('facebook', 'instagram', 'linkedin', 'twitter', 'threads')
  ),
  CONSTRAINT social_accounts_unique_platform UNIQUE (platform, platform_account_id)
);

-- Indexes
CREATE INDEX idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX idx_social_accounts_campaign_id ON social_accounts(campaign_id);
CREATE INDEX idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX idx_social_accounts_is_active ON social_accounts(is_active);

-- Update timestamp trigger
CREATE TRIGGER update_social_accounts_updated_at
  BEFORE UPDATE ON social_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Security Notes:
-- - access_token and refresh_token should be encrypted at rest
-- - Consider using PostgreSQL pgcrypto extension for encryption
-- - Tokens should be rotated regularly
-- - Never log or expose tokens in API responses
-- ============================================================================
