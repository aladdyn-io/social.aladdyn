/**
 * Caption Generator Module
 * 
 * Responsibility: Generate post captions using LLM
 * AI-POWERED - This is where we use the LLM for creative content
 * 
 * WHY: Caption writing requires creativity and brand voice matching
 */

import {
  CalendarEntry,
  NormalizedInput,
  ContentStrategy,
  GeneratedCaption,
  AIGenerationError,
} from '../types';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates caption for a calendar entry using LLM
 * 
 * Process:
 * 1. Build context-rich prompt
 * 2. Call LLM with JSON mode
 * 3. Validate response structure
 * 4. Return caption with hashtags and CTA
 * 
 * @param entry - Calendar entry to generate caption for
 * @param input - Campaign input for context
 * @param strategy - Content strategy for brand voice
 * @returns Generated caption
 * @throws AIGenerationError if generation fails
 */
export async function generateCaption(
  entry: CalendarEntry,
  input: NormalizedInput,
  strategy: ContentStrategy
): Promise<GeneratedCaption> {
  console.log(`[CaptionGenerator] Generating caption for entry ${entry.entryId}...`);

  try {
    // ========================================================================
    // BUILD PROMPT
    // WHY: More context = better captions
    // ========================================================================
    
    const prompt = buildCaptionPrompt(entry, input, strategy);

    // ========================================================================
    // CALL LLM
    // ========================================================================
    
    const completion = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert social media copywriter. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8, // Higher creativity for captions
    });

    const responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) {
      throw new AIGenerationError('LLM returned empty response', true);
    }

    // ========================================================================
    // PARSE AND VALIDATE
    // ========================================================================
    
    const caption = JSON.parse(responseText) as GeneratedCaption;
    validateCaption(caption);

    console.log(`[CaptionGenerator] ✓ Caption generated`);
    return caption;
  } catch (error) {
    console.error(`[CaptionGenerator] ✗ Failed to generate caption:`, error);
    
    if (error instanceof SyntaxError) {
      throw new AIGenerationError('LLM returned invalid JSON', true);
    }
    
    if (error instanceof AIGenerationError) {
      throw error;
    }
    
    throw new AIGenerationError(
      `Caption generation failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

/**
 * Builds prompt for caption generation
 * WHY: Detailed context helps LLM match brand voice
 */
function buildCaptionPrompt(
  entry: CalendarEntry,
  input: NormalizedInput,
  strategy: ContentStrategy
): string {
  const context = {
    industry: input.industry,
    services: input.services.join(', '),
    brandVoice: strategy.brandVoice,
    targetAudience: strategy.targetAudience,
    hashtagStrategy: strategy.hashtagStrategy.slice(0, 5).join(', '), // Limit hashtags
  };

  let themeInstruction = '';
  
  if (entry.postType === 'festival' && entry.festival) {
    themeInstruction = `
Theme: ${entry.festival.name} celebration
Create a festive post that:
- Celebrates ${entry.festival.name}
- Relates it back to ${context.industry}
- Is respectful and culturally appropriate
`;
  } else if (entry.contentPillar) {
    themeInstruction = `
Theme: ${entry.contentPillar.name}
Focus: ${entry.contentPillar.description}
Keywords: ${entry.contentPillar.keywords.join(', ')}
`;
  }

  return `
Generate a social media caption with the following details:

${themeInstruction}

Business Context:
- Industry: ${context.industry}
- Services: ${context.services}
- Brand Voice: ${context.brandVoice}
- Target Audience: ${context.targetAudience}

Requirements:
- Caption should be 100-150 words
- Professional yet engaging tone
- Include relevant emojis (but don't overdo it)
- Must be in ${context.brandVoice} voice
- Should appeal to ${context.targetAudience}

Return JSON in this exact format:
{
  "caption": "the main caption text with emojis",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "callToAction": "optional CTA like 'Visit our website' or 'DM us for details'"
}

Use these hashtags as inspiration: ${context.hashtagStrategy}
`.trim();
}

/**
 * Validates caption structure
 * WHY: Ensure LLM output is usable
 */
function validateCaption(caption: any): asserts caption is GeneratedCaption {
  if (!caption.caption || typeof caption.caption !== 'string') {
    throw new AIGenerationError('Invalid caption: missing caption text', false);
  }

  if (caption.caption.length < 20) {
    throw new AIGenerationError('Invalid caption: too short', false);
  }

  if (!Array.isArray(caption.hashtags)) {
    throw new AIGenerationError('Invalid caption: hashtags must be array', false);
  }

  // Validate hashtag format
  caption.hashtags.forEach((tag: any) => {
    if (typeof tag !== 'string' || !tag.startsWith('#')) {
      throw new AIGenerationError('Invalid caption: hashtags must start with #', false);
    }
  });
}
