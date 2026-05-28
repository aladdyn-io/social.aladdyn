/**
 * Calendar Post Service
 *
 * Two entry points for adding posts to the content calendar:
 *   1. generateAiPostForDate  — AI generates caption + image prompt (no image)
 *   2. createManualPostForDate — User supplies all content directly
 */

import { CalendarItem } from '../types/content';
import { ManualPostData } from '../types/calendar';
import { NormalizedInput } from './normalizeInput';
import { generateCaption } from './generateCaption';
import { generateDetailedImagePrompt } from './generateImagePrompt';
import { generateDetailedVideoPrompt } from './generateVideoPrompt';
import {
  getCampaignFromDB,
  getStrategyByCampaignId,
  createManualPost,
} from '../db/database';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { ApiErrorCode } from '../types/api';

/** Generate relevant hashtags for a post (mirrors generatePosts.ts logic) */
function generateHashtags(entry: CalendarItem, input: NormalizedInput): string[] {
  const hashtags: string[] = [];
  const industryTag = input.industry.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (industryTag) hashtags.push(`#${industryTag}`);
  input.services.slice(0, 2).forEach(service => {
    const tag = service.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (tag) hashtags.push(`#${tag}`);
  });
  if (entry.is_festival && entry.festival_name) {
    const tag = entry.festival_name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (tag) hashtags.push(`#${tag}`);
  }
  if (input.geography !== 'Global') {
    const tag = input.geography.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (tag) hashtags.push(`#${tag}`);
  }
  hashtags.push('#SocialMedia');
  return hashtags.slice(0, 7);
}

/**
 * Generate an AI-authored post for a specific calendar date.
 *
 * Produces caption + image prompt using the campaign's saved strategy.
 * Does NOT generate an actual image — use POST /posts/:id/generate-image
 * after creation.
 *
 * @param campaignId - Campaign to attach the post to
 * @param date       - YYYY-MM-DD target date
 * @param opts       - Optional pillar/topic overrides
 */
export async function generateAiPostForDate(
  campaignId: string,
  date: string,
  opts: { pillar?: string; topic?: string; platform?: string; contentType?: string; scheduledTime?: string } = {}
): Promise<any> {
  console.log(`[CalendarPost] Generating AI post for campaign ${campaignId} on ${date}`);

  const campaignData = await getCampaignFromDB(campaignId);

  // Use the real saved strategy (not a hardcoded fallback)
  const savedStrategy = await getStrategyByCampaignId(campaignId);
  const strategy = savedStrategy ?? {
    content_pillars: ['General'],
    tone: 'warm and engaging',
    cta_style: 'inviting',
    content_mix: { education: 30, trust: 50, promotion: 20 },
  };

  const pillar = opts.pillar ?? strategy.content_pillars[0] ?? 'General';
  const topic =
    opts.topic ??
    `${pillar} content for ${campaignData.industry || 'your business'}`;

  const calendarItem: CalendarItem = {
    date,
    pillar,
    topic,
    content_type: opts.contentType ?? 'photo',
    is_festival: false,
    platform: opts.platform ?? campaignData.platform ?? 'instagram',
  };

  const normalizedInput: NormalizedInput = {
    industry: campaignData.industry,
    services: campaignData.services,
    geography: campaignData.geography || 'India',
    posting_days: 0,
    base_color: campaignData.base_color || '#000000',
    accent_color: campaignData.accent_color || '#FFFFFF',
    total_days: 1,
    frequency_per_week: 1,
    festival_enabled: false,
    logo_url: '',
    font_style: 'modern',
    brand_stage: 'growing',
    trust_weight: 50,
    education_weight: 30,
    promo_weight: 20,
    platform: opts.platform ?? campaignData.platform ?? 'instagram',
    timezone: campaignData.timezone ?? 'Asia/Kolkata',
    scheduledTime: opts.scheduledTime ?? campaignData.scheduledTime ?? '10:00',
  };

  // Generate caption and image prompt in parallel
  const [caption, imagePrompt] = await Promise.all([
    generateCaption(calendarItem, strategy, normalizedInput),
    generateDetailedImagePrompt(calendarItem, strategy, normalizedInput),
  ]);

  const post = await createManualPost(campaignId, {
    scheduledDate: new Date(date),
    scheduledTime: opts.scheduledTime ?? normalizedInput.scheduledTime,
    platform: opts.platform ?? normalizedInput.platform,
    contentType: opts.contentType ?? 'photo',
    topic,
    caption,
    hashtags: generateHashtags(calendarItem, normalizedInput),
    contentPillar: pillar,
    imageUrl: undefined,
  } as ManualPostData);

  // Persist the AI-generated image prompt
  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: { imagePrompt },
  });

  // Debit 1 token for manual AI post creation
  const { debitToken } = await import('./tokenService');
  try {
    await debitToken(campaignId, updated.id);
  } catch (tokenErr) {
    // Cleanup: delete the created post record since the debit failed
    await prisma.socialPost.delete({ where: { id: updated.id } }).catch(() => null);
    throw tokenErr;
  }

  console.log(`[CalendarPost] ✓ AI post created: ${updated.id}`);
  return updated;
}

/**
 * Save a fully user-supplied post for a specific calendar date.
 *
 * No AI generation — all content comes from the caller.
 * Returns the created DRAFT post.
 *
 * @param campaignId - Campaign to attach the post to
 * @param date       - YYYY-MM-DD target date
 * @param data       - Post content and scheduling metadata
 */
export async function createManualPostForDate(
  campaignId: string,
  date: string,
  data: ManualPostData
): Promise<any> {
  console.log(`[CalendarPost] Creating manual post for campaign ${campaignId} on ${date}`);

  // Validate campaign exists
  const campaign = await prisma.socialCampaign
    .findUnique({ where: { id: campaignId }, select: { id: true } })
    .catch(() => null);

  if (!campaign) {
    throw new AppError(ApiErrorCode.CAMPAIGN_NOT_FOUND, `Campaign not found: ${campaignId}`, 404);
  }

  const post = await createManualPost(campaignId, {
    ...data,
    scheduledDate: new Date(date),
  });

  // Debit 1 token for manual post creation
  const { debitToken } = await import('./tokenService');
  try {
    await debitToken(campaignId, post.id);
  } catch (tokenErr) {
    // Cleanup: delete the created post record since the debit failed
    await prisma.socialPost.delete({ where: { id: post.id } }).catch(() => null);
    throw tokenErr;
  }

  console.log(`[CalendarPost] ✓ Manual post created: ${post.id}`);
  return post;
}
