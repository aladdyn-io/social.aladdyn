/**
 * Groq LLM Adapter
 * 
 * Provides OpenAI-compatible interface using Groq API
 */

import OpenAI from 'openai';

const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletion {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

/**
 * OpenAI-compatible wrapper for Groq
 */
export const geminiClient = {
  chat: {
    completions: {
      create: async (options: ChatCompletionOptions): Promise<ChatCompletion> => {
        // Map model names to Groq models
        let modelName = options.model || process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
        
        // Map common model names to Groq equivalents
        if (modelName.includes('gpt') || modelName.includes('gemini')) {
          modelName = 'llama-3.3-70b-versatile';
        }

        // Call Groq API (OpenAI-compatible)
        const completion = await groqClient.chat.completions.create({
          model: modelName,
          messages: options.messages,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
          response_format: options.response_format,
        });

        return {
          choices: [
            {
              message: {
                content: completion.choices[0]?.message?.content || null,
              },
            },
          ],
        };
      },
    },
  },
};
