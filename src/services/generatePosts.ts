/**
 * Post Generation Service
 * 
 * Generates complete posts (caption + detailed image prompt) for each calendar entry.
 * 
 * NEW WORKFLOW:
 * - Batch generation: Creates captions + detailed prompts (NO images)
 * - On-demand generation: User triggers image generation later for specific posts
 * 
 * WHY:
 * - Faster batch processing (no waiting for image generation)
 * - More accurate images (generated per date/topic when needed)
 * - Better resource management
 * - Cost optimization
 */

import { CalendarItem, PostItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { generateCaption } from './generateCaption';
import { generateDetailedImagePrompt } from './generateImagePrompt';

/**
 * Generates all posts for the calendar with PARALLEL caption + prompt generation
 * 
 * OPTIMIZED WORKFLOW:
 * - Generate captions and prompts in PARALLEL for each entry
 * - Process in batches to respect rate limits
 * - Much faster than sequential processing
 * 
 * For each calendar entry:
 * 1. Generate caption + prompt simultaneously (parallel LLM calls)
 * 2. Assemble PostItem with caption + prompt (imageUrl = null)
 * 
 * Images are generated on-demand later when user requests specific posts.
 * 
 * @param calendar - Scheduled calendar items
 * @param input - Normalized campaign input
 * @param strategy - Content strategy
 * @returns Array of posts with captions and prompts (no images yet)
 */
export async function generatePosts(
  calendar: CalendarItem[],
  input: NormalizedInput,
  strategy: Strategy
): Promise<PostItem[]> {
  console.log(`[GeneratePosts] Starting PARALLEL generation for ${calendar.length} posts...`);

  // ========================================================================
  // PARALLEL BATCH PROCESSING
  // WHY: Generate caption + prompt simultaneously for each entry
  // BENEFIT: 40-50% faster than sequential processing
  // ========================================================================
  
  const batchSize = 5; // Process 5 posts at a time (10 LLM calls total)
  const posts: PostItem[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < calendar.length; i += batchSize) {
    const batch = calendar.slice(i, i + batchSize);
    console.log(`[GeneratePosts] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(calendar.length / batchSize)} (${batch.length} posts)...`);

    // Generate all captions and prompts in parallel for this batch
    const batchResults = await Promise.all(
      batch.map(async (entry, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          console.log(`  [${globalIndex + 1}/${calendar.length}] Processing ${entry.date}...`);

          // PARALLEL: Generate caption AND prompt simultaneously
          const [caption, detailedPrompt] = await Promise.all([
            generateCaption(entry, strategy, input),
            generateDetailedImagePrompt(entry, strategy, input)
          ]);

          console.log(`  ✓ [${globalIndex + 1}/${calendar.length}] Caption + prompt generated`);

          const post: PostItem = {
            entryId: `${entry.date}-${entry.pillar}`,
            scheduledDate: new Date(entry.date),
            caption: caption,
            hashtags: extractHashtags(caption),
            detailedImagePrompt: detailedPrompt,
            imageUrl: null, // No image yet - generated on-demand
            metadata: {
              contentPillar: entry.is_festival ? undefined : entry.pillar,
              festival: entry.is_festival ? entry.festival_name : undefined,
              generatedAt: new Date(),
              topic: entry.topic,
              imageGenerated: false,
            },
          };

          successCount++;
          return { success: true, post };
        } catch (error) {
          failureCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`  ✗ [${globalIndex + 1}/${calendar.length}] Failed: ${errorMessage}`);
          return { success: false, error: errorMessage };
        }
      })
    );

    // Collect successful posts from batch
    for (const result of batchResults) {
      if (result.success && result.post) {
        posts.push(result.post);
      }
    }

    // Adaptive delay between batches (rate limit management)
    if (i + batchSize < calendar.length) {
      await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms between batches
    }
  }

  console.log(`\n[GeneratePosts] ✓ Parallel generation complete!`);
  console.log(`  Success: ${successCount}/${calendar.length} posts`);
  console.log(`  Failed: ${failureCount}/${calendar.length} posts`);
  console.log(`  ℹ️  Images will be generated on-demand when requested\n`);

  return posts;
}

/**
 * Extract hashtags from caption
 * WHY: Make hashtags easily accessible as array
 */
function extractHashtags(caption: string): string[] {
  const hashtagRegex = /#[\w\u0900-\u097F]+/g;
  const matches = caption.match(hashtagRegex);
  return matches || [];
}
