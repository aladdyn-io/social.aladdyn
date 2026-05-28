-- Migration: Add video generation fields to social_posts
-- Purely additive — existing rows default to media_type='image', is_fallback=false

ALTER TABLE social.social_posts
  ADD COLUMN IF NOT EXISTS video_prompt  TEXT,
  ADD COLUMN IF NOT EXISTS media_type    TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS is_fallback   BOOLEAN NOT NULL DEFAULT false;
