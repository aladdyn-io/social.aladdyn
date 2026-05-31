/**
 * Generate Image For Post Service
 * 
 * Generates an image on-demand for a specific post using its stored prompt.
 * This is called when the user clicks "Generate Image" for a specific post.
 * 
 * NEW WORKFLOW:
 * 1. Fetch post from database (with image_prompt)
 * 2. Generate image using the stored prompt
 * 3. Upload image to storage
 * 4. Update post with image_url and image_status
 */

import { updatePostImage } from '../db/database';
import { generateImage, generateImageFromPrompt, ImageGenerationResult } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

export interface GenerateImageResult {
  postId: string;
  imageUrl: string;
  imageModel: string;
  imagePrompt: string;
}

/**
 * Generates image for a specific post using its stored prompt
 * 
 * @param postId - UUID of the post
 * @returns Generated image URL and metadata
 * @throws Error if post not found or image generation fails
 */
export async function generateImageForPost(postId: string): Promise<GenerateImageResult> {
  console.log(`[GenerateImageForPost] Processing post: ${postId}`);

  // ========================================================================
  // STEP 1: FETCH POST FROM DATABASE
  // ========================================================================
  
  const postQuery = `
    SELECT 
      post_id,
      image_prompt,
      image_url,
      image_status,
      topic,
      caption
    FROM posts
    WHERE post_id = $1
  `;

  const postResult = await pool.query(postQuery, [postId]);

  if (postResult.rows.length === 0) {
    throw new Error(`Post not found: ${postId}`);
  }

  const post = postResult.rows[0];

  if (!post.image_prompt) {
    throw new Error(`Post ${postId} has no image prompt. Cannot generate image.`);
  }

  // Check if image already exists
  if (post.image_url && post.image_status === 'completed') {
    console.log(`[GenerateImageForPost] ⚠ Image already exists for post ${postId}`);
    return {
      postId: post.post_id,
      imageUrl: post.image_url,
      imageModel: 'already-generated',
      imagePrompt: post.image_prompt,
    };
  }

  console.log(`[GenerateImageForPost] Using prompt: ${post.image_prompt.substring(0, 100)}...`);

  // ========================================================================
  // STEP 2: UPDATE STATUS TO 'GENERATING'
  // ========================================================================
  
  await pool.query(
    `UPDATE posts SET image_status = 'generating', updated_at = NOW() WHERE post_id = $1`,
    [postId]
  );

  try {
    // ======================================================================
    // STEP 3: GENERATE IMAGE
    // ======================================================================
    
    console.log(`[GenerateImageForPost] Generating image from prompt...`);
    
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

    let imageResult: ImageGenerationResult;
    if (post.image_prompt) {
      console.log(`[GenerateImageForPost] Generating image using stored rich visual prompt...`);
      imageResult = await generateImageFromPrompt(post.image_prompt);
    } else {
      console.log(`[GenerateImageForPost] No stored rich prompt. Generating using fallback topic descriptors...`);
      imageResult = await generateImage(calendarItem, normalizedInput);
    }
    console.log(`[GenerateImageForPost] ✓ Image generated (${imageResult.metadata.model})`);

    // ======================================================================
    // STEP 4: UPLOAD TO STORAGE
    // ======================================================================
    
    const imageUrl = await uploadImageToStorage(imageResult, `posts/${postId}/`);
    console.log(`[GenerateImageForPost] ✓ Image uploaded: ${imageUrl}`);

    // ======================================================================
    // STEP 5: UPDATE DATABASE
    // ======================================================================
    
    await updatePostImage(postId, imageUrl, imageResult.metadata.model);

    console.log(`[GenerateImageForPost] ✓ Post updated with image URL`);

    return {
      postId: post.post_id,
      imageUrl,
      imageModel: imageResult.metadata.model,
      imagePrompt: post.image_prompt,
    };
  } catch (error) {
    // Update status to 'failed' if generation fails
    await pool.query(
      `UPDATE posts 
       SET image_status = 'failed', 
           error_message = $1,
           updated_at = NOW()
       WHERE post_id = $2`,
      [error instanceof Error ? error.message : 'Unknown error', postId]
    );

    console.error(`[GenerateImageForPost] ✗ Failed for post ${postId}:`, error);
    throw error;
  }
}

/**
 * Batch generate images for multiple posts
 * 
 * @param postIds - Array of post UUIDs
 * @returns Array of results
 */
export async function generateImagesForPosts(postIds: string[]): Promise<GenerateImageResult[]> {
  console.log(`[GenerateImageForPost] Batch generating ${postIds.length} images...`);
  
  const results: GenerateImageResult[] = [];
  
  for (const postId of postIds) {
    try {
      const result = await generateImageForPost(postId);
      results.push(result);
      
      // Small delay between generations to avoid rate limits
      if (postIds.indexOf(postId) < postIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`[GenerateImageForPost] Failed for post ${postId}:`, error);
      // Continue with next post
    }
  }
  
  console.log(`[GenerateImageForPost] ✓ Batch complete: ${results.length}/${postIds.length} succeeded`);
  
  return results;
}
