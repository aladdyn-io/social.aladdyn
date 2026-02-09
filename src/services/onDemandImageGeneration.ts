/**
 * On-Demand Image Generation Service
 * 
 * Generates image for a specific post using its detailed prompt.
 * This is called when user requests image generation for a specific date/post.
 */

import { generateImage, ImageGenerationResult } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import { getPostById, updatePostImage } from '../db/database';

/**
 * Generate image for a specific post on-demand
 * 
 * Workflow:
 * 1. Fetch post from database (get detailed_image_prompt)
 * 2. Generate image using the prompt
 * 3. Upload image to storage
 * 4. Update database with image URL
 * 
 * @param postId - UUID of the post to generate image for
 * @returns Public URL of generated image
 */
export async function generatePostImage(postId: string): Promise<string> {
  console.log(`[OnDemandImage] Generating image for post: ${postId}`);

  try {
    // ========================================================================
    // STEP 1: FETCH POST DATA
    // ========================================================================
    
    const post = await getPostById(postId);

    if (!post.detailed_image_prompt) {
      throw new Error('Post does not have a detailed image prompt');
    }

    if (post.image_url) {
      console.log(`[OnDemandImage] ⚠️  Post already has an image: ${post.image_url}`);
      return post.image_url;
    }

    console.log(`[OnDemandImage] ✓ Post fetched, prompt length: ${post.detailed_image_prompt.length} chars`);

    // ========================================================================
    // STEP 2: GENERATE IMAGE
    // ========================================================================
    
    console.log(`[OnDemandImage] Generating image from prompt...`);
    
    // Build calendar item from post data
    const calendarItem = {
      date: new Date(post.scheduled_date).toISOString().split('T')[0],
      pillar: post.content_pillar || 'General',
      topic: post.topic || '',
      content_type: 'image' as const,
      is_festival: post.is_festival || false,
      festival_name: post.festival_name || undefined,
    };
    
    // Build normalized input
    const normalizedInput: any = {
      industry: 'Generic',
      services: [],
      geography: 'Global',
      accent_color: '#667eea',
      base_color: '#764ba2',
    };

    const imageResult: ImageGenerationResult = await generateImage(calendarItem, normalizedInput);
    console.log(`[OnDemandImage] ✓ Image generated (${imageResult.metadata.model})`);

    // ========================================================================
    // STEP 3: UPLOAD TO STORAGE
    // ========================================================================
    
    const imageUrl = await uploadImageToStorage(imageResult, `posts/${postId}/`);
    console.log(`[OnDemandImage] ✓ Image uploaded: ${imageUrl}`);

    // ========================================================================
    // STEP 4: UPDATE DATABASE
    // ========================================================================
    
    await updatePostImage(postId, imageUrl, imageResult.metadata.model);
    console.log(`[OnDemandImage] ✓ Database updated with image URL`);

    console.log(`[OnDemandImage] ✅ Image generation complete for post ${postId}`);
    return imageUrl;

  } catch (error) {
    console.error(`[OnDemandImage] ✗ Failed to generate image for post ${postId}:`, error);
    throw new Error(
      `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Batch generate images for multiple posts
 * 
 * @param postIds - Array of post UUIDs
 * @returns Map of postId -> imageUrl (or error message)
 */
export async function generatePostImages(
  postIds: string[]
): Promise<Map<string, { success: boolean; imageUrl?: string; error?: string }>> {
  console.log(`[OnDemandImage] Batch generating images for ${postIds.length} posts`);

  const results = new Map<string, { success: boolean; imageUrl?: string; error?: string }>();

  for (const [index, postId] of postIds.entries()) {
    console.log(`[OnDemandImage] [${index + 1}/${postIds.length}] Processing post ${postId}...`);

    try {
      const imageUrl = await generatePostImage(postId);
      results.set(postId, { success: true, imageUrl });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[OnDemandImage] Failed for post ${postId}:`, errorMessage);
      results.set(postId, { success: false, error: errorMessage });
    }
  }

  const successCount = Array.from(results.values()).filter(r => r.success).length;
  console.log(`[OnDemandImage] ✓ Batch complete: ${successCount}/${postIds.length} succeeded`);

  return results;
}
