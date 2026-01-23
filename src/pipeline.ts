/**
 * Main Content Generation Pipeline
 * 
 * Orchestrates the entire content generation process:
 * 1. Read & normalize input
 * 2. Generate content strategy
 * 3. Build content calendar
 * 4. Generate posts (caption + image)
 * 5. Upload to S3
 * 6. Return complete response
 * 
 * This is the ONLY entry point to the system.
 */

import {
  DatabaseInput,
  NormalizedInput,
  ContentStrategy,
  ContentCalendar,
  GeneratedPost,
  PipelineResponse,
  ValidationError,
} from './types';
import { normalizeInput } from './modules/inputNormalizer';
import { generateStrategy } from './modules/strategyGenerator';
import { getFestivalsForPeriod } from './modules/festivalEngine';
import { generateCalendar } from './modules/calendarGenerator';
import { generateCaption } from './modules/captionGenerator';
import { generateImage } from './modules/imageGenerator';
import { uploadToS3 } from './modules/s3Uploader';

/**
 * Main pipeline function - coordinates all modules
 * 
 * @param dbInput - Raw input from database
 * @returns Complete pipeline response with strategy, calendar, and posts
 * @throws ValidationError if input is invalid
 * @throws AIGenerationError if LLM fails
 * @throws ImageGenerationError if image generation fails
 */
export async function runContentGenerationPipeline(
  dbInput: DatabaseInput
): Promise<PipelineResponse> {
  const startTime = Date.now();
  const generatedPosts: GeneratedPost[] = [];
  let failureCount = 0;

  try {
    console.log(`[Pipeline] Starting for campaign: ${dbInput.campaign_id}`);

    // ========================================================================
    // STEP 1: NORMALIZE INPUT (Rule-based, NO AI)
    // ========================================================================
    console.log('[Pipeline] Step 1: Normalizing input...');
    const normalizedInput: NormalizedInput = normalizeInput(dbInput);
    console.log(`[Pipeline] ✓ Input normalized. Total posts needed: ${normalizedInput.totalPostsRequired}`);

    // ========================================================================
    // STEP 2: GENERATE CONTENT STRATEGY (AI - LLM only)
    // ========================================================================
    console.log('[Pipeline] Step 2: Generating content strategy with LLM...');
    const strategy: ContentStrategy = await generateStrategy(normalizedInput);
    console.log(`[Pipeline] ✓ Strategy generated with ${strategy.contentPillars.length} pillars`);

    // ========================================================================
    // STEP 3: FETCH FESTIVALS (Rule-based, NO AI)
    // ========================================================================
    console.log('[Pipeline] Step 3: Fetching relevant festivals...');
    const festivals = normalizedInput.festivalEnabled
      ? await getFestivalsForPeriod(
          normalizedInput.startDate,
          normalizedInput.endDate,
          normalizedInput.geography
        )
      : [];
    console.log(`[Pipeline] ✓ Found ${festivals.length} relevant festivals`);

    // ========================================================================
    // STEP 4: GENERATE CONTENT CALENDAR (Rule-based, NO AI)
    // ========================================================================
    console.log('[Pipeline] Step 4: Building content calendar...');
    const calendar: ContentCalendar = generateCalendar(
      normalizedInput,
      strategy,
      festivals
    );
    console.log(`[Pipeline] ✓ Calendar created with ${calendar.entries.length} entries`);

    // ========================================================================
    // STEP 5: GENERATE POSTS (AI for captions, Stable Diffusion for images)
    // ========================================================================
    console.log('[Pipeline] Step 5: Generating posts (captions + images)...');
    
    for (const [index, entry] of calendar.entries.entries()) {
      try {
        console.log(`  [${index + 1}/${calendar.entries.length}] Generating post for ${entry.scheduledDate.toISOString()}`);

        // Generate caption using LLM
        const caption = await generateCaption(entry, normalizedInput, strategy);

        // Build image prompt (rule-based, NO AI)
        const imagePrompt = buildImagePrompt(entry, normalizedInput);

        // Generate image using Stable Diffusion
        const imageBuffer = await generateImage({
          prompt: imagePrompt,
          negativePrompt: 'low quality, blurry, text, watermark',
          width: 1024,
          height: 1024,
        });

        // Upload to S3
        const imageKey = `campaigns/${normalizedInput.campaignId}/posts/${entry.entryId}.png`;
        const s3Result = await uploadToS3({
          buffer: imageBuffer.imageBuffer,
          key: imageKey,
          contentType: 'image/png',
          metadata: {
            campaignId: normalizedInput.campaignId,
            entryId: entry.entryId,
            scheduledDate: entry.scheduledDate.toISOString(),
          },
        });

        // Assemble post
        const post: GeneratedPost = {
          entryId: entry.entryId,
          scheduledDate: entry.scheduledDate,
          caption,
          imageUrl: s3Result.url,
          imagePrompt,
          metadata: {
            contentPillar: entry.contentPillar?.name,
            festival: entry.festival?.name,
            generatedAt: new Date(),
          },
        };

        generatedPosts.push(post);
        console.log(`  ✓ Post generated successfully`);
      } catch (error) {
        failureCount++;
        console.error(`  ✗ Failed to generate post for entry ${entry.entryId}:`, error);
        // Continue with other posts - don't fail entire pipeline for one post
      }
    }

    console.log(`[Pipeline] ✓ Generated ${generatedPosts.length}/${calendar.entries.length} posts`);

    // ========================================================================
    // STEP 6: RETURN FINAL RESPONSE
    // ========================================================================
    const processingTime = Date.now() - startTime;
    
    const response: PipelineResponse = {
      campaignId: normalizedInput.campaignId,
      strategy,
      calendar,
      posts: generatedPosts,
      summary: {
        totalGenerated: calendar.entries.length,
        successCount: generatedPosts.length,
        failureCount,
        processingTime,
      },
    };

    console.log(`[Pipeline] ✓ Pipeline completed in ${processingTime}ms`);
    return response;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('[Pipeline] ✗ Pipeline failed:', error);
    
    // Re-throw with context
    if (error instanceof ValidationError) {
      throw error;
    }
    
    throw new Error(`Pipeline failed after ${processingTime}ms: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build image generation prompt based on calendar entry
 * This is rule-based logic, NOT AI-generated
 * 
 * WHY: We want deterministic prompts that work well with Stable Diffusion
 */
function buildImagePrompt(
  entry: import('./types').CalendarEntry,
  input: NormalizedInput
): string {
  const { industry, services, branding } = input;
  
  let prompt = '';

  if (entry.postType === 'festival' && entry.festival) {
    // Festival-themed image
    prompt = `Professional social media post for ${entry.festival.name}, ${industry} business, ${entry.festival.category} celebration, vibrant colors, modern design, clean composition`;
  } else if (entry.contentPillar) {
    // Regular content pillar post
    prompt = `Professional social media post, ${industry} business, ${entry.contentPillar.name} theme, ${entry.contentPillar.description}, modern design, clean composition, ${branding.accentColor} accent`;
  } else {
    // Fallback
    prompt = `Professional social media post, ${industry} business, services: ${services.join(', ')}, modern design, clean composition`;
  }

  // Add quality modifiers
  prompt += ', high quality, professional photography, 4k, trending on artstation';

  return prompt;
}
