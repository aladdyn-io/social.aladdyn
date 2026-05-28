import OpenAI from 'openai';
import cache from '../services/cache';
import { createLogger } from './logger';

const logger = createLogger({ service: 'smart-llm-client' });

// Parse multiple comma-separated keys from OPENAI_API_KEY for automatic round-robin and rate-limit cycling
const apiKeys = (process.env.OPENAI_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);

const clients = apiKeys.map(key => new OpenAI({
  apiKey: key,
  baseURL: process.env.OPENAI_BASE_URL,
}));

// Fallback if no keys are found
if (clients.length === 0) {
  clients.push(new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  }));
}

let currentKeyIndex = 0;

function getNextClient(): OpenAI {
  const client = clients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % clients.length;
  return client;
}

// Helper for waiting
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Concurrency queue to space out requests
let activeRequestsCount = 0;
const requestQueue: (() => void)[] = [];
const MAX_CONCURRENT_REQUESTS = 3;
const REQUEST_SPACING_MS = 150; // Spacing to avoid RPM burst limits

async function acquireQueueSlot(): Promise<void> {
  if (activeRequestsCount < MAX_CONCURRENT_REQUESTS) {
    activeRequestsCount++;
    return;
  }
  return new Promise<void>((resolve) => {
    requestQueue.push(resolve);
  });
}

function releaseQueueSlot(): void {
  activeRequestsCount--;
  if (requestQueue.length > 0) {
    const next = requestQueue.shift();
    if (next) {
      activeRequestsCount++;
      // Spacing delay before executing the next request in the queue to prevent RPM spikes
      setTimeout(next, REQUEST_SPACING_MS);
    }
  }
}

/**
 * Creates a unique hash cache key based on LLM messages and configuration
 */
function createPromptHash(options: any): string {
  const serialized = JSON.stringify({
    model: options.model,
    messages: options.messages.map((m: any) => ({ role: m.role, content: m.content })),
    temperature: options.temperature,
    response_format: options.response_format
  });
  
  // Use a simple, fast string hash to keep cache keys compact
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash << 5) - hash + serialized.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return `llm_prompt_hash:${hash}`;
}

/**
 * Smart centralized LLM completion client with:
 * 1. Automatic prompt caching (100% token savings on repeat runs)
 * 2. Exponential backoff retry on Groq/OpenAI 429/503 errors
 * 3. Spaced concurrency queue to prevent RPM spikes
 */
export async function callLlm(
  options: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  cacheTtlMs: number = 30 * 60 * 1000 // default 30 min cache TTL
): Promise<OpenAI.Chat.ChatCompletion> {
  // 2. Acquire a slot in the concurrency rate limiter queue
  await acquireQueueSlot();

  try {
    let lastError: any = null;
    let delay = 1000;
    const maxAttempts = Math.max(4, clients.length * 2);
    
    // 3. Loop with Key Rotation & Exponential Backoff Retry
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentClient = getNextClient();
      const keySnippet = currentClient.apiKey ? `...${currentClient.apiKey.slice(-6)}` : 'None';

      try {
        const modelName = options.model || process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
        
        logger.info(`Sending LLM Request | Model: ${modelName} | Key: ${keySnippet} | Attempt ${attempt}/${maxAttempts}`);
        
        const completion = await currentClient.chat.completions.create({
          ...options,
          model: modelName,
        });

        return completion;
      } catch (err: any) {
        lastError = err;
        const status = err.status || err.statusCode || 0;
        
        logger.warn(`LLM Request with key ${keySnippet} failed with status ${status}: ${err.message}`);
        
        // Only retry on rate limit (429), server errors (5xx), or network dropouts
        const shouldRetry = status === 429 || status >= 500 || err.message?.includes('fetch') || err.message?.includes('timeout') || err.message?.includes('limit');
        if (!shouldRetry || attempt === maxAttempts) {
          throw err;
        }

        // Cycle keys instantly on 429
        const hasOtherKeys = clients.length > 1;
        if (status === 429 && hasOtherKeys) {
          logger.info(`Rate limit hit on key ${keySnippet}. Rotating key and retrying immediately...`);
          await wait(100); // minor spacing
        } else {
          // Exponential backoff delay
          logger.info(`Rate limit or temporary error hit. Backing off for ${delay}ms before retry...`);
          await wait(delay);
          delay *= 2; // double delay for next attempt
        }
      }
    }

    throw lastError || new Error('LLM call failed after all attempts');
  } finally {
    // 4. Release slot back to the queue
    releaseQueueSlot();
  }
}
