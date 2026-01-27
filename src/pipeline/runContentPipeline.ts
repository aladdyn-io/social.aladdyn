/**
 * Main Content Generation Pipeline
 * 
 * Orchestrates the entire content generation flow from input to output.
 * This is the single entry point for the content generation system.
 */

import { ContentInput, ContentOutput, FestivalEvent } from '../types/content';
import { normalizeInput } from '../services/normalizeInput';
import { generateStrategy } from '../services/generateStrategy';
import { generateCalendar } from '../services/generateCalendar';
import { generatePosts } from '../services/generatePosts';
import { savePostsToDB } from '../db/database';

/**
 * Runs the complete content generation pipeline
 * 
 * Flow:
 * 1. Normalize and validate input
 * 2. Generate content strategy (AI)
 * 3. Build content calendar (rule-based)
 * 4. Generate posts with captions and images (AI)
 * 5. Save posts to database (if campaignId provided)
 * 6. Return complete output
 * 
 * @param input - Raw content input from database
 * @param campaignId - Optional campaign UUID to save posts
 * @returns Complete content output with strategy, calendar, and posts
 * @throws Error if any step fails critically
 */
/**
 * Maps geography string to ISO country code
 */
function getCountryCode(geography: string): string {
  const mapping: Record<string, string> = {
    india: 'IN',
    'united states': 'US',
    usa: 'US',
    uk: 'GB',
    'united kingdom': 'GB',
    canada: 'CA',
    australia: 'AU',
    singapore: 'SG',
    uae: 'AE',
    // Add more mappings as needed
  };
  
  return mapping[geography.toLowerCase()] || 'IN'; // Default to India
}

export async function runContentPipeline(
  input: ContentInput,
  campaignId?: string
): Promise<ContentOutput> {
  try {
    // ========================================================================
    // STEP 1: NORMALIZE INPUT
    // ========================================================================
    // Validates data, sanitizes fields, computes derived values
    // Rule-based, synchronous, fails fast on invalid input
    
    const normalizedInput = normalizeInput(input);

    // ========================================================================
    // STEP 2: GENERATE CONTENT STRATEGY
    // ========================================================================
    // Uses AI (LLM) to create content strategy based on business context
    // Async, can fail, should retry on transient errors
    
    const strategy = await generateStrategy(normalizedInput);

    // ========================================================================
    // STEP 3: FETCH FESTIVALS (if enabled)
    // ========================================================================
    
    let festivals: FestivalEvent[] = [];
    
    if (normalizedInput.festival_enabled) {
      const { getFestivalsForDateRange } = await import('../services/festivalApi');
      
      try {
        // Calculate date range from normalized input
        const startDate = new Date(); // Campaign starts today
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + normalizedInput.total_days);
        
        // Map geography to country code (basic mapping)
        const countryCode = getCountryCode(normalizedInput.geography);
        
        festivals = await getFestivalsForDateRange(startDate, endDate, countryCode);
        console.log(`[Pipeline] ✓ Loaded ${festivals.length} festivals`);
      } catch (error) {
        console.error('[Pipeline] ⚠ Failed to fetch festivals, continuing without them:', error);
        // Continue with empty festivals array
      }
    }

    // ========================================================================
    // STEP 4: GENERATE CONTENT CALENDAR
    // ========================================================================
    // Creates posting schedule with festival integration
    // Rule-based, synchronous, deterministic
    
    const calendar = generateCalendar(normalizedInput, strategy, festivals);

    // ========================================================================
    // STEP 5: GENERATE POSTS
    // ========================================================================
    // For each calendar entry: generate caption (AI) + image (AI) + upload
    // Async, parallel processing possible, handle individual failures
    
    const posts = await generatePosts(calendar, normalizedInput, strategy);

    // ========================================================================
    // STEP 6: SAVE POSTS TO DATABASE (if campaignId provided)
    // ========================================================================
    
    if (campaignId) {
      console.log(`[Pipeline] Saving posts to database for campaign: ${campaignId}`);
      try {
        const savedIds = await savePostsToDB(campaignId, posts);
        console.log(`[Pipeline] ✓ Saved ${savedIds.length} posts to database`);
      } catch (error) {
        console.error('[Pipeline] ⚠ Failed to save posts to database:', error);
        // Don't fail the entire pipeline if database save fails
        // Posts are still returned in the response
      }
    }

    // ========================================================================
    // STEP 7: RETURN OUTPUT
    // ========================================================================
    
    return {
      strategy,
      calendar,
      posts,
    };
  } catch (error) {
    // TODO: Add proper error handling
    // - Classify errors (validation, AI failure, network, etc.)
    // - Add retry logic for transient failures
    // - Add logging
    // - Return partial results if possible?
    
    throw new Error(
      `Pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
