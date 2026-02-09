/**
 * Image Prompt Generator Service
 * 
 * Generates detailed, comprehensive prompts for image generation.
 * Includes: composition, layout, lighting, text placement, format, style.
 * 
 * WHY: Separating prompt generation from image generation allows:
 * - Faster batch content creation
 * - More control over image generation
 * - Better accuracy per date/topic
 * - Cost optimization (generate images only when needed)
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';
import { geminiClient } from '../utils/geminiAdapter';

// Use Gemini if configured, otherwise use OpenAI
const llmClient = process.env.LLM_PROVIDER === 'gemini' 
  ? geminiClient 
  : new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });

/**
 * Generates detailed image prompt for a calendar item with retry and rate limit handling
 * 
 * The prompt includes:
 * - Main subject/theme
 * - Visual style and mood
 * - Composition and layout
 * - Lighting and color scheme
 * - Text placement specifications
 * - Format requirements (social media ready)
 * 
 * @param calendarItem - Calendar entry with topic and theme
 * @param strategy - Content strategy with tone
 * @param normalized - Campaign branding (colors, fonts, industry)
 * @returns Comprehensive image generation prompt
 */
export async function generateDetailedImagePrompt(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  console.log(`[ImagePromptGenerator] Generating prompt for: ${calendarItem.topic}`);

  // Retry with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const prompt = await callLLMForPrompt(calendarItem, strategy, normalized);
      
      // Validate prompt length (should be comprehensive)
      if (prompt.length < 100) {
        throw new Error('Generated prompt too short - needs more detail');
      }

      console.log(`[ImagePromptGenerator] ✓ Generated ${prompt.length} character prompt`);
      return prompt;
    } catch (error: any) {
      // Handle rate limit errors with exponential backoff
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
        const backoffDelay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.warn(`[ImagePromptGenerator] ⚠ Rate limit hit (attempt ${attempt}/3), backing off ${backoffDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        continue;
      }
      
      if (attempt === 3) {
        console.error('[ImagePromptGenerator] ✗ Failed after 3 attempts:', error);
        // Fallback to template-based prompt
        return generateFallbackPrompt(calendarItem, normalized);
      }
    }
  }
  
  // Fallback if all retries fail
  console.error('[ImagePromptGenerator] ✗ All retries exhausted');
  return generateFallbackPrompt(calendarItem, normalized);
}

/**
 * Call LLM to generate comprehensive image prompt
 */
async function callLLMForPrompt(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  const systemPrompt = `You are an expert graphic designer and social media visual specialist. 
Your job is to create DETAILED image generation prompts for AI image generators.

The prompts must include:
1. Main subject and theme
2. Visual style (photorealistic, illustrated, minimalist, etc.)
3. Composition and layout details
4. Lighting specifications (warm, natural, dramatic, etc.)
5. Color palette (align with brand colors)
6. Text placement and typography suggestions
7. Mood and atmosphere
8. Format specifications (square 1:1 for Instagram, etc.)

Be specific and comprehensive. The AI image generator needs clear instructions.`;

  const userPrompt = `Create a detailed image generation prompt for this social media post:

**BUSINESS CONTEXT:**
- Industry: ${normalized.industry}
- Services: ${normalized.services.join(', ')}
- Geography: ${normalized.geography}

**BRANDING:**
- Accent Color: ${normalized.accent_color}
- Base Color: ${normalized.base_color}
- Font Style: ${normalized.font_style}

**POST DETAILS:**
- Topic: ${calendarItem.topic}
- Content Pillar: ${calendarItem.pillar}
- Is Festival Post: ${calendarItem.is_festival}
${calendarItem.is_festival ? `- Festival: ${calendarItem.festival_name}` : ''}

**CONTENT STRATEGY:**
- Tone: ${strategy.tone}
- CTA Style: ${strategy.cta_style}

Generate a comprehensive prompt (200-400 words) that includes:
- Main visual concept
- Composition and layout
- Lighting and atmosphere
- Color scheme (use brand colors: ${normalized.accent_color}, ${normalized.base_color})
- Typography and text placement ideas
- Style and mood
- Format (social media ready, 1:1 aspect ratio)
- Any text overlays needed

Output ONLY the prompt itself, no explanations.`;

  const response = await llmClient.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8, // More creative for visual prompts
    max_tokens: 800,
  });

  const prompt = response.choices[0]?.message?.content?.trim();

  if (!prompt) {
    throw new Error('Empty response from LLM');
  }

  return prompt;
}

/**
 * Generate fallback prompt using templates (if LLM fails)
 */
function generateFallbackPrompt(
  calendarItem: CalendarItem,
  normalized: NormalizedInput
): string {
  const isFestival = calendarItem.is_festival;
  const topic = calendarItem.topic;
  const pillar = calendarItem.pillar;
  
  let basePrompt = '';

  if (isFestival) {
    basePrompt = `Professional social media graphic for ${calendarItem.festival_name} celebration. `;
    basePrompt += `Theme: ${topic}. `;
    basePrompt += `Visual style: Vibrant, festive, culturally appropriate. `;
    basePrompt += `Include festive elements, warm lighting, celebratory atmosphere. `;
  } else {
    basePrompt = `Professional social media graphic for ${normalized.industry} business. `;
    basePrompt += `Topic: ${topic}. Content pillar: ${pillar}. `;
    basePrompt += `Visual style: Modern, clean, professional. `;
  }

  // Add branding
  basePrompt += `\n\nBRANDING: Use brand colors ${normalized.accent_color} and ${normalized.base_color}. `;
  basePrompt += `Typography: ${normalized.font_style} font family. `;
  
  // Add composition details
  basePrompt += `\n\nCOMPOSITION: Square format (1:1 aspect ratio) for social media. `;
  basePrompt += `Clear focal point, rule of thirds composition. `;
  basePrompt += `Leave space for text overlay at top or bottom. `;
  
  // Add lighting and style
  basePrompt += `\n\nLIGHTING: Natural, bright, professional lighting. `;
  basePrompt += `Avoid harsh shadows. Warm color temperature. `;
  
  // Add text instructions
  basePrompt += `\n\nTEXT: Include minimal text overlay with topic "${topic}". `;
  basePrompt += `Large, readable typography. High contrast with background. `;
  
  // Format and quality
  basePrompt += `\n\nFORMAT: High quality, social media ready, eye-catching, professional.`;

  console.log('[ImagePromptGenerator] ⚠ Using fallback template prompt');
  return basePrompt;
}

/**
 * Batch generate prompts for multiple calendar items
 * 
 * More efficient than generating one at a time.
 */
export async function generateDetailedImagePrompts(
  calendar: CalendarItem[],
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<Map<string, string>> {
  const prompts = new Map<string, string>();

  console.log(`[ImagePromptGenerator] Generating prompts for ${calendar.length} posts...`);

  for (const [index, item] of calendar.entries()) {
    try {
      console.log(`[ImagePromptGenerator] [${index + 1}/${calendar.length}] ${item.topic}...`);
      const prompt = await generateDetailedImagePrompt(item, strategy, normalized);
      prompts.set(item.date, prompt);
    } catch (error) {
      console.error(`[ImagePromptGenerator] Failed for ${item.topic}:`, error);
      // Add fallback prompt even on error
      prompts.set(item.date, generateFallbackPrompt(item, normalized));
    }
  }

  console.log(`[ImagePromptGenerator] ✓ Generated ${prompts.size} prompts`);
  return prompts;
}
