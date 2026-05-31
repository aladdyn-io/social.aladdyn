/**
 * Caption Generation Service
 *
 * Uses OpenAI GPT-4o-mini to generate social media captions.
 * Incorporates scraped website context for business-specific copy.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { callLlm } from '../utils/llmClient';
const isOpenAiDisabled =
  process.env.OPENAI_DISABLED === 'true' ||
  process.env.AI_DISABLED === 'true' ||
  !process.env.OPENAI_API_KEY;

const isQuotaError = (error: unknown): boolean => {
  const err = error as {
    code?: string;
    status?: number;
    message?: string;
    error?: { code?: string };
  };

  return (
    err?.code === 'insufficient_quota' ||
    err?.error?.code === 'insufficient_quota' ||
    (err?.status === 429 &&
      typeof err?.message === 'string' &&
      err.message.includes('insufficient_quota'))
  );
};

const buildFallbackCaption = (
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput
): string => {
  const topicLine = calendarItem.is_festival
    ? `Celebrating ${calendarItem.festival_name}: ${calendarItem.topic}.`
    : `${calendarItem.topic}.`;

  const valueLine = `Serving ${normalized.geography} with ${normalized.services.join(', ')}.`;
  const ctaLine = strategy.cta_style || 'Learn more about our services.';

  return `${topicLine}
${valueLine}
${ctaLine}`.trim();
};

export async function generateCaption(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput,
  websiteContext?: string,
  feedback?: string
): Promise<string> {
  if (isOpenAiDisabled) {
    return validateCaption(buildFallbackCaption(calendarItem, strategy, normalized));
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callOpenAI(calendarItem, strategy, normalized, websiteContext, feedback);
      return validateCaption(raw);
    } catch (error: any) {
      if (isQuotaError(error)) {
        return validateCaption(buildFallbackCaption(calendarItem, strategy, normalized));
      }
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.warn(`[Caption] Rate limit, backoff ${delay}ms (attempt ${attempt}/3)`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt === 3) throw error;
    }
  }
  throw new Error('Caption generation failed');
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
- Format with clean paragraph spacing and clear line breaks between thoughts for excellent readability. Do NOT output a single wall of text.
- Feel free to use emojis and formatting creatively where appropriate.
- Include a call-to-action.
- Reference services naturally if relevant.
- Write for ${normalized.geography} audience.
- Do NOT wrap the caption in any outer double quotes or single quotes.
${educationalFormatRule}

Return ONLY the raw caption text without any introductory text, markdown code blocks, or wrapping quotes.`;

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

  let cleaned = caption.trim();

  // Strip wrapping quotes (single, double, backticks)
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith('`') && cleaned.endsWith('`')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  // Strip any markdown code blocks
  if (cleaned.startsWith('```') && cleaned.endsWith('```')) {
    cleaned = cleaned.slice(3, -3).trim();
  }

  // Handle case where some LLMs might return "Caption: ..." prefix
  if (/^caption:\s*/i.test(cleaned)) {
    cleaned = cleaned.replace(/^caption:\s*/i, '').trim();
  }

  return cleaned;
}
