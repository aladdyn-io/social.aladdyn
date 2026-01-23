/**
 * Image Generator Module
 * 
 * Responsibility: Generate images using Stable Diffusion (model-agnostic adapter)
 * AI-POWERED - Uses Stable Diffusion for image generation
 * 
 * WHY: Adapter pattern allows switching between different image generation providers
 */

import axios from 'axios';
import {
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageGenerationError,
} from '../types';

/**
 * Image generation provider types
 */
type ImageProvider = 'local' | 'replicate' | 'huggingface';

/**
 * Generates image using configured provider
 * 
 * Supports multiple backends:
 * - Local: Stable Diffusion running locally (e.g., AUTOMATIC1111)
 * - Replicate: Replicate API
 * - HuggingFace: HuggingFace Inference API
 * 
 * WHY: Adapter pattern makes it easy to switch providers
 * 
 * @param request - Image generation parameters
 * @returns Generated image as buffer
 * @throws ImageGenerationError if generation fails
 */
export async function generateImage(
  request: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const provider = (process.env.IMAGE_PROVIDER || 'local') as ImageProvider;
  
  console.log(`[ImageGenerator] Generating image using ${provider} provider...`);

  try {
    switch (provider) {
      case 'local':
        return await generateWithLocal(request);
      case 'replicate':
        return await generateWithReplicate(request);
      case 'huggingface':
        return await generateWithHuggingFace(request);
      default:
        throw new ImageGenerationError(`Unknown provider: ${provider}`, false);
    }
  } catch (error) {
    console.error('[ImageGenerator] ✗ Image generation failed:', error);
    
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    
    throw new ImageGenerationError(
      `Image generation failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

// ============================================================================
// LOCAL STABLE DIFFUSION (AUTOMATIC1111 API)
// ============================================================================

/**
 * Generate image using local Stable Diffusion instance
 * 
 * Requires: AUTOMATIC1111 webui running with --api flag
 * URL: http://localhost:7860
 * 
 * WHY: Free, unlimited, full control over model
 * 
 * TODO: Implement actual API call
 */
async function generateWithLocal(
  request: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const baseUrl = process.env.STABLE_DIFFUSION_URL || 'http://localhost:7860';
  
  // TODO: Implement AUTOMATIC1111 API call
  // Endpoint: POST /sdapi/v1/txt2img
  // See: https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API
  
  throw new ImageGenerationError(
    'Local Stable Diffusion not implemented yet. Set IMAGE_PROVIDER=replicate or huggingface',
    false
  );
  
  // STUB: What the implementation should look like:
  /*
  const response = await axios.post(`${baseUrl}/sdapi/v1/txt2img`, {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt || '',
    width: request.width || 1024,
    height: request.height || 1024,
    steps: request.steps || 30,
    seed: request.seed || -1,
  });

  const imageBase64 = response.data.images[0];
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  return {
    imageBuffer,
    metadata: {
      model: 'stable-diffusion-local',
      seed: response.data.info.seed,
      dimensions: { width: request.width || 1024, height: request.height || 1024 },
    },
  };
  */
}

// ============================================================================
// REPLICATE API
// ============================================================================

/**
 * Generate image using Replicate API
 * 
 * Model: stability-ai/sdxl
 * Requires: REPLICATE_API_TOKEN
 * 
 * WHY: Easy to use, pay-per-use, high quality
 * 
 * TODO: Implement actual API call
 */
async function generateWithReplicate(
  request: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  
  if (!apiToken) {
    throw new ImageGenerationError('REPLICATE_API_TOKEN not set', false);
  }

  // TODO: Implement Replicate API call
  // See: https://replicate.com/stability-ai/sdxl
  
  throw new ImageGenerationError(
    'Replicate provider not implemented yet',
    false
  );

  // STUB: What the implementation should look like:
  /*
  const response = await axios.post(
    'https://api.replicate.com/v1/predictions',
    {
      version: 'stable-diffusion-xl-version-id',
      input: {
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        width: request.width || 1024,
        height: request.height || 1024,
      },
    },
    {
      headers: {
        Authorization: `Token ${apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  // Poll for completion
  // Download image
  // Return buffer
  */
}

// ============================================================================
// HUGGINGFACE INFERENCE API
// ============================================================================

/**
 * Generate image using HuggingFace Inference API
 * 
 * Model: stabilityai/stable-diffusion-xl-base-1.0
 * Requires: HUGGINGFACE_API_TOKEN
 * 
 * WHY: Free tier available, simple API
 * 
 * Docs: https://huggingface.co/docs/api-inference/index
 */
async function generateWithHuggingFace(
  request: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const apiToken = process.env.HUGGINGFACE_API_TOKEN;
  
  if (!apiToken) {
    throw new ImageGenerationError('HUGGINGFACE_API_TOKEN not set', false);
  }

  try {
    // Build the full prompt
    const fullPrompt = request.prompt;
    
    console.log('[ImageGenerator] Calling HuggingFace API...');
    
    // HuggingFace Inference API call
    // Using a more reliable model endpoint
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      {
        inputs: fullPrompt,
        parameters: {
          num_inference_steps: request.steps || 4, // FLUX.1-schnell optimized for 4 steps
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout
      }
    );

    const imageBuffer = Buffer.from(response.data);

    console.log(`[ImageGenerator] ✓ Image generated (${imageBuffer.length} bytes)`);

    return {
      imageBuffer,
      metadata: {
        model: 'FLUX.1-schnell',
        dimensions: { 
          width: request.width || 1024, 
          height: request.height || 1024 
        },
      },
    };
  } catch (error: any) {
    // Handle specific HuggingFace API errors
    if (error.response?.status === 503) {
      throw new ImageGenerationError(
        'HuggingFace model is loading. Please wait 20-30 seconds and try again.',
        true
      );
    }
    
    if (error.response?.status === 401) {
      throw new ImageGenerationError(
        'Invalid HuggingFace API token. Please check HUGGINGFACE_API_TOKEN.',
        false
      );
    }

    if (error.response?.status === 429) {
      throw new ImageGenerationError(
        'Rate limit exceeded. Please wait a moment and try again.',
        true
      );
    }

    throw new ImageGenerationError(
      `HuggingFace API error: ${error.response?.data?.error || error.message}`,
      true
    );
  }
}
