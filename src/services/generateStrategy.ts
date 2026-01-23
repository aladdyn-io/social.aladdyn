/**
 * Content Strategy Generation Service
 * 
 * Uses AI (LLM) to generate a content strategy based on business context.
 * This is AI-POWERED logic - the ONLY module where LLM is called for strategy.
 */

import { Strategy } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates content strategy using LLM
 * 
 * WHY: Content strategy requires creative, context-aware decision making
 * WHY: AI can analyze industry + brand stage + geography to create balanced strategy
 * WHY: Validates response to ensure downstream modules get clean data
 * 
 * @param input - Normalized campaign input
 * @returns AI-generated content strategy
 * @throws Error if LLM call fails or returns invalid data after retry
 */
export async function generateStrategy(input: NormalizedInput): Promise<Strategy> {
  // Try to generate strategy (with one retry on JSON parse failure)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawResponse = await callLLM(input);
      
      // TODO: Log raw AI response for debugging
      // console.log('Raw AI response:', rawResponse);

      const strategy = parseAndValidate(rawResponse);
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

  const completion = await openai.chat.completions.create({
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
 * WHY: Clear structure helps LLM return consistent format
 */
function buildPrompt(input: NormalizedInput): string {
  return `
Generate a content strategy for a social media campaign with the following context:

Industry: ${input.industry}
Services: ${input.services.join(', ')}
Geography: ${input.geography}
Brand Stage: ${input.brand_stage}
Platform: ${input.platform}
Campaign Duration: ${input.total_days} days

Return a JSON object with this EXACT structure (no additional fields):
{
  "content_pillars": ["pillar1", "pillar2", "pillar3"],
  "tone": "description of brand tone and voice",
  "cta_style": "description of call-to-action approach",
  "content_mix": {
    "education": 30,
    "trust": 50,
    "promotion": 20
  }
}

Requirements:
- content_pillars: 3-5 themes relevant to ${input.industry}
- tone: Should match ${input.brand_stage} brand stage
- cta_style: Appropriate for ${input.geography} audience
- content_mix: Percentages MUST sum to exactly 100
- Consider that this is a ${input.brand_stage} brand in ${input.industry}

Return ONLY the JSON object, no explanation or markdown.
`.trim();
}

/**
 * Parses and validates LLM response
 * 
 * WHY: LLMs can hallucinate or return malformed data
 * WHY: Percentages must sum to 100 for downstream calendar logic
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
  };
}
