/**
 * Content Strategy Generation Service
 *
 * Uses OpenAI GPT-4o-mini to generate a content strategy.
 * Incorporates scraped website context from genie.aladdyn when available.
 */

import { Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';
import cache, { CacheTTL } from './cache';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateStrategy(
  input: NormalizedInput,
  websiteContext?: string
): Promise<Strategy> {
  const cacheKey = `strategy:${input.industry}:${input.brand_stage}:${input.geography}`;

  const cached = cache.get<Strategy>(cacheKey);
  if (cached) {
    console.log(`[Strategy] Cache hit for ${input.industry}/${input.geography}`);
    return cached;
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callOpenAI(input, websiteContext);
      const strategy = parseAndValidate(raw);
      cache.set(cacheKey, strategy, CacheTTL.STRATEGY);
      console.log(`[Strategy] Generated and cached for ${input.industry}`);
      return strategy;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }

  throw new Error('Strategy generation failed');
}

async function callOpenAI(input: NormalizedInput, websiteContext?: string): Promise<string> {
  const campaignGoal = input.campaign_goal || 'awareness';
  const needsPhases = input.total_days >= 14;

  let websiteSection = '';
  if (websiteContext) {
    websiteSection = `\n\nWEBSITE KNOWLEDGE (use this to make the strategy specific to this business):\n${websiteContext}\n`;
  }

  let phaseGuidance = '';
  if (needsPhases) {
    phaseGuidance = `\n\nIMPORTANT: This is a ${input.total_days}-day campaign. Create 2-3 temporal phases with progression from awareness → consideration → conversion.\n`;
  }

  const prompt = `Generate a content strategy for a social media campaign:

Industry: ${input.industry}
Services: ${input.services.join(', ')}
Geography: ${input.geography}
Brand Stage: ${input.brand_stage}
Platform: ${input.platform}
Campaign Duration: ${input.total_days} days
Campaign Goal: ${campaignGoal}
${websiteSection}${phaseGuidance}
Return JSON:
{
  "content_pillars": ["pillar1", "pillar2", "pillar3"],
  "tone": "brand tone description",
  "cta_style": "call-to-action approach",
  "content_mix": { "education": 30, "trust": 50, "promotion": 20 }${needsPhases ? `,
  "campaign_phases": [{ "dayRange": [1,7], "focus": "awareness", "contentMixOverride": {"education":60,"trust":30,"promotion":10}, "guidance": "..." }]` : ''}
}

Rules: content_mix must sum to 100. content_pillars: 3-5 items specific to this business.`;

  const completion = await openai.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a senior social media strategist. Return ONLY valid JSON, no markdown.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty response');
  return text;
}

function parseAndValidate(raw: string): Strategy {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Strategy response is not valid JSON');
  }

  if (!Array.isArray(parsed.content_pillars) || parsed.content_pillars.length < 3 || parsed.content_pillars.length > 5) {
    throw new Error('content_pillars must be an array of 3-5 items');
  }
  if (typeof parsed.tone !== 'string') throw new Error('tone must be a string');
  if (typeof parsed.cta_style !== 'string') throw new Error('cta_style must be a string');
  if (!parsed.content_mix || typeof parsed.content_mix !== 'object') throw new Error('content_mix required');

  const { education, trust, promotion } = parsed.content_mix;
  if (typeof education !== 'number' || typeof trust !== 'number' || typeof promotion !== 'number') {
    throw new Error('content_mix values must be numbers');
  }
  if (Math.abs(education + trust + promotion - 100) > 0.01) {
    throw new Error(`content_mix must sum to 100, got ${education + trust + promotion}`);
  }

  return {
    content_pillars: parsed.content_pillars,
    tone: parsed.tone,
    cta_style: parsed.cta_style,
    content_mix: { education, trust, promotion },
    campaign_phases: parsed.campaign_phases,
  };
}
