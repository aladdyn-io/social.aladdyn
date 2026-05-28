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
You must distill the essence of the caption/topic into short, punchy, high-converting visual ad copy.
You are NOT designing HTML. You are ONLY writing the text nodes.

OUTPUT FLEXIBILITY:
You have absolute freedom over the 'elements' array. Depending on what makes sense for this specific post, you can include features, a quote from the caption, a statistic, a badge, or a CTA. Don't force features if a quote is better.

REQUIRED OUTPUT FORMAT (Return ONLY valid JSON):
{
  "intent": "Identify the core intent (e.g., EDUCATIONAL, COMPARISON, TESTIMONIAL, PROMOTIONAL, PRODUCT_HIGHLIGHT)",
  "primaryHeadline": "A 2-6 word powerful headline. E.g., 'The Science of Glow'",
  "secondarySubtitle": "A 1-2 sentence compelling subheadline. E.g., 'Dermatologist backed ingredients for sensitive skin.'",
  "elements": [
    {
      "type": "feature | quote | statistic | badge | paragraph | cta",
      "text": "The actual text",
      "icon": "A relevant emoji (optional, use sparingly and only if it fits the brand tone)",
      "iconName": "A Lucide icon name that visually represents this element. Choose from: shield-check, zap, brain, heart, star, award, target, trending-up, clock, users, globe, sparkles, check-circle, flask-conical, leaf, sun, eye, lock, rocket, bar-chart-2, palette, gem, crown, thumbs-up, lightbulb, microscope, droplets, wind, flame, layers",
      "value": "For statistics only: the big number like '40%' or '100+' or '3x'",
      "isNegative": "Boolean. True ONLY if this highlights a negative trait (e.g. 'No parabens', 'Zero downtime', 'Without toxic chemicals'). False otherwise."
    }
  ]
}

CRITICAL: Return ONLY the JSON object. No markdown backticks, no prose.`;

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
      temperature: 0.7
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
