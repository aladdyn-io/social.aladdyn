/**
 * Strategy Generator Module
 * 
 * Responsibility: Generate content strategy using LLM
 * AI-POWERED - This is where we use the LLM
 * 
 * WHY: Content strategy requires creative decision-making that's best done by AI
 */

import { NormalizedInput, ContentStrategy, AIGenerationError } from '../types';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates content strategy using LLM
 * 
 * Process:
 * 1. Build detailed prompt with all context
 * 2. Call LLM with JSON mode enforced
 * 3. Validate response structure
 * 4. Return parsed strategy
 * 
 * @param input - Normalized campaign input
 * @returns Content strategy (validated JSON)
 * @throws AIGenerationError if LLM fails or returns invalid JSON
 */
export async function generateStrategy(
  input: NormalizedInput
): Promise<ContentStrategy> {
  console.log('[StrategyGenerator] Generating strategy with LLM...');

  try {
    // ========================================================================
    // BUILD PROMPT
    // ========================================================================
    
    const prompt = buildStrategyPrompt(input);

    // ========================================================================
    // CALL LLM (with JSON mode)
    // WHY: JSON mode ensures parseable output
    // ========================================================================
    
    const completion = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a professional social media content strategist. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7, // Some creativity, but not too random
    });

    const responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) {
      throw new AIGenerationError('LLM returned empty response', true);
    }

    // ========================================================================
    // PARSE AND VALIDATE
    // WHY: Ensure the LLM actually returned what we asked for
    // ========================================================================
    
    const strategy = JSON.parse(responseText) as ContentStrategy;
    validateStrategy(strategy);

    console.log('[StrategyGenerator] ✓ Strategy generated successfully');
    return strategy;
  } catch (error) {
    console.error('[StrategyGenerator] ✗ Failed to generate strategy:', error);
    
    if (error instanceof SyntaxError) {
      throw new AIGenerationError('LLM returned invalid JSON', true);
    }
    
    if (error instanceof AIGenerationError) {
      throw error;
    }
    
    throw new AIGenerationError(
      `Strategy generation failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

/**
 * Builds the prompt for strategy generation
 * WHY: Detailed prompts get better results from LLMs
 */
function buildStrategyPrompt(input: NormalizedInput): string {
  return `
Generate a content strategy for a social media campaign with the following details:

Industry: ${input.industry}
Services: ${input.services.join(', ')}
Geography: ${input.geography}
Campaign Duration: ${input.totalDays} days
Posts Required: ${input.totalPostsRequired}

Return a JSON object with this exact structure:
{
  "targetAudience": "string describing the target audience",
  "brandVoice": "string describing the brand voice (e.g., professional, friendly, authoritative)",
  "contentPillars": [
    {
      "name": "pillar name",
      "description": "what this pillar covers",
      "percentage": 30,
      "keywords": ["keyword1", "keyword2"]
    }
  ],
  "postingGuidelines": ["guideline1", "guideline2"],
  "hashtagStrategy": ["#hashtag1", "#hashtag2"]
}

Requirements:
- Create 3-5 content pillars
- Percentages must sum to 100
- Each pillar should be relevant to the industry and services
- Hashtags should be industry-specific and trending
- Guidelines should be actionable
`.trim();
}

/**
 * Validates strategy structure
 * WHY: LLMs can hallucinate or return malformed data
 */
function validateStrategy(strategy: any): asserts strategy is ContentStrategy {
  if (!strategy.targetAudience || typeof strategy.targetAudience !== 'string') {
    throw new AIGenerationError('Invalid strategy: missing targetAudience', false);
  }

  if (!strategy.brandVoice || typeof strategy.brandVoice !== 'string') {
    throw new AIGenerationError('Invalid strategy: missing brandVoice', false);
  }

  if (!Array.isArray(strategy.contentPillars) || strategy.contentPillars.length === 0) {
    throw new AIGenerationError('Invalid strategy: contentPillars must be non-empty array', false);
  }

  // Validate each pillar
  const totalPercentage = strategy.contentPillars.reduce((sum: number, pillar: any) => {
    if (!pillar.name || !pillar.description || typeof pillar.percentage !== 'number') {
      throw new AIGenerationError('Invalid strategy: malformed content pillar', false);
    }
    return sum + pillar.percentage;
  }, 0);

  // Allow 1% tolerance for rounding
  if (Math.abs(totalPercentage - 100) > 1) {
    throw new AIGenerationError(
      `Invalid strategy: pillar percentages sum to ${totalPercentage}, must equal 100`,
      false
    );
  }

  if (!Array.isArray(strategy.postingGuidelines)) {
    throw new AIGenerationError('Invalid strategy: postingGuidelines must be array', false);
  }

  if (!Array.isArray(strategy.hashtagStrategy)) {
    throw new AIGenerationError('Invalid strategy: hashtagStrategy must be array', false);
  }
}
