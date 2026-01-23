/**
 * Caption Generation Service
 * 
 * Uses AI (LLM) to generate social media captions for calendar items.
 * This is AI-POWERED logic.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates social media caption for a calendar item
 * 
 * WHY: Captions require creative writing that matches brand voice
 * WHY: AI can adapt tone and style based on strategy and context
 * WHY: Plain text output (no JSON) for direct use
 * 
 * @param calendarItem - Calendar entry to create caption for
 * @param strategy - Content strategy with tone and CTA style
 * @param normalized - Normalized campaign input
 * @returns Plain text caption (4-6 lines, no emojis)
 * @throws Error if LLM fails after retry
 */
export async function generateCaption(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  // Try to generate caption (with one retry on failure)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawCaption = await callLLM(calendarItem, strategy, normalized);
      
      // Validate output
      const validatedCaption = validateCaption(rawCaption);
      return validatedCaption;
    } catch (error) {
      if (attempt === 2) {
        // WHY: After 2 attempts, fail fast
        throw new Error(
          `Caption generation failed after retry: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      // WHY: Retry once in case of transient issues
      continue;
    }
  }

  throw new Error('Caption generation failed');
}

/**
 * Calls LLM to generate caption
 * 
 * WHY: Separate function for cleaner code structure
 */
async function callLLM(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  const prompt = buildPrompt(item, strategy, normalized);

  const completion = await openai.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: 'You are a professional social media copywriter. Write clear, engaging captions without emojis or markdown formatting.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    // WHY: No JSON mode - we want plain text output
    temperature: 0.8, // WHY: Higher creativity for caption writing
    max_tokens: 200, // WHY: Keep captions concise
  });

  const caption = completion.choices[0]?.message?.content?.trim();

  if (!caption) {
    throw new Error('LLM returned empty caption');
  }

  return caption;
}

/**
 * Builds prompt for caption generation
 * 
 * WHY: Context-rich prompt produces better, on-brand captions
 * WHY: Explicit constraints ensure consistent output format
 */
function buildPrompt(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): string {
  // Build service context
  // WHY: Services should be mentioned naturally in captions
  const servicesText = normalized.services.length > 0
    ? normalized.services.join(', ')
    : normalized.industry;

  // Festival-specific instructions
  const festivalInstructions = item.is_festival
    ? `This is a festival post for ${item.festival_name}. Reference the festival respectfully and connect it naturally to the business.`
    : `This is a regular post about: ${item.topic}`;

  return `
Write a social media caption for a ${normalized.platform} post with these details:

Business Context:
- Industry: ${normalized.industry}
- Services: ${servicesText}
- Geography: ${normalized.geography}
- Brand Stage: ${normalized.brand_stage}

Content Details:
- Content Pillar: ${item.pillar}
- ${festivalInstructions}

Strategy Guidelines:
- Tone: ${strategy.tone}
- CTA Style: ${strategy.cta_style}

Requirements:
- Write 4-6 lines maximum
- Use ${strategy.tone} tone throughout
- Include a call-to-action using ${strategy.cta_style} approach
- Mention services (${servicesText}) naturally if relevant
- NO emojis
- NO markdown formatting
- NO hashtags (they will be added separately)
- Plain text only
- Write for ${normalized.geography} audience

Return ONLY the caption text, nothing else.
`.trim();
}

/**
 * Validates generated caption
 * 
 * WHY: Ensure output meets basic quality requirements
 */
function validateCaption(caption: string): string {
  if (!caption || caption.length === 0) {
    throw new Error('Caption is empty');
  }

  // WHY: Captions that are too short are likely errors
  if (caption.length < 20) {
    throw new Error('Caption is too short (minimum 20 characters)');
  }

  // WHY: Captions that are too long don't fit the 4-6 line requirement
  if (caption.length > 500) {
    throw new Error('Caption is too long (maximum 500 characters)');
  }

  // WHY: Remove any markdown formatting that slipped through
  let cleaned = caption.replace(/[*_`#]/g, '');

  // WHY: Remove emojis if they slipped through (basic filter)
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Symbols & Pictographs
  cleaned = cleaned.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport & Map
  cleaned = cleaned.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Misc symbols
  cleaned = cleaned.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats

  return cleaned.trim();
}
