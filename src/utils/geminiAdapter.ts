/**
 * Google Gemini Adapter
 * 
 * Provides OpenAI-compatible interface for Google Gemini API
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.OPENAI_API_KEY || '');

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
 * OpenAI-compatible wrapper for Gemini
 */
export const geminiClient = {
  chat: {
    completions: {
      create: async (options: ChatCompletionOptions): Promise<ChatCompletion> => {
        // Combine system and user messages for Gemini
        const systemMessage = options.messages.find(m => m.role === 'system')?.content || '';
        const userMessage = options.messages.find(m => m.role === 'user')?.content || '';
        
        let prompt = userMessage;
        if (systemMessage) {
          prompt = `${systemMessage}\n\n${userMessage}`;
        }
        
        // Add JSON instruction if needed
        if (options.response_format?.type === 'json_object') {
          prompt += '\n\nIMPORTANT: You must respond with valid JSON only. Do not include any text before or after the JSON.';
        }

        // Get model - use gemini-pro as default (most stable)
        let modelName = options.model || 'gemini-pro';
        
        // Map common model names to working Gemini models
        if (modelName.includes('flash')) {
          modelName = 'gemini-pro'; // Fallback to pro if flash not available
        }
        
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.max_tokens,
          },
        });

        // Call Gemini
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return {
          choices: [
            {
              message: {
                content: text,
              },
            },
          ],
        };
      },
    },
  },
};
