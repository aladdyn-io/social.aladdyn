-- ============================================================================
-- Migration 011: Add OAuth social_accounts table
-- Purpose: Store connected social media accounts via OAuth Login flows.
--          Replaces manual credential injection via .env variables.
-- ============================================================================

-- Enum type for supported OAuth platforms
DO $$ BEGIN
  CREATE TYPE "social"."SocialAccountPlatform" AS ENUM ('LINKEDIN', 'INSTAGRAM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Main table: one row per connected account per user
CREATE TABLE IF NOT EXISTS "social"."social_accounts" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"              TEXT NOT NULL,
  "platform"            "social"."SocialAccountPlatform" NOT NULL,

  -- Platform identifiers
  "platformAccountId"   TEXT NOT NULL,  -- IG Business Account ID or LinkedIn member sub
  "authorUrn"           TEXT,           -- LinkedIn posting URN e.g. urn:li:person:xxx
  "accountName"         TEXT NOT NULL,
  "accountHandle"       TEXT,
  "profilePictureUrl"   TEXT,

  -- Encrypted credentials (AES-256-GCM via oauthService)
  "accessToken"         TEXT NOT NULL,
  "refreshToken"        TEXT,
  "tokenExpiresAt"      TIMESTAMPTZ,

  -- Arbitrary platform metadata (e.g. { pageId, pageName })
  "metadata"            JSONB,

  "isActive"            BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "social_accounts_user_platform_account_key"
    UNIQUE ("userId", "platform", "platformAccountId")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "social_accounts_userId_platform_idx"
  ON "social"."social_accounts" ("userId", "platform");

CREATE INDEX IF NOT EXISTS "social_accounts_isActive_idx"
  ON "social"."social_accounts" ("isActive");

-- Auto-update updatedAt
CREATE TRIGGER "update_social_accounts_updated_at"
  BEFORE UPDATE ON "social"."social_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Link campaigns to a connected social account (optional)
ALTER TABLE "social"."social_campaigns"
  ADD COLUMN IF NOT EXISTS "socialAccountId" UUID,
  ADD CONSTRAINT "social_campaigns_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId")
    REFERENCES "social"."social_accounts"("id")
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "social_campaigns_socialAccountId_idx"
  ON "social"."social_campaigns" ("socialAccountId");

-- ============================================================================
-- Security Notes:
--   - accessToken and refreshToken stored AES-256-GCM encrypted
--   - Decryption key lives in OAUTH_ENCRYPTION_KEY env var (never in DB)
--   - LinkedIn refresh tokens valid 365 days; access tokens valid 60 days
--   - Meta Page tokens are indefinitely long-lived (null tokenExpiresAt)
-- ============================================================================
