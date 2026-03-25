/**
 * Image Prompt Generator Service
 *
 * Uses OpenAI GPT-4o-mini to generate detailed image generation prompts.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateDetailedImagePrompt(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const prompt = await callOpenAI(calendarItem, strategy, normalized);
      if (prompt.length < 100) throw new Error('Generated prompt too short');
      console.log(`[ImagePrompt] Generated ${prompt.length} char prompt for: ${calendarItem.topic}`);
      return prompt;
    } catch (error: any) {
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt === 3) return generateFallbackPrompt(calendarItem, normalized);
    }
  }
  return generateFallbackPrompt(calendarItem, normalized);
}

async function callOpenAI(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  const userPrompt = `Create a detailed image generation prompt for this social media post:

Business: ${normalized.industry} | ${normalized.geography}
Services: ${normalized.services.join(', ')}
Branding: accent color ${normalized.accent_color}, base color ${normalized.base_color}, font ${normalized.font_style}
Post Topic: ${item.topic}
Content Pillar: ${item.pillar}
Is Festival: ${item.is_festival}${item.is_festival ? ` (${item.festival_name})` : ''}
Tone: ${strategy.tone}

Generate a comprehensive prompt (150-300 words) covering:
- Main visual concept and subject
- Composition and layout (square 1:1 for social media)
- Lighting and atmosphere
- Color scheme using brand colors: ${normalized.accent_color}, ${normalized.base_color}
- Typography and text placement
- Style and mood
- Any text overlays needed

Output ONLY the prompt, no explanations.`;

  const response = await openai.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert graphic designer and social media visual specialist. Create detailed AI image generation prompts.',
      },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 500,
  });

  const prompt = response.choices[0]?.message?.content?.trim();
  if (!prompt) throw new Error('Empty response from OpenAI');
  return prompt;
}

function generateFallbackPrompt(item: CalendarItem, normalized: NormalizedInput): string {
  console.warn('[ImagePrompt] Using fallback template prompt');
  const base = item.is_festival
    ? `Professional social media graphic for ${item.festival_name}. Topic: ${item.topic}. Festive, vibrant, culturally appropriate.`
    : `Professional social media graphic for ${normalized.industry} business. Topic: ${item.topic}. Modern, clean, professional.`;

  return `${base}

BRANDING: Colors ${normalized.accent_color} and ${normalized.base_color}. Font: ${normalized.font_style}.
COMPOSITION: Square 1:1 format. Clear focal point, rule of thirds. Space for text overlay.
LIGHTING: Natural, bright, professional. Warm color temperature.
TEXT: Minimal overlay with topic "${item.topic}". Large, readable, high contrast.
FORMAT: High quality, social media ready, eye-catching.`;
}

export async function generateDetailedImagePrompts(
  calendar: CalendarItem[],
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<Map<string, string>> {
  const prompts = new Map<string, string>();
  console.log(`[ImagePrompt] Generating prompts for ${calendar.length} posts...`);

  for (const [i, item] of calendar.entries()) {
    try {
      console.log(`[ImagePrompt] [${i + 1}/${calendar.length}] ${item.topic}`);
      prompts.set(item.date, await generateDetailedImagePrompt(item, strategy, normalized));
    } catch {
      prompts.set(item.date, generateFallbackPrompt(item, normalized));
    }
  }

  console.log(`[ImagePrompt] Done: ${prompts.size} prompts`);
  return prompts;
}
