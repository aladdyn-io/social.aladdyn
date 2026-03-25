/**
 * Caption Generation Service
 *
 * Uses OpenAI GPT-4o-mini to generate social media captions.
 * Incorporates scraped website context for business-specific copy.
 */

import { CalendarItem, Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateCaption(
  calendarItem: CalendarItem,
  strategy: Strategy,
  normalized: NormalizedInput,
  websiteContext?: string
): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callOpenAI(calendarItem, strategy, normalized, websiteContext);
      return validateCaption(raw);
    } catch (error: any) {
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
  websiteContext?: string
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

  const prompt = `Write a social media caption for a ${normalized.platform} post.

Business: ${normalized.industry} | ${normalized.geography}
Services: ${servicesText}
Content Pillar: ${item.pillar}
${festivalNote}
${websiteSection}
Tone: ${strategy.tone}
CTA: ${strategy.cta_style}

Rules:
- 4-6 lines maximum
- NO emojis, NO markdown, NO hashtags, plain text only
- Include a call-to-action
- Reference services naturally if relevant
- Write for ${normalized.geography} audience

Return ONLY the caption text.`;

  const completion = await openai.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a professional social media copywriter. Write clear, engaging captions without emojis or markdown.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 200,
  });

  const caption = completion.choices[0]?.message?.content?.trim();
  if (!caption) throw new Error('OpenAI returned empty caption');
  return caption;
}

function validateCaption(caption: string): string {
  if (!caption || caption.length < 20) throw new Error('Caption too short');

  let cleaned = caption;
  if (cleaned.length > 500) {
    const truncated = cleaned.substring(0, 450);
    const lastEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
    cleaned = lastEnd > 100 ? cleaned.substring(0, lastEnd + 1) : truncated.split(' ').slice(0, -1).join(' ') + '...';
  }

  cleaned = cleaned.replace(/[*_`#]/g, '');
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}]/gu, '');
  return cleaned.trim();
}
