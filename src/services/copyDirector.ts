import { createLogger } from '../utils/logger';
import { callLlm } from '../utils/llmClient';
import { CopyBlueprint } from '../types/content';

const logger = createLogger({ service: 'copy-director' });

export interface CopyDirectorParams {
  topic?: string;
  caption?: string;
  contentPillar?: string;
  brandName: string;
  industry: string;
  tone?: string;
}

/**
 * The Copy Director acts purely as a master copywriter.
 * It reads the post's context and extracts/generates highly polished,
 * structured text nodes that will be handed off to the Layout Engine.
 */
export async function generateAdCopyBlueprint(params: CopyDirectorParams): Promise<CopyBlueprint> {
  logger.info(`Extracting structured ad copy for: ${params.topic}`);

  const prompt = `You are a Master Copywriter for premium D2C & B2B brands. 
Your job is to read the provided post context and write the exact text that will appear overlaid on a visual social media ad.

BRAND CONTEXT:
- Brand Name: ${params.brandName}
- Industry: ${params.industry}
- Tone of Voice: ${params.tone || 'Premium, professional, and authentic'}

POST CONTEXT:
- Post Topic: ${params.topic || 'General Brand Awareness'}
- Content Pillar: ${params.contentPillar || ''}
- Caption Draft: ${params.caption || 'No caption provided.'}

YOUR GOAL:
Distill the caption/topic into rich, information-dense visual ad copy. The ad should feel like a premium infographic — packed with value, not sparse. Think of the target output as a magazine-quality ad with a headline, subtitle, 4-6 feature/step items, a callout quote or stat, and a CTA.

MANDATORY RICHNESS RULES:
1. primaryHeadline: 3-7 words, bold and punchy. Can be split across 2 lines for drama.
2. secondarySubtitle: 1-2 sentences that expand on the headline with a clear value proposition.
3. elements array: MINIMUM 5 items, MAXIMUM 8 items. Mix types for visual variety:
   - At least 3-5 "feature" items (numbered steps, benefits, or ingredients) — each with a full descriptive sentence, not just a label
   - At least 1 "badge" item (a short trust signal like "Dermatologist Tested", "100% Natural", "Cruelty Free")
   - At least 1 "cta" item
   - Optionally 1 "quote" or "statistic" for social proof
4. Feature text should be FULL SENTENCES (15-30 words each), not just 2-3 word labels. E.g. "Cleanse with a gentle face wash to remove overnight impurities and prep your skin for the day."
5. Badge text should be SHORT (2-4 words). E.g. "Cruelty Free", "Made for Indian Skin", "Clean Ingredients"

OUTPUT FLEXIBILITY:
You have freedom over the 'elements' array composition. Match the intent — for EDUCATIONAL posts use numbered steps, for PRODUCT_HIGHLIGHT use ingredient callouts, for TESTIMONIAL use a quote block.

REQUIRED OUTPUT FORMAT (Return ONLY valid JSON):
{
  "intent": "Identify the core intent (e.g., EDUCATIONAL, COMPARISON, TESTIMONIAL, PROMOTIONAL, PRODUCT_HIGHLIGHT)",
  "primaryHeadline": "A 3-7 word powerful headline",
  "secondarySubtitle": "A 1-2 sentence compelling subheadline with clear value proposition",
  "elements": [
    {
      "type": "feature | quote | statistic | badge | paragraph | cta",
      "text": "The actual text — full sentences for features, short labels for badges. FOR CTA TYPE: MAXIMUM 5 WORDS. Examples: 'Shop Now', 'Try It Today', 'Get Started →', 'Book Free Demo'. Never write a full sentence as a CTA.",
      "icon": "A relevant emoji (optional, use sparingly)",
      "iconName": "A Lucide icon name. Choose from: shield-check, zap, brain, heart, star, award, target, trending-up, clock, users, globe, sparkles, check-circle, flask-conical, leaf, sun, eye, lock, rocket, bar-chart-2, palette, gem, crown, thumbs-up, lightbulb, microscope, droplets, wind, flame, layers",
      "value": "For statistics only: the big number like '40%' or '100+' or '3x'",
      "isNegative": "Boolean. True ONLY if this highlights a negative trait (e.g. 'No parabens'). False otherwise."
    }
  ]
}

CRITICAL: Return ONLY the JSON object. No markdown backticks, no prose. The elements array MUST have at least 5 items.`;

  try {
    const response = await callLlm({
      model: process.env.COPY_DIRECTOR_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are an elite copywriter. Output only valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 1200
    });

    let raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Copy Director returned empty response');
    
    // Clean markdown formatting if the LLM hallucinated backticks
    raw = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    
    const blueprint = JSON.parse(raw) as CopyBlueprint;
    logger.info(`✓ Successfully extracted copy blueprint: ${blueprint.primaryHeadline}`);
    return blueprint;

  } catch (error: any) {
    logger.error(`Copy Director failed: ${error.message}. Returning fallback copy.`);
    return {
      intent: 'GENERAL',
      primaryHeadline: params.topic ? params.topic.split(' ').slice(0, 4).join(' ') : 'Premium Excellence',
      secondarySubtitle: 'Experience the difference with our dedicated solutions.',
      elements: [
        { type: 'paragraph', text: 'Designed for optimal performance.' },
        { type: 'cta', text: 'Learn More' }
      ]
    };
  }
}
