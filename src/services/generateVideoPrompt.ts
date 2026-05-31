/**
 * Video Prompt Generator Service
 *
 * Generates detailed, motion-aware video prompts for reel and story posts.
 * Mirrors the structure of generateImagePrompt.ts but produces prompts
 * optimised for AI video generation (Kling) rather than static images.
 *
 * Key differences from image prompts:
 * - Describes motion, camera movement, and pacing (not just composition)
 * - No text overlays or negative-space quadrant requirements
 * - Platform-aware aspect ratio hint (9:16 vs 16:9)
 * - Shorter output (50–1000 chars) — Kling works best with concise prompts
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { callLlm } from '../utils/llmClient';
import { getFriendlyColorName, getGeographyVisualCues } from './audienceClassifier';

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates a motion-aware video prompt for a reel or story post.
 *
 * @param calendarItem - The calendar slot (must be reel or story)
 * @param strategy     - Campaign strategy (tone, pillars)
 * @param normalized   - Normalized campaign input (industry, colors, geography)
 * @returns            A 50–1000 character video prompt string
 */
export async function generateDetailedVideoPrompt(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  try {
    const prompt = await callLlmForVideoPrompt(calendarItem, strategy, normalized);

    // Enforce minimum length — fall back if LLM returns something too short
    if (prompt.length < 50) {
      throw new Error(`Generated video prompt too short (${prompt.length} chars)`);
    }

    // Truncate to 1000 chars if LLM overshoots
    const finalPrompt = prompt.length > 1000 ? prompt.slice(0, 1000) : prompt;

    console.log(
      `[VideoPrompt] Generated ${finalPrompt.length} char prompt for: ${calendarItem.topic}`
    );
    return finalPrompt;
  } catch (error: any) {
    console.error(
      `[VideoPrompt] Prompt generation failed: ${error.message}. Returning fallback.`
    );
    return generateFallbackVideoPrompt(calendarItem, normalized);
  }
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callLlmForVideoPrompt(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): Promise<string> {
  const baseColorDesc = getFriendlyColorName(normalized.base_color);
  const accentColorDesc = getFriendlyColorName(normalized.accent_color);
  const geoVisualCues = getGeographyVisualCues(normalized.geography);

  // Determine aspect ratio hint based on platform
  const platform = (item.platform ?? normalized.platform ?? 'instagram').toLowerCase();
  const aspectRatioHint =
    platform === 'linkedin' ? '16:9 horizontal widescreen' : '9:16 vertical portrait';

  const userPrompt = `Create a concise video generation prompt for a social media ${item.content_type} post.

Business: ${normalized.industry}
Target Geography: ${normalized.geography}
Services: ${normalized.services.join(', ')}
Brand Colors: ${accentColorDesc} (${normalized.accent_color}) and ${baseColorDesc} (${normalized.base_color})
Post Topic: ${item.topic}
Content Pillar: ${item.pillar}
Is Festival: ${item.is_festival}${item.is_festival ? ` (${item.festival_name})` : ''}
Tone: ${strategy.tone}
Platform: ${platform} (${aspectRatioHint} format)
Geography Visual Cues: ${geoVisualCues}

Write a video prompt (100–800 words) that describes:
1. SCENE: The main visual environment and setting (product staging, lifestyle scene, workspace, etc.)
2. MOTION: What moves in the scene (slow pan, zoom in, floating particles, flowing fabric, etc.)
3. CAMERA: Camera movement style (slow dolly, orbital, static with subject motion, handheld, etc.)
4. LIGHTING: Lighting quality and atmosphere (golden hour, studio softbox, neon glow, etc.)
5. PACING: Speed and rhythm of the video (slow and cinematic, energetic and fast-cut, etc.)
6. STYLE: Visual aesthetic (photorealistic, cinematic, editorial, lifestyle, etc.)
7. MOOD: Emotional tone (aspirational, calm, exciting, luxurious, etc.)

CRITICAL CONSTRAINTS — MUST FOLLOW:
- NO text, words, letters, numbers, logos, watermarks, or brand names in the scene
- NO human faces, bodies, or hands (they generate distorted results in AI video)
- NO platform UI elements (Instagram interface, TikTok overlays, etc.)
- NO festival names written as text — translate into visual motifs instead
  (e.g. instead of "Diwali text", describe "warm glowing diyas, golden light trails, marigold petals floating")
- Keep the scene clean and premium — suitable for a high-end D2C or B2B brand
- The video should feel like a premium brand advertisement, not a generic stock clip

Output ONLY the prompt text. No explanations, no labels, no markdown.`;

  const response = await callLlm({
    model: process.env.VIDEO_PROMPT_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content:
          'You are an expert video director and AI prompt engineer. Create concise, motion-rich video generation prompts for premium social media content. Output ONLY the prompt text.',
      },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.8,
    max_tokens: 600,
  });

  const prompt = response.choices[0]?.message?.content?.trim();
  if (!prompt) throw new Error('LLM returned empty video prompt');
  return prompt;
}

// ── Fallback ──────────────────────────────────────────────────────────────────

function generateFallbackVideoPrompt(
  item: CalendarItem,
  normalized: NormalizedInput
): string {
  console.warn('[VideoPrompt] Using fallback template prompt');

  const platform = (item.platform ?? normalized.platform ?? 'instagram').toLowerCase();
  const aspectHint =
    platform === 'linkedin' ? 'widescreen 16:9' : 'vertical portrait 9:16';

  if (item.is_festival) {
    return (
      `Cinematic ${aspectHint} video. Elegant cultural celebration scene with warm ambient lighting, ` +
      `soft golden glow, floating organic elements, premium product staging on a marble surface. ` +
      `Slow cinematic camera drift. Photorealistic, high-end brand aesthetic. ` +
      `No text, no faces, no logos. Pure visual storytelling.`
    );
  }

  return (
    `Cinematic ${aspectHint} video for ${normalized.industry} brand. ` +
    `Premium product or service showcase with clean minimalist staging. ` +
    `Slow elegant camera movement, soft studio lighting with ${normalized.accent_color} accent tones. ` +
    `Smooth motion, high-end D2C aesthetic, photorealistic quality. ` +
    `No text, no faces, no logos. Pure visual brand storytelling.`
  );
}
