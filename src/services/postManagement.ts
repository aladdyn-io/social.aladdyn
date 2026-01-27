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
import { generateImage } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import { assemblePost } from './assemblePost';
import { 
  getPostById, 
  updatePost, 
  deletePost as deletePostFromDB,
  getCampaignFromDB,
  savePostsToDB 
} from '../db/database';

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
    hashtags?: string[];
    callToAction?: string;
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
  if (updates.hashtags !== undefined) {
    updateData.hashtags = updates.hashtags;
  }
  if (updates.callToAction !== undefined) {
    updateData.call_to_action = updates.callToAction;
  }

  // Update in database
  const updatedPost = await updatePost(postId, updateData);

  console.log(`[PostManagement] ✓ Post ${postId} updated`);
  return updatedPost;
}

/**
 * Regenerate post content (caption + image)
 * 
 * @param postId - Post ID from database
 * @param regenerateImage - Whether to regenerate image (default: false)
 * @returns Regenerated post
 */
export async function regeneratePost(
  postId: string,
  regenerateImage: boolean = false
): Promise<any> {
  console.log(`[PostManagement] Regenerating post ${postId} (image: ${regenerateImage})...`);

  // Get existing post
  const existingPost = await getPostById(postId);
  if (!existingPost) {
    throw new Error(`Post not found: ${postId}`);
  }

  // Get campaign data to reconstruct inputs
  const campaignData = await getCampaignFromDB(existingPost.campaign_id);

  // Build normalized input
  const normalizedInput: NormalizedInput = {
    industry: campaignData.industry,
    services: campaignData.services,
    geography: campaignData.geography || 'Global',
    posting_days: 0, // Not needed for single post
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
    platform: 'instagram',
  };

  // Create calendar item from existing post data
  const calendarItem: CalendarItem = {
    date: new Date(existingPost.scheduled_date).toISOString().split('T')[0],
    pillar: existingPost.content_pillar || 'General',
    topic: existingPost.topic || existingPost.content_pillar || 'General content',
    content_type: existingPost.content_type || 'image',
    is_festival: existingPost.is_festival || false,
    festival_name: existingPost.festival_name || undefined,
  };

  // Build a basic strategy for regeneration
  const strategy = {
    content_pillars: [calendarItem.pillar],
    tone: 'warm and engaging',
    cta_style: 'inviting',
    content_mix: { education: 30, trust: 50, promotion: 20 },
  };

  // Regenerate caption
  const newCaption = await generateCaption(calendarItem, strategy, normalizedInput);

  let newImageUrl = existingPost.image_url;
  let imageMetadata = {
    imagePrompt: existingPost.image_prompt,
    imageModel: existingPost.image_model,
  };

  // Regenerate image if requested
  if (regenerateImage) {
    const imageResult = await generateImage(calendarItem, normalizedInput);
    const imageUrl = await uploadImageToStorage(
      imageResult,
      existingPost.campaign_id
    );
    newImageUrl = imageUrl;
    imageMetadata = {
      imagePrompt: imageResult.metadata.prompt || '',
      imageModel: imageResult.metadata.model,
    };
  }

  // Update post in database
  const updateData = {
    caption: newCaption,
    image_url: newImageUrl,
    image_prompt: imageMetadata.imagePrompt,
    image_model: imageMetadata.imageModel,
    updated_at: new Date(),
  };

  const updatedPost = await updatePost(postId, updateData);

  console.log(`[PostManagement] ✓ Post ${postId} regenerated`);
  return updatedPost;
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

  // Delete from database
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
    platform: 'instagram',
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

  // Generate image
  const imageResult = await generateImage(calendarItem, normalizedInput);
  const imageUrl = await uploadImageToStorage(
    imageResult,
    campaignId
  );

  // Assemble post
  const post = assemblePost(
    imageUrl,
    caption,
    calendarItem,
    imageResult.metadata.prompt || '',
    imageResult.metadata.model
  );

  // Save to database
  const savedIds = await savePostsToDB(campaignId, [post]);

  // Fetch and return the saved post
  const savedPost = await getPostById(savedIds[0]);

  console.log(`[PostManagement] ✓ Extra post created: ${savedIds[0]}`);
  return savedPost;
}
