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
import { 
  getPostById, 
  updatePost, 
  deletePost as deletePostFromDB,
  getCampaignFromDB,
  savePostsToDB,
  getCalendarEntryById,
  getStrategyFromDB
} from '../db/database';
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

  // Update in database
  const updatedPost = await updatePost(postId, updateData);

  console.log(`[PostManagement] ✓ Post ${postId} updated`);
  return updatedPost;
}

/**
 * Regenerate post content (caption + image)
 * 
 * Now uses persisted calendar entry and strategy for consistency
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

  let calendarItem: CalendarItem;
  let strategy: any;

  // ========================================================================
  // TRY TO FETCH FROM PERSISTED DATA (NEW APPROACH)
  // ========================================================================
  
  try {
    // Attempt to get calendar entry and strategy from DB
    if (existingPost.calendar_entry_id) {
      const calendarEntry = await getCalendarEntryById(existingPost.calendar_entry_id);
      
      calendarItem = {
        date: new Date(calendarEntry.scheduled_date).toISOString().split('T')[0],
        pillar: calendarEntry.pillar,
        topic: calendarEntry.topic,
        content_type: calendarEntry.content_type || 'image',
        is_festival: calendarEntry.is_festival || false,
        festival_name: calendarEntry.festival_name || undefined,
      };
      
      console.log(`[PostManagement] ✓ Loaded calendar entry from DB`);
    } else {
      throw new Error('No calendar_entry_id found');
    }
    
    // Fetch strategy
    if (existingPost.strategy_id) {
      strategy = await getStrategyFromDB(existingPost.strategy_id);
      console.log(`[PostManagement] ✓ Loaded strategy from DB`);
    } else {
      throw new Error('No strategy_id found');
    }
  } catch (error) {
    // ========================================================================
    // FALLBACK: RECONSTRUCT DATA (BACKWARD COMPATIBILITY)
    // ========================================================================
    
    console.warn(`[PostManagement] ⚠ Could not load persisted data, reconstructing:`, error);
    
    // Get campaign data to reconstruct inputs
    const campaignData = await getCampaignFromDB(existingPost.campaign_id);

    // Create calendar item from existing post data
    calendarItem = {
      date: new Date(existingPost.scheduled_date).toISOString().split('T')[0],
      pillar: existingPost.content_pillar || 'General',
      topic: existingPost.topic || existingPost.content_pillar || 'General content',
      content_type: existingPost.content_type || 'image',
      is_festival: existingPost.is_festival || false,
      festival_name: existingPost.festival_name || undefined,
    };

    // Build a basic strategy for regeneration
    strategy = {
      content_pillars: [calendarItem.pillar],
      tone: 'warm and engaging',
      cta_style: 'inviting',
      content_mix: { education: 30, trust: 50, promotion: 20 },
    };
    
    console.warn(`[PostManagement] ⚠ Using reconstructed data (not from source of truth)`);
  }

  // ========================================================================
  // BUILD NORMALIZED INPUT
  // ========================================================================
  
  const campaignData = await getCampaignFromDB(existingPost.campaign_id);

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

  // ========================================================================
  // REGENERATE CAPTION
  // ========================================================================
  
  const newCaption = await generateCaption(calendarItem, strategy, normalizedInput);

  let newImageUrl = existingPost.image_url;
  let imageMetadata = {
    imagePrompt: existingPost.image_prompt,
    imageModel: existingPost.image_model,
  };

  // ========================================================================
  // REGENERATE IMAGE (if requested)
  // ========================================================================
  
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

  // ========================================================================
  // UPDATE POST IN DATABASE
  // ========================================================================
  
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

  // Generate hashtags
  const hashtags = generateHashtags(calendarItem, normalizedInput);
  
  const post: PostItem = {
    entryId: `post-${calendarItem.date.replace(/-/g, '')}`,
    scheduledDate: new Date(calendarItem.date),
    caption: caption,
    hashtags: hashtags,
    callToAction: calendarItem.is_festival ? 'Join us in celebrating!' : 'Learn more about our services',
    imageUrl: imageUrl,
    detailedImagePrompt: imageResult.metadata.prompt || '',
    metadata: {
      contentPillar: calendarItem.is_festival ? undefined : calendarItem.pillar,
      festival: calendarItem.is_festival ? calendarItem.festival_name : undefined,
      topic: calendarItem.topic,
      imageModel: imageResult.metadata.model,
      imageGenerated: true,
      generatedAt: new Date(),
    },
  };

  // Save to database
  const savedIds = await savePostsToDB(campaignId, [post]);

  // Fetch and return the saved post
  const savedPost = await getPostById(savedIds[0]);

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
