/**
 * AI-Based Topic Generation Service
 * 
 * Generates unique, contextual topics for calendar entries using LLM.
 * Replaces template-based topic generation with intelligent, campaign-aware topics.
 * 
 * Key Features:
 * - Campaign-phase awareness (early/mid/late)
 * - Duplicate detection (avoids repetitive topics)
 * - Brand context integration
 * - Pillar-specific topic generation
 * - Festival integration
 */

import OpenAI from 'openai';
import { ContentInput, Strategy, CampaignPhase } from '../types/content';
import { NormalizedInput } from './normalizeInput';
import { isTopicDuplicate } from '../db/database';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

interface TopicRequest {
  dayNumber: number;
  pillar: string;
  contentType: 'education' | 'trust' | 'promotion';
  isFestival: boolean;
  festivalName?: string;
  campaignPhase?: CampaignPhase;
  previousTopics?: string[];
}

/**
 * Determines which campaign phase a day belongs to
 */
function getCampaignPhase(
  dayNumber: number,
  totalDays: number,
  phases?: CampaignPhase[]
): CampaignPhase | undefined {
  if (!phases || phases.length === 0) {
    return undefined;
  }

  for (const phase of phases) {
    const [start, end] = phase.dayRange;
    if (dayNumber >= start && dayNumber <= end) {
      return phase;
    }
  }

  return undefined;
}

/**
 * Builds LLM prompt for topic generation
 */
function buildTopicPrompt(
  input: NormalizedInput,
  strategy: Strategy,
  request: TopicRequest
): string {
  const { dayNumber, pillar, contentType, isFestival, festivalName, campaignPhase, previousTopics } = request;

  let prompt = `You are a social media strategist generating specific, engaging topics for posts.

BRAND CONTEXT:
- Industry: ${input.industry}
- Services: ${input.services.join(', ')}
- Geography: ${input.geography}

CAMPAIGN CONTEXT:
- Duration: ${input.total_days} days (currently on Day ${dayNumber})
- Goal: ${input.campaign_goal || 'awareness'}
- Content Pillars: ${strategy.content_pillars.join(', ')}
- Tone: ${strategy.tone}`;

  if (campaignPhase) {
    prompt += `

CAMPAIGN PHASE: ${campaignPhase.focus}
- Days: ${campaignPhase.dayRange[0]}-${campaignPhase.dayRange[1]}
- Focus: ${campaignPhase.focus}
- Guidance: ${campaignPhase.guidance}`;
  }

  prompt += `

TODAY'S POST:
- Pillar: ${pillar}
- Content Type: ${contentType} (${
    contentType === 'education' ? 'Educational, informative' :
    contentType === 'trust' ? 'Trust-building, testimonial, behind-the-scenes' :
    'Promotional, offer-driven'
  })`;

  if (isFestival && festivalName) {
    prompt += `
- Festival: ${festivalName} (integrate this festival/holiday into the topic)`;
  }

  if (previousTopics && previousTopics.length > 0) {
    prompt += `

PREVIOUS TOPICS (avoid duplication):
${previousTopics.slice(-10).map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
  }

  prompt += `

TASK:
Generate ONE specific, actionable topic for today's post. The topic should:
1. Be relevant to the pillar: ${pillar}
2. Match the content type: ${contentType}
3. Align with the campaign phase focus${isFestival ? ` and integrate ${festivalName}` : ''}
4. NOT duplicate any previous topics
5. Be specific enough to guide content creation
6. Be 5-15 words long

GUIDELINES:
- For "education": Focus on tips, how-tos, industry insights, product education
- For "trust": Focus on customer stories, behind-the-scenes, brand values, team spotlights
- For "promotion": Focus on offers, product launches, limited-time deals, CTAs

OUTPUT FORMAT:
Return ONLY the topic text, nothing else. No numbering, no explanation, just the topic.

Example good topics:
- "How to choose the perfect smartphone for your budget"
- "Meet the team: Interview with our head designer"
- "Flash Sale: 30% off all accessories this weekend"
- "5 common mistakes when buying life insurance"`;

  return prompt;
}

/**
 * Generates a topic using LLM with duplicate detection and retry
 * 
 * @param input - Normalized campaign input
 * @param strategy - Generated strategy with phases
 * @param request - Topic request details
 * @param campaignId - Optional campaign ID for duplicate check
 * @param maxRetries - Maximum retry attempts for duplicates
 * @returns Generated topic string
 */
export async function generateTopic(
  input: NormalizedInput,
  strategy: Strategy,
  request: TopicRequest,
  campaignId?: string,
  maxRetries: number = 3
): Promise<string> {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      const prompt = buildTopicPrompt(input, strategy, request);

      const completion = await client.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
        max_tokens: 150,
        temperature: 0.8 + (attempts * 0.1), // Increase temperature on retries for more variety
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const topic = completion.choices[0]?.message?.content?.trim();

      if (!topic) {
        throw new Error('Empty response from LLM');
      }

      // Validate topic length
      if (topic.length < 10 || topic.length > 200) {
        throw new Error(`Invalid topic length: ${topic.length} characters`);
      }

      // Check for duplicates if campaignId provided
      if (campaignId) {
        const isDuplicate = await isTopicDuplicate(campaignId, topic);
        if (isDuplicate) {
          attempts++;
          console.warn(`[generateTopic] ⚠ Duplicate detected (attempt ${attempts}/${maxRetries}): "${topic}"`);
          
          if (attempts < maxRetries) {
            // Add duplicate to previous topics for next attempt
            request.previousTopics = [...(request.previousTopics || []), topic];
            continue; // Retry
          } else {
            console.warn(`[generateTopic] ⚠ Max retries reached, using potentially duplicate topic`);
          }
        }
      }

      return topic;
    } catch (error: any) {
      // Handle rate limit errors with exponential backoff
      if (error?.status === 429 || error?.code === 'rate_limit_exceeded') {
        const backoffDelay = Math.pow(2, attempts) * 1000; // 1s, 2s, 4s
        console.warn(`[generateTopic] ⚠ Rate limit hit, backing off ${backoffDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        attempts++;
        continue;
      }
      
      console.error('[generateTopic] ✗ Topic generation failed:', error);
      
      attempts++;
      if (attempts >= maxRetries) {
        // Fallback to template-based topic if all retries fail
        const fallback = `${request.pillar}: ${request.contentType} content for Day ${request.dayNumber}`;
        console.log(`[generateTopic] Using fallback topic: ${fallback}`);
        return fallback;
      }
    }
  }
  
  // Should never reach here, but return fallback just in case
  const fallback = `${request.pillar}: ${request.contentType} content for Day ${request.dayNumber}`;
  return fallback;
}

/**
 * Generates multiple topics in parallel with duplicate detection
 * 
 * OPTIMIZED: Increased batch size for better throughput
 * 
 * @param input - Normalized campaign input
 * @param strategy - Generated strategy
 * @param requests - Array of topic requests
 * @param campaignId - Optional campaign ID for duplicate check
 * @returns Array of generated topics
 */
export async function generateTopicsBatch(
  input: NormalizedInput,
  strategy: Strategy,
  requests: TopicRequest[],
  campaignId?: string
): Promise<string[]> {
  console.log(`[generateTopics] Generating ${requests.length} topics in parallel`);

  // OPTIMIZED: Increased from 10 to 20 for better throughput
  // OpenAI allows ~60 requests/sec, so 20 parallel is safe
  const chunkSize = 20;
  const results: string[] = [];

  for (let i = 0; i < requests.length; i += chunkSize) {
    const chunk = requests.slice(i, i + chunkSize);
    
    const chunkResults = await Promise.all(
      chunk.map((req) => generateTopic(input, strategy, req, campaignId))
    );
    
    results.push(...chunkResults);
    
    // Adaptive delay between chunks (rate limit management)
    if (i + chunkSize < requests.length) {
      const delay = calculateAdaptiveDelay(chunkResults.length);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.log(`[generateTopics] ✓ Generated ${results.length} topics`);
  return results;
}

/**
 * Calculate adaptive delay based on batch size
 * WHY: Dynamically adjust delay to optimize throughput without hitting rate limits
 * 
 * @param processedCount - Number of items just processed
 * @returns Delay in milliseconds
 */
function calculateAdaptiveDelay(processedCount: number): number {
  // Base delay: 100ms
  // Additional delay: 5ms per processed item
  // Max delay: 500ms
  const baseDelay = 100;
  const perItemDelay = 5;
  const maxDelay = 500;
  
  const calculatedDelay = baseDelay + (processedCount * perItemDelay);
  return Math.min(calculatedDelay, maxDelay);
}

/**
 * Helper to build topic requests from calendar items
 */
export function buildTopicRequests(
  calendar: Array<{
    day_number: number;
    pillar: string;
    content_type?: string;
    is_festival?: boolean;
    festival_name?: string;
  }>,
  input: NormalizedInput,
  strategy: Strategy,
  previousTopics: string[] = []
): TopicRequest[] {
  return calendar.map((entry, index) => {
    const contentType = (entry.content_type || 'education') as 'education' | 'trust' | 'promotion';
    
    const campaignPhase = getCampaignPhase(
      entry.day_number,
      input.total_days,
      strategy.campaign_phases
    );

    const previousTopicsForThisDay = previousTopics.slice(0, index);

    return {
      dayNumber: entry.day_number,
      pillar: entry.pillar,
      contentType,
      isFestival: entry.is_festival || false,
      festivalName: entry.festival_name,
      campaignPhase,
      previousTopics: previousTopicsForThisDay,
    };
  });
}
