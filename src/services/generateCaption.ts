/**
 * Caption Generation Service
 *
 * Uses OpenAI GPT-4o-mini to generate social media captions.
 * Incorporates scraped website context for business-specific copy.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { callLlm } from '../utils/llmClient';

export async function generateCaption(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput,
  websiteContext?: string,
  feedback?: string
): Promise<string> {
  const raw = await callOpenAI(calendarItem, strategy, normalized, websiteContext, feedback);
  return validateCaption(raw);
}

async function callOpenAI(
  item: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput,
  websiteContext?: string,
  feedback?: string
): Promise<string> {
  const servicesText = normalized.services.length > 0
    ? normalized.services.join(', ')
    : normalized.industry;

  const festivalNote = item.is_festival
    ? `This is a festival post for ${item.festival_name}. Reference it respectfully and connect to the business.`
    : `Topic: ${item.topic}`;

  let websiteSection = '';
  if (websiteContext) {
    websiteSection = `\nBUSINESS KNOWLEDGE (use specific details from this):\n${websiteContext.slice(0, 600)}\n`;
  }

  let feedbackSection = '';
  if (feedback) {
    feedbackSection = `\nUSER FEEDBACK / DIRECTIONS (You MUST follow these specific instructions and modify/refine the caption according to them):\n"${feedback}"\n`;
  }

  const isEducationalOrList = /\b(myth|fact|vs|versus|tips|how to|guide|steps|benefits|features|reasons|secrets|myths)\b/i.test(item.topic || '') || /\b(education|informative|tutorial)\b/i.test(item.pillar || '');
  let educationalFormatRule = '';
  if (isEducationalOrList) {
    educationalFormatRule = `\n- Since this is an educational/informative topic ("${item.topic}"), feel free to creatively structure the core content so it's easy to read and highly engaging. Structure it however best fits the narrative.\n`;
  }

  const prompt = `Write a social media caption for a ${normalized.platform} post.

Business: ${normalized.industry} | ${normalized.geography}
Services: ${servicesText}
Content Pillar: ${item.pillar}
${festivalNote}
${websiteSection}
${feedbackSection}
Tone: ${strategy.tone}
CTA: ${strategy.cta_style}

Rules:
- Keep it engaging, natural, and highly compelling.
- Feel free to use emojis and formatting creatively where appropriate.
- Include a call-to-action
- Reference services naturally if relevant
- Write for ${normalized.geography} audience
${educationalFormatRule}

Return ONLY the caption text.`;

  const completion = await callLlm({
    model: process.env.CAPTION_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: 'You are an elite, highly creative social media copywriter. Write engaging, native-feeling captions that grab attention.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 200,
  });

  const caption = completion.choices[0]?.message?.content?.trim();
  if (!caption) throw new Error('LLM returned empty caption');
  return caption;
}

function validateCaption(caption: string): string {
  if (!caption || caption.length < 20) throw new Error('Caption too short');

  return caption.trim();
}
