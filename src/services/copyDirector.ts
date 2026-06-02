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
Distill the caption/topic into rich, information-dense visual ad copy. The ad should feel like a premium magazine advertisement or a highly engaging infographic.

MANDATORY INTENT-SPECIFIC ELEMENTS:
1. If the post intent is COMPARISON or "Us vs Them":
   - You MUST generate at least 4 "feature" items in elements. 
   - Even-indexed elements (0, 2) represent "Our Way" (positive benefits).
   - Odd-indexed elements (1, 3) represent "Others / Them" (negatives or compromises that competitors make, with isNegative set to true).
   - You MUST include 1 "badge" and 1 "cta" element.
2. If the post intent is TESTIMONIAL:
   - You MUST include exactly 1 "quote" element containing a powerful customer review (10-22 words).
   - You MUST include exactly 1 "badge" element representing the customer attribution/name (e.g. "Ananya S., Verified Customer").
   - You MUST include exactly 1 "badge" element containing rating stars ("★★★★★").
   - You MUST include exactly 1 "cta" element (max 5 words, e.g., "Shop Now").
   - You may include 1-2 additional "badge" elements for trust signals (e.g., "100% Organic", "Dermatologist Approved").
   - Do NOT generate any "feature" or "statistic" elements for testimonial posts, as they clutter the review layout and look amateur.
3. If the post intent is STATISTIC or Proof-based:
   - You MUST include at least 1-2 "statistic" elements with clear numeric 'value' fields (e.g. '40%', '3x', '10,000+') and descriptive labels in 'text' (e.g. 'Reduction in Fine Lines', 'Faster Execution Time').
   - You MUST include 1 "badge" and 1 "cta" element.
4. If the post intent is EDUCATIONAL or How-To:
   - You MUST generate 3-5 "feature" elements representing a numbered sequence of steps (e.g. "Step 1: Cleanse your skin...", "Step 2: Hydrate...").
   - You MUST include 1 "badge" and 1 "cta" element.
5. If the post intent is PRODUCT_HIGHLIGHT or promotional:
   - You MUST generate 3-5 "feature" elements highlighting active ingredients, product qualities, or benefits (full descriptive sentences, 15-30 words).
   - You MUST include at least 1 "badge" and 1 "cta" element.

MANDATORY RICHNESS RULES:
1. primaryHeadline: 3-7 words, bold and punchy. Can be split across 2 lines for drama.
2. secondarySubtitle: 1-2 sentences that expand on the headline with a clear value proposition.
3. elements array:
   - For COMPARISON, EDUCATIONAL, and PRODUCT_HIGHLIGHT intents: Array MUST contain 5-8 items, including at least 3-5 "feature" items (full descriptive sentences of 15-30 words each) and exactly 1 "cta".
   - For TESTIMONIAL intent: Array MUST contain exactly 4-6 items: 1 "quote", 1 customer name "badge", 1 stars "badge", 1 "cta", and optional 1-2 trust "badge" items. Absolutely no "feature" or "statistic" items.
   - For STATISTIC intent: Array MUST contain 4-6 items: 1-2 "statistic" items, 1-2 "badge" items, and exactly 1 "cta".
4. Feature text (when applicable) should be FULL SENTENCES. E.g. "Cleanse with a gentle face wash to remove overnight impurities and prep your skin for the day."
5. Badge text should be SHORT (2-4 words). E.g. "Cruelty Free", "Clean Ingredients"

OUTPUT FLEXIBILITY:
Write copy that aligns perfectly with the intent — for EDUCATIONAL posts use numbered steps, for PRODUCT_HIGHLIGHT use ingredient callouts, for TESTIMONIAL use a quote block and customer name.

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

CRITICAL: Return ONLY the JSON object. No markdown backticks, no prose. The elements array MUST satisfy the rules above.`;

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
