/**
 * Content Strategy Generation Service
 * 
 * Uses AI (LLM) to generate a content strategy based on business context.
 * This is AI-POWERED logic - the ONLY module where LLM is called for strategy.
 */

import { Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';
import cache, { CacheTTL, CacheKey } from './cache';
import { geminiClient } from '../utils/geminiAdapter';

// Use Gemini if configured, otherwise use OpenAI
const llmClient = process.env.LLM_PROVIDER === 'gemini' 
  ? geminiClient 
  : new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });

/**
 * Generates content strategy using LLM with caching
 * 
 * WHY: Content strategy requires creative, context-aware decision making
 * WHY: AI can analyze industry + brand stage + geography to create balanced strategy
 * WHY: Validates response to ensure downstream modules get clean data
 * WHY: Caches results to avoid regenerating for same inputs (1 hour TTL)
 * 
 * @param input - Normalized campaign input
 * @returns AI-generated content strategy
 * @throws Error if LLM call fails or returns invalid data after retry
 */
export async function generateStrategy(input: NormalizedInput): Promise<Strategy> {
  // Generate cache key from input characteristics
  const cacheKey = `strategy:${input.industry}:${input.brand_stage}:${input.geography}`;
  
  // Check cache first
  const cached = cache.get<Strategy>(cacheKey);
  if (cached) {
    console.log(`[Strategy] ✓ Cache hit for ${input.industry}/${input.brand_stage}/${input.geography}`);
    return cached;
  }

  console.log(`[Strategy] ✗ Cache miss, generating new strategy...`);

  // Try to generate strategy (with one retry on JSON parse failure)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawResponse = await callLLM(input);
      
      // TODO: Log raw AI response for debugging
      // console.log('Raw AI response:', rawResponse);

      const strategy = parseAndValidate(rawResponse);
      
      // Cache the generated strategy (1 hour TTL)
      cache.set(cacheKey, strategy, CacheTTL.STRATEGY);
      console.log(`[Strategy] ✓ Cached strategy for ${input.industry}/${input.brand_stage}/${input.geography}`);
      
      return strategy;
    } catch (error) {
      if (attempt === 2) {
        // WHY: After 2 attempts, fail fast - don't waste resources
        throw new Error(
          `Strategy generation failed after retry: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      // WHY: Retry once in case of transient JSON formatting issues
      continue;
    }
  }

  throw new Error('Strategy generation failed');
}

/**
 * Calls LLM with structured prompt
 * 
 * WHY: Separate function makes testing easier
 * WHY: Single prompt template keeps behavior consistent
 */
async function callLLM(input: NormalizedInput): Promise<string> {
  const prompt = buildPrompt(input);

  const completion = await llmClient.chat.completions.create({
    model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: 'You are a senior social media strategist. Return ONLY valid JSON with no markdown formatting or explanation.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' }, // WHY: Forces JSON output
    temperature: 0.7, // WHY: Some creativity but not too random
  });

  const responseText = completion.choices[0]?.message?.content;

  if (!responseText) {
    throw new Error('LLM returned empty response');
  }

  return responseText;
}

/**
 * Builds prompt for LLM
 * 
 * WHY: Industry, geography, and brand stage should influence strategy
 * WHY: Campaign goal determines content approach (awareness vs conversion)
 * WHY: Campaign duration determines if temporal phases are needed
 * WHY: Clear structure helps LLM return consistent format
 */
function buildPrompt(input: NormalizedInput): string {
  const campaignGoal = input.campaign_goal || 'awareness';
  const needsPhases = input.total_days >= 14; // Campaigns 2+ weeks get temporal phases

  let phaseGuidance = '';
  if (needsPhases) {
    phaseGuidance = `

IMPORTANT: This is a ${input.total_days}-day campaign. Create 2-3 temporal phases:
- Early phase (awareness/education focus)
- Mid phase (consideration/trust focus)  
- Late phase (conversion/action focus)

For each phase, specify:
- Day range [startDay, endDay]
- Phase focus (awareness/consideration/conversion)
- Content mix override if different from base
- Strategic guidance

Example phase structure:
{
  "dayRange": [1, 7],
  "focus": "awareness",
  "contentMixOverride": {"education": 60, "trust": 30, "promotion": 10},
  "guidance": "Focus on educating audience about problem space"
}`;
  }

  return `
Generate a content strategy for a social media campaign with the following context:

Industry: ${input.industry}
Services: ${input.services.join(', ')}
Geography: ${input.geography}
Brand Stage: ${input.brand_stage}
Platform: ${input.platform}
Campaign Duration: ${input.total_days} days
Campaign Goal: ${campaignGoal}

${phaseGuidance}

Return a JSON object with this structure:
{
  "content_pillars": ["pillar1", "pillar2", "pillar3"],
  "tone": "description of brand tone and voice",
  "cta_style": "description of call-to-action approach",
  "content_mix": {
    "education": 30,
    "trust": 50,
    "promotion": 20
  }${needsPhases ? `,
  "campaign_phases": [
    {
      "dayRange": [1, 7],
      "focus": "awareness",
      "contentMixOverride": {"education": 60, "trust": 30, "promotion": 10},
      "guidance": "Phase-specific guidance"
    }
  ]` : ''}
}

Requirements:
- content_pillars: 3-5 themes relevant to ${input.industry}
- tone: Should match ${input.brand_stage} brand stage and ${campaignGoal} goal
- cta_style: Appropriate for ${input.geography} audience and ${campaignGoal} objective
- content_mix: Percentages MUST sum to exactly 100
- Consider this is a ${campaignGoal} campaign - adjust strategy accordingly:
  * awareness: Education-heavy, soft CTAs
  * consideration: Trust-building, social proof
  * conversion: Direct CTAs, promotional
  * retention: Value-add, community-building
${needsPhases ? `- campaign_phases: Create ${Math.ceil(input.total_days / 7)} phases with clear progression` : ''}

Return ONLY the JSON object, no explanation or markdown.
`.trim();
}

/**
 * Parses and validates LLM response
 * 
 * WHY: LLMs can hallucinate or return malformed data
 * WHY: Percentages must sum to 100 for downstream calendar logic
 * WHY: Campaign phases must have valid day ranges
 */
function parseAndValidate(rawResponse: string): Strategy {
  let parsed: any;

  try {
    parsed = JSON.parse(rawResponse);
  } catch (error) {
    throw new Error('LLM response is not valid JSON');
  }

  // Validate structure
  if (!parsed.content_pillars || !Array.isArray(parsed.content_pillars)) {
    throw new Error('Invalid strategy: content_pillars must be an array');
  }

  if (parsed.content_pillars.length < 3 || parsed.content_pillars.length > 5) {
    throw new Error('Invalid strategy: content_pillars must have 3-5 items');
  }

  if (!parsed.tone || typeof parsed.tone !== 'string') {
    throw new Error('Invalid strategy: tone must be a string');
  }

  if (!parsed.cta_style || typeof parsed.cta_style !== 'string') {
    throw new Error('Invalid strategy: cta_style must be a string');
  }

  if (!parsed.content_mix || typeof parsed.content_mix !== 'object') {
    throw new Error('Invalid strategy: content_mix must be an object');
  }

  const { education, trust, promotion } = parsed.content_mix;

  if (
    typeof education !== 'number' ||
    typeof trust !== 'number' ||
    typeof promotion !== 'number'
  ) {
    throw new Error('Invalid strategy: content_mix values must be numbers');
  }

  // WHY: Calendar generation relies on this summing to 100
  const sum = education + trust + promotion;
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`Invalid strategy: content_mix must sum to 100, got ${sum}`);
  }

  // Validate campaign_phases if present
  if (parsed.campaign_phases) {
    if (!Array.isArray(parsed.campaign_phases)) {
      throw new Error('Invalid strategy: campaign_phases must be an array');
    }

    for (const phase of parsed.campaign_phases) {
      if (!phase.dayRange || !Array.isArray(phase.dayRange) || phase.dayRange.length !== 2) {
        throw new Error('Invalid strategy: phase dayRange must be [startDay, endDay]');
      }

      if (phase.dayRange[0] < 1 || phase.dayRange[1] < phase.dayRange[0]) {
        throw new Error('Invalid strategy: phase dayRange has invalid values');
      }

      if (!phase.focus || typeof phase.focus !== 'string') {
        throw new Error('Invalid strategy: phase focus must be a string');
      }

      // Validate contentMixOverride if present
      if (phase.contentMixOverride) {
        const { education: e, trust: t, promotion: p } = phase.contentMixOverride;
        if (typeof e !== 'number' || typeof t !== 'number' || typeof p !== 'number') {
          throw new Error('Invalid strategy: phase contentMixOverride values must be numbers');
        }
        const phaseSum = e + t + p;
        if (Math.abs(phaseSum - 100) > 0.01) {
          throw new Error(`Invalid strategy: phase contentMixOverride must sum to 100, got ${phaseSum}`);
        }
      }
    }
  }

  // Return validated strategy
  return {
    content_pillars: parsed.content_pillars,
    tone: parsed.tone,
    cta_style: parsed.cta_style,
    content_mix: {
      education,
      trust,
      promotion,
    },
    campaign_phases: parsed.campaign_phases,
  };
}
