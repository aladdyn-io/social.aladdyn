/**
 * Post Generation Service
 * 
 * Generates complete posts (caption + image) for each calendar entry.
 * Uses AI for captions and image generation.
 */

import { CalendarItem, PostItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { generateCaption } from './generateCaption';
import { generateImage } from './imageGenerator';
import { uploadImageToStorage } from './objectStorage';
import { assemblePost } from './assemblePost';

/**
 * Generates all posts for the calendar
 * 
 * For each calendar entry:
 * 1. Generate caption using LLM (based on theme, strategy, brand voice)
 * 2. Generate image using generator (based on theme, branding)
 * 3. Upload image to MinIO
 * 4. Assemble PostItem with all data
 * 
 * WHY: Sequential processing for V1, can be parallelized later
 * WHY: Individual failures don't crash entire pipeline
 * 
 * @param calendar - Scheduled calendar items
 * @param input - Normalized campaign input
 * @param strategy - Content strategy
 * @returns Array of complete posts ready to publish
 */
export async function generatePosts(
  calendar: CalendarItem[],
  input: NormalizedInput,
  strategy: Strategy
): Promise<PostItem[]> {
  const posts: PostItem[] = [];
  let successCount = 0;
  let failureCount = 0;

  console.log(`[GeneratePosts] Starting generation for ${calendar.length} posts...`);

  for (const [index, entry] of calendar.entries()) {
    try {
      console.log(`[GeneratePosts] [${index + 1}/${calendar.length}] Processing post for ${entry.date}...`);

      // ======================================================================
      // STEP 1: GENERATE CAPTION
      // WHY: Caption needs to be created before we know full context
      // ======================================================================
      
      const caption = await generateCaption(entry, strategy, input);
      console.log(`  ✓ Caption generated`);

      // ======================================================================
      // STEP 2: GENERATE IMAGE
      // WHY: Visual content is core to social media posts
      // ======================================================================
      
      const imageResult = await generateImage(entry, input);
      console.log(`  ✓ Image generated (${imageResult.metadata.model})`);

      // ======================================================================
      // STEP 3: UPLOAD TO STORAGE
      // WHY: Need public URL for final post object
      // ======================================================================
      
      const imageUrl = await uploadImageToStorage(imageResult);
      console.log(`  ✓ Image uploaded: ${imageUrl}`);

      // ======================================================================
      // STEP 4: ASSEMBLE POST
      // WHY: Combine all components into final PostItem
      // ======================================================================
      
      const post = assemblePost(
        imageUrl,
        caption,
        entry,
        imageResult.metadata.prompt || 'N/A',
        imageResult.metadata.model
      );

      posts.push(post);
      successCount++;
      console.log(`  ✓ Post complete for ${entry.date}`);
    } catch (error) {
      failureCount++;
      console.error(`  ✗ Failed to generate post for ${entry.date}:`, error);
      
      // WHY: Continue with other posts - don't fail entire pipeline
      // TODO: In production, might want to collect errors and return partial results
    }
  }

  console.log(`[GeneratePosts] ✓ Complete: ${successCount} succeeded, ${failureCount} failed`);

  return posts;
}
