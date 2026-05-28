/**
 * Post Management Service
 * 
 * Handles CRUD operations for posts:
 * - Edit post caption/image
 * - Regenerate post content
 * - Delete post
 * - Add extra post for specific date
 */

import { PostItem, CalendarItem } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { generateCaption } from './generateCaption';
import { generateDetailedImagePrompt } from './generateImagePrompt';
import { generateImage } from './imageGenerator';
import { uploadImageToStorage, deleteFolderFromStorage } from './objectStorage';
import { generatePostImage } from './onDemandImageGeneration';
import {
  getPostById,
  updatePost,
  deletePost as deletePostFromDB,
  getCampaignFromDB,
  getStrategyByCampaignId,
  savePostsToDB,
} from '../db/database';
import prisma from '../lib/prisma';
import cache, { CacheKey } from './cache';

/**
 * Edit post caption and/or image URL
 * 
 * @param postId - Post ID from database
 * @param updates - Fields to update (caption, imageUrl)
 * @returns Updated post
 */
export async function editPost(
  postId: string,
  updates: {
    caption?: string;
    imageUrl?: string;
    imagePrompt?: string;
    hashtags?: string[];
    callToAction?: string;
    scheduledDate?: string | Date;
    scheduledTime?: string;
  }
): Promise<any> {
  console.log(`[PostManagement] Editing post ${postId}...`);

  // Validate that post exists
  const existingPost = await getPostById(postId);
  if (!existingPost) {
    throw new Error(`Post not found: ${postId}`);
  }

  // Update fields
  const updateData: any = {
    updated_at: new Date(),
  };

  if (updates.caption !== undefined) {
    updateData.caption = updates.caption;
  }
  if (updates.imageUrl !== undefined) {
    updateData.image_url = updates.imageUrl;
  }
  if (updates.imagePrompt !== undefined) {
    updateData.image_prompt = updates.imagePrompt;
  }
  if (updates.hashtags !== undefined) {
    updateData.hashtags = updates.hashtags;
  }
  if (updates.callToAction !== undefined) {
    updateData.call_to_action = updates.callToAction;
  }
  if (updates.scheduledDate !== undefined) {
    updateData.scheduledDate = new Date(updates.scheduledDate);
  }
  if (updates.scheduledTime !== undefined) {
    updateData.scheduledTime = updates.scheduledTime;
  }

  // Update in database
  const updatedPost = await updatePost(postId, updateData);

  console.log(`[PostManagement] ✓ Post ${postId} updated`);
  return updatedPost;
}

/**
 * Regenerate post content (caption and/or image prompt and/or image)
 *
 * Uses the campaign's persisted strategy from DB for consistency.
 *
 * @param postId - Post ID from database
 * @param options.regenerateCaption - Regenerate caption (default: true)
 * @param options.regeneratePrompt  - Regenerate image prompt only (default: false)
 * @param options.regenerateImage   - Regenerate image prompt + generate actual image (default: false)
 * @param options.feedback          - Optional user feedback to steer regeneration (default: undefined)
 * @param options.templateStyle     - Optional premium template style (default: undefined)
 */
export async function regeneratePost(
  postId: string,
  options: {
    regenerateCaption?: boolean;
    regeneratePrompt?: boolean;
    regenerateImage?: boolean;
    feedback?: string;
    templateStyle?: 'glass' | 'bold' | 'elegant';
  } = {}
): Promise<any> {
  const {
    regenerateCaption = true,
    regeneratePrompt = false,
    regenerateImage = false,
    feedback,
    templateStyle,
  } = options;

  console.log(
    `[PostManagement] Regenerating post ${postId} (caption:${regenerateCaption} prompt:${regeneratePrompt} image:${regenerateImage} feedback:${feedback ? feedback.substring(0, 30) + '...' : 'none'} templateStyle:${templateStyle || 'none'})...`
  );

  // Get existing post
  const existingPost = await getPostById(postId);
  if (!existingPost) {
    throw new Error(`Post not found: ${postId}`);
  }

  // ========================================================================
  // RECONSTRUCT CALENDAR ITEM FROM POST DATA
  // ========================================================================

  const calendarItem: CalendarItem = {
    date: new Date(existingPost.scheduledDate).toISOString().split('T')[0],
    pillar: existingPost.contentPillar || 'General',
    topic: existingPost.topic || existingPost.contentPillar || 'General content',
    content_type: existingPost.contentType || 'photo',
    is_festival: existingPost.isFestival || false,
    festival_name: existingPost.festivalName || undefined,
  };

  // ========================================================================
  // LOAD REAL STRATEGY FROM DB (fall back to sensible defaults if missing)
  // ========================================================================

  const savedStrategy = await getStrategyByCampaignId(existingPost.campaignId);
  const strategy = savedStrategy ?? {
    content_pillars: [calendarItem.pillar],
    tone: 'warm and engaging',
    cta_style: 'inviting',
    content_mix: { education: 30, trust: 50, promotion: 20 },
  };

  // ========================================================================
  // BUILD NORMALIZED INPUT
  // ========================================================================

  const campaignData = await getCampaignFromDB(existingPost.campaignId);

  const normalizedInput: NormalizedInput = {
    industry: campaignData.industry,
    services: campaignData.services,
    geography: campaignData.geography || 'Global',
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
    platform: campaignData.platform ?? existingPost.platform ?? 'instagram',
    timezone: campaignData.timezone ?? 'Asia/Kolkata',
    scheduledTime: campaignData.scheduledTime ?? '10:00',
  };

  const updateData: Record<string, any> = {};

  // ========================================================================
  // REGENERATE CAPTION
  // ========================================================================

  if (regenerateCaption) {
    updateData.caption = await generateCaption(calendarItem, strategy, normalizedInput, undefined, feedback);
  }

  // ========================================================================
  // REGENERATE IMAGE PROMPT (without generating the actual image)
  // ========================================================================

  if (regeneratePrompt && !regenerateImage) {
    updateData.imagePrompt = await generateDetailedImagePrompt(
      calendarItem,
      strategy,
      normalizedInput,
      feedback
    );
  }

  // ========================================================================
  // REGENERATE IMAGE PROMPT + GENERATE ACTUAL IMAGE
  // ========================================================================

  if (regenerateImage) {
    const newPrompt = await generateDetailedImagePrompt(
      calendarItem,
      strategy,
      normalizedInput,
      feedback
    );
    updateData.imagePrompt = newPrompt;
  }

  // If we only regenerated the caption or prompt (but NOT the actual image), we do a standard DB update.
  if (!regenerateImage) {
    if (Object.keys(updateData).length === 0) {
      return existingPost; // Nothing to do
    }
    const updatedPost = await updatePost(postId, updateData);
    console.log(`[PostManagement] ✓ Post ${postId} regenerated (metadata only)`);
    return updatedPost;
  } else {
    // If regenerating the actual image, we save the new caption/prompt to DB first,
    // and then call the premium composite on-demand generation pipeline.
    await updatePost(postId, updateData);
    console.log(`[PostManagement] Saved new prompt/metadata for ${postId}. Triggering premium media generation...`);

    const { isVideoContentType, generatePostVideo } = await import('./onDemandVideoGeneration');
    const mediaUrl = isVideoContentType(existingPost.contentType)
      ? await generatePostVideo(postId, true)
      : await generatePostImage(postId, false, true, templateStyle, undefined, feedback);

    console.log(`[PostManagement] ✓ Post ${postId} fully regenerated with premium composited ad layout: ${mediaUrl}`);
    return getPostById(postId);
  }
}

/**
 * Regenerate all DRAFT posts in a campaign using the existing strategy.
 *
 * DRAFT posts get new captions + image prompts.
 * APPROVED / SCHEDULED / POSTED posts are never touched.
 *
 * @param campaignId - Campaign to regenerate
 * @returns Count of regenerated and skipped posts
 */
export async function regenerateCampaignPosts(
  campaignId: string
): Promise<{ regenerated: number; skipped: number }> {
  console.log(`[PostManagement] Regenerating all DRAFT posts for campaign ${campaignId}...`);

  // Load campaign data + strategy once
  const campaignData = await getCampaignFromDB(campaignId);
  const savedStrategy = await getStrategyByCampaignId(campaignId);
  const strategy = savedStrategy ?? {
    content_pillars: ['General'],
    tone: 'warm and engaging',
    cta_style: 'inviting',
    content_mix: { education: 30, trust: 50, promotion: 20 },
  };

  const normalizedInput: NormalizedInput = {
    industry: campaignData.industry,
    services: campaignData.services,
    geography: campaignData.geography || 'Global',
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
    platform: campaignData.platform ?? 'instagram',
    timezone: campaignData.timezone ?? 'Asia/Kolkata',
    scheduledTime: campaignData.scheduledTime ?? '10:00',
  };

  // Fetch only DRAFT posts — never touch approved/scheduled/posted ones
  const draftPosts = await prisma.socialPost.findMany({
    where: { campaignId, status: 'DRAFT' },
    orderBy: { scheduledDate: 'asc' },
  });

  if (draftPosts.length === 0) {
    console.log(`[PostManagement] No DRAFT posts to regenerate for campaign ${campaignId}`);
    return { regenerated: 0, skipped: 0 };
  }

  console.log(`[PostManagement] Regenerating ${draftPosts.length} DRAFT posts...`);

  let regenerated = 0;
  let skipped = 0;

  // Process in batches of 5 (same as generatePosts)
  const batchSize = 5;
  for (let i = 0; i < draftPosts.length; i += batchSize) {
    const batch = draftPosts.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (post) => {
        try {
          const calendarItem: CalendarItem = {
            date: new Date(post.scheduledDate).toISOString().split('T')[0],
            pillar: post.contentPillar || 'General',
            topic: post.topic || post.contentPillar || 'General content',
            content_type: post.contentType || 'photo',
            is_festival: post.isFestival || false,
            festival_name: post.festivalName || undefined,
          };

          const [newCaption, newPrompt] = await Promise.all([
            generateCaption(calendarItem, strategy, normalizedInput),
            generateDetailedImagePrompt(calendarItem, strategy, normalizedInput),
          ]);

          await updatePost(post.id, { caption: newCaption, imagePrompt: newPrompt });
          regenerated++;
        } catch (err) {
          console.error(
            `[PostManagement] Failed to regenerate post ${post.id}:`,
            err instanceof Error ? err.message : String(err)
          );
          skipped++;
        }
      })
    );
    // Brief pause between batches
    if (i + batchSize < draftPosts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    `[PostManagement] ✓ Campaign regeneration complete: ${regenerated} regenerated, ${skipped} skipped`
  );
  return { regenerated, skipped };
}

/**
 * Delete post from database
 * 
 * @param postId - Post ID from database
 * @returns Success status
 */
export async function deletePost(postId: string): Promise<boolean> {
  console.log(`[PostManagement] Deleting post ${postId}...`);

  // Verify post exists
  const existingPost = await getPostById(postId);
  if (!existingPost) {
    throw new Error(`Post not found: ${postId}`);
  }

  // 1. Delete associated media from MinIO object storage (composite + subject mask)
  try {
    await deleteFolderFromStorage(`posts/${postId}/`);
  } catch (err: any) {
    console.error(`[PostManagement] ⚠ MinIO deletion failed during post delete: ${err.message}`);
  }

  // 2. Delete from database
  await deletePostFromDB(postId);

  console.log(`[PostManagement] ✓ Post ${postId} deleted`);
  return true;
}

/**
 * Add extra post for specific date
 * 
 * @param campaignId - Campaign ID
 * @param date - Date for new post (YYYY-MM-DD)
 * @param options - Optional post customization
 * @returns Created post
 */
export async function addExtraPost(
  campaignId: string,
  date: string,
  options: {
    pillar?: string;
    topic?: string;
    isFestival?: boolean;
    festivalName?: string;
  } = {}
): Promise<any> {
  console.log(`[PostManagement] Adding extra post for campaign ${campaignId} on ${date}...`);

  // Get campaign data
  const campaignData = await getCampaignFromDB(campaignId);

  // Build normalized input
  const normalizedInput: NormalizedInput = {
    industry: campaignData.industry,
    services: campaignData.services,
    geography: campaignData.geography || 'Global',
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
    platform: campaignData.platform ?? 'instagram',
    timezone: campaignData.timezone ?? 'Asia/Kolkata',
    scheduledTime: campaignData.scheduledTime ?? '10:00',
  };

  // Create calendar item
  const calendarItem: CalendarItem = {
    date,
    pillar: options.pillar || 'General',
    topic: options.topic || `${options.pillar || 'General'} content highlighting ${campaignData.services[0]}`,
    content_type: 'image',
    is_festival: options.isFestival || false,
    festival_name: options.festivalName,
  };

  // Build strategy
  const strategy = {
    content_pillars: [options.pillar || 'General'],
    tone: 'warm and engaging',
    cta_style: 'inviting',
    content_mix: { education: 30, trust: 50, promotion: 20 },
  };

  // Generate caption
  const caption = await generateCaption(calendarItem, strategy, normalizedInput);

  // Generate detailed image prompt using our LLM prompt generator (with color and geography infusion!)
  const detailedPrompt = await generateDetailedImagePrompt(
    calendarItem,
    strategy,
    normalizedInput
  );

  // Generate hashtags
  const hashtags = generateHashtags(calendarItem, normalizedInput);
  
  const post: PostItem = {
    entryId: `post-${calendarItem.date.replace(/-/g, '')}`,
    scheduledDate: new Date(calendarItem.date),
    caption: caption,
    hashtags: hashtags,
    callToAction: calendarItem.is_festival ? 'Join us in celebrating!' : 'Learn more about our services',
    imageUrl: '',
    detailedImagePrompt: detailedPrompt,
    metadata: {
      contentPillar: calendarItem.is_festival ? undefined : calendarItem.pillar,
      festival: calendarItem.is_festival ? calendarItem.festival_name : undefined,
      topic: calendarItem.topic,
      imageGenerated: false,
      generatedAt: new Date(),
    },
  };

  // Save to database
  const savedIds = await savePostsToDB(
    campaignId,
    [post],
    normalizedInput.platform,
    normalizedInput.scheduledTime,
    normalizedInput.timezone
  );

  const newPostId = savedIds[0];
  console.log(`[PostManagement] Saved extra post ${newPostId} skeleton. Debiting 1 regeneration token...`);
  
  const { debitToken, refundToken } = await import('./tokenService');
  await debitToken(campaignId, newPostId);

  try {
    // Now run the premium on-demand image generation loop (saliency, color sampling, depth mask, Layout Director, Playwright compositor)
    await generatePostImage(newPostId, false, true);
  } catch (genErr: any) {
    console.error(`[PostManagement] Failed to generate image for extra post, refunding token...`);
    await refundToken(campaignId, newPostId);
    throw genErr;
  }

  // Fetch and return the saved post
  const savedPost = await getPostById(newPostId);

  console.log(`[PostManagement] ✓ Extra post created: ${savedIds[0]}`);
  return savedPost;
}

/**
 * Generate relevant hashtags for a post
 * WHY: Hashtags improve discoverability on social media
 */
function generateHashtags(entry: CalendarItem, input: NormalizedInput): string[] {
  const hashtags: string[] = [];
  
  // Industry/business hashtag
  const industryTag = input.industry.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
  if (industryTag) hashtags.push(`#${industryTag}`);
  
  // Service hashtags (first 2)
  input.services.slice(0, 2).forEach(service => {
    const serviceTag = service.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (serviceTag) hashtags.push(`#${serviceTag}`);
  });
  
  // Festival hashtag if applicable
  if (entry.is_festival && entry.festival_name) {
    const festivalTag = entry.festival_name.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (festivalTag) hashtags.push(`#${festivalTag}`);
  }
  
  // Geography hashtag
  if (input.geography !== 'Global') {
    const geoTag = input.geography.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (geoTag) hashtags.push(`#${geoTag}`);
  }
  
  // Generic social media hashtags
  hashtags.push('#SocialMedia');
  
  return hashtags.slice(0, 7); // Max 7 hashtags
}
