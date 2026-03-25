/**
 * On-Demand Image Generation Service
 *
 * Generates an image for a specific post using its stored detailed prompt.
 * Called when the user requests image generation for a specific post.
 */

import { generateImageFromPrompt } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import { getPostById, updatePostImage } from '../db/database';

/**
 * Generate image for a specific post on-demand
 *
 * Workflow:
 * 1. Fetch post (get stored imagePrompt / detailed prompt)
 * 2. Generate image using that prompt directly
 * 3. Upload to MinIO
 * 4. Update DB with image URL
 *
 * @param postId - UUID of the post
 * @returns Public URL of generated image
 */
export async function generatePostImage(postId: string): Promise<string> {
  console.log(`[OnDemandImage] Generating image for post: ${postId}`);

  try {
    // STEP 1: Fetch post
    const post = await getPostById(postId);

    if (!post) {
      throw new Error(`Post not found: ${postId}`);
    }

    if (!post.imagePrompt) {
      throw new Error('Post does not have a detailed image prompt');
    }

    if (post.imageUrl) {
      console.log(`[OnDemandImage] Post already has image: ${post.imageUrl}`);
      return post.imageUrl;
    }

    console.log(`[OnDemandImage] Prompt length: ${post.imagePrompt.length} chars`);

    // STEP 2: Generate image from the stored detailed prompt
    const imageResult = await generateImageFromPrompt(post.imagePrompt);
    console.log(`[OnDemandImage] ✓ Image generated (${imageResult.metadata.model})`);

    // STEP 3: Upload to MinIO
    const imageUrl = await uploadImageToStorage(imageResult, `posts/${postId}/`);
    console.log(`[OnDemandImage] ✓ Uploaded: ${imageUrl}`);

    // STEP 4: Update DB
    await updatePostImage(postId, imageUrl, imageResult.metadata.model);
    console.log(`[OnDemandImage] ✓ DB updated`);

    return imageUrl;
  } catch (error) {
    console.error(`[OnDemandImage] ✗ Failed for post ${postId}:`, error);
    throw new Error(
      `Image generation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Batch generate images for multiple posts
 */
export async function generatePostImages(
  postIds: string[]
): Promise<Map<string, { success: boolean; imageUrl?: string; error?: string }>> {
  console.log(`[OnDemandImage] Batch generating images for ${postIds.length} posts`);

  const results = new Map<string, { success: boolean; imageUrl?: string; error?: string }>();

  for (const [index, postId] of postIds.entries()) {
    console.log(`[OnDemandImage] [${index + 1}/${postIds.length}] Processing ${postId}...`);

    try {
      const imageUrl = await generatePostImage(postId);
      results.set(postId, { success: true, imageUrl });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[OnDemandImage] Failed for post ${postId}:`, msg);
      results.set(postId, { success: false, error: msg });
    }
  }

  const successCount = Array.from(results.values()).filter((r) => r.success).length;
  console.log(`[OnDemandImage] ✓ Batch complete: ${successCount}/${postIds.length} succeeded`);

  return results;
}
