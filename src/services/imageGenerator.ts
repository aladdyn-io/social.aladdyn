/**
 * Image Generation Service
 * 
 * Adapter-based design for model-agnostic image generation.
 * Uses HuggingFace Inference API for real AI image generation.
 * 
 * WHY adapter pattern: Allows swapping image generation models
 * (Stable Diffusion, DALL-E, Midjourney, etc.) without changing
 * downstream code.
 */

import axios from 'axios';
import Replicate from 'replicate';
import sharp from 'sharp';
import { CalendarItem } from '../types/content';
import { NormalizedInput } from './normalizeInput';

// ============================================================================
// TYPES
// ============================================================================

/**
 * ImagePrompt - Structured prompt for image generation
 * 
 * WHY: Structured prompts are easier to template and version
 * WHY: Different models might use different prompt formats
 */
export interface ImagePrompt {
  /** Topic or theme of the image */
  topic: string;

  /** Business industry for context */
  industry: string;

  /** Content pillar/theme */
  pillar: string;

  /** Brand colors for visual consistency */
  brandColors: {
    base: string;
    accent: string;
  };

  /** Content type (always "image" for V1) */
  contentType: string;

  /** Whether this is a festival post */
  isFestival: boolean;

  /** Festival name if applicable */
  festivalName?: string;
}

/**
 * ImageGenerationResult - Result from image generation
 * 
 * WHY: Encapsulates both image data and metadata
 */
export interface ImageGenerationResult {
  /** Image data as buffer (for upload) */
  imageBuffer: Buffer;

  /** Metadata about generation */
  metadata: {
    /** Which model/generator was used */
    model: string;

    /** Dimensions of generated image */
    dimensions: {
      width: number;
      height: number;
    };

    /** The full prompt sent to the model (for debugging) */
    prompt?: string;
  };
}

// ============================================================================
// IMAGE GENERATOR INTERFACE
// ============================================================================

/**
 * ImageGenerator - Interface for all image generation adapters
 * 
 * WHY: Interface ensures all generators have consistent API
 * WHY: Makes it easy to swap between Stable Diffusion, DALL-E, etc.
 */
export interface ImageGenerator {
  /**
   * Generates an image based on structured prompt
   * 
   * @param prompt - Structured image prompt
   * @returns Generated image with metadata
   */
  generate(prompt: ImagePrompt): Promise<ImageGenerationResult>;
}

// ============================================================================
// LOCAL/MOCK IMPLEMENTATION
// ============================================================================

/**
 * LocalGenerator - Generates placeholder images locally using Sharp
 * 
 * WHY: No API keys needed, works offline, instant generation
 * WHY: Great for development and testing
 */
class LocalGenerator implements ImageGenerator {
  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    console.log(`[ImageGenerator] Generating placeholder image locally...`);
    console.log(`[ImageGenerator] Topic: ${prompt.topic}`);

    try {
      // Create a gradient background based on brand colors
      const width = 1024;
      const height = 1024;

      // Parse hex colors to RGB
      const baseColor = this.hexToRgb(prompt.brandColors.base);
      const accentColor = this.hexToRgb(prompt.brandColors.accent);

      // Create gradient image using sharp
      const svg = `
        <svg width="${width}" height="${height}">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:${prompt.brandColors.base};stop-opacity:1" />
              <stop offset="100%" style="stop-color:${prompt.brandColors.accent};stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="url(#grad1)" />
          
          <!-- Add text overlay -->
          <text x="50%" y="45%" text-anchor="middle" font-family="Arial, sans-serif" font-size="60" font-weight="bold" fill="white" stroke="rgba(0,0,0,0.3)" stroke-width="2">
            ${this.escapeXml(prompt.industry)}
          </text>
          <text x="50%" y="55%" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" fill="white" opacity="0.9">
            ${this.escapeXml(prompt.pillar)}
          </text>
          ${prompt.isFestival ? `
          <text x="50%" y="65%" text-anchor="middle" font-family="Arial, sans-serif" font-size="35" fill="white" opacity="0.8">
            🎉 ${this.escapeXml(prompt.festivalName || '')}
          </text>
          ` : ''}
        </svg>
      `;

      const imageBuffer = await sharp(Buffer.from(svg))
        .png()
        .toBuffer();

      console.log(`[ImageGenerator] ✓ Generated placeholder (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

      return {
        imageBuffer,
        metadata: {
          model: 'local-placeholder',
          dimensions: {
            width,
            height,
          },
          prompt: `${prompt.industry} - ${prompt.pillar}${prompt.isFestival ? ` - ${prompt.festivalName}` : ''}`,
        },
      };
    } catch (error: any) {
      console.error('[ImageGenerator] ✗ Local generation failed:', error.message);
      throw new Error(`Local image generation error: ${error.message}`);
    }
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 100, g: 100, b: 100 };
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// ============================================================================
// DEEPAI IMPLEMENTATION
// ============================================================================

/**
 * DeepAIGenerator - AI image generation using DeepAI API
 * 
 * API: text2img
 * WHY: Simple API, free tier available, reliable service
 */
class DeepAIGenerator implements ImageGenerator {
  private readonly apiKey: string;
  private readonly endpoint = 'https://api.deepai.org/api/text2img';

  constructor() {
    const key = process.env.DEEPAI_API_KEY;
    if (!key) {
      throw new Error('DEEPAI_API_KEY environment variable is required');
    }
    this.apiKey = key;
  }

  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    const fullPrompt = this.buildModelPrompt(prompt);
    
    console.log(`[ImageGenerator] Generating with DeepAI...`);
    console.log(`[ImageGenerator] Prompt: ${fullPrompt.substring(0, 100)}...`);

    try {
      const response = await axios.post(
        this.endpoint,
        { text: fullPrompt },
        {
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        }
      );

      // DeepAI returns JSON with output_url
      const imageUrl = response.data.output_url;
      
      if (!imageUrl) {
        throw new Error('DeepAI returned no image URL');
      }

      // Download the image
      console.log(`[ImageGenerator] Downloading from ${imageUrl}...`);
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const imageBuffer = Buffer.from(imageResponse.data);
      
      console.log(`[ImageGenerator] ✓ Generated image (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

      return {
        imageBuffer,
        metadata: {
          model: 'deepai-text2img',
          dimensions: {
            width: 512,
            height: 512,
          },
          prompt: fullPrompt,
        },
      };
    } catch (error: any) {
      console.error('[ImageGenerator] ✗ Generation failed:', error.message);

      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error(
          'Invalid DeepAI API key. Check DEEPAI_API_KEY environment variable.'
        );
      }

      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }

      if (error.response?.data) {
        throw new Error(
          `DeepAI API error: ${JSON.stringify(error.response.data)}`
        );
      }

      throw new Error(
        `DeepAI API error: ${error.message}`
      );
    }
  }

  /**
   * Builds prompt for DeepAI model
   */
  private buildModelPrompt(prompt: ImagePrompt): string {
    const baseStyle = 'professional social media post design, modern aesthetic, high quality, vibrant colors, clean layout, eye-catching';

    if (prompt.isFestival) {
      return `${prompt.festivalName} celebration image for ${prompt.industry} business, festive theme, ${prompt.festivalName} decorations, celebratory atmosphere, ${baseStyle}`;
    } else {
      return `${prompt.industry} business, ${prompt.pillar} content theme, ${prompt.topic}, ${baseStyle}, ${prompt.brandColors.accent} color accent`;
    }
  }
}

// ============================================================================
// REPLICATE IMPLEMENTATION
// ============================================================================

/**
 * ReplicateGenerator - AI image generation using Replicate API
 * 
 * Model: black-forest-labs/flux-schnell
 * WHY: Replicate has reliable API, good free tier, FLUX model available
 */
class ReplicateGenerator implements ImageGenerator {
  private readonly replicate: Replicate;
  private readonly model = 'black-forest-labs/flux-schnell';

  constructor() {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      throw new Error('REPLICATE_API_TOKEN environment variable is required');
    }
    this.replicate = new Replicate({
      auth: token,
    });
  }

  /** Generate using a fully-formed detailed prompt (on-demand path). */
  async generateFromDetailedPrompt(detailedPrompt: string): Promise<ImageGenerationResult> {
    return this.runReplicate(detailedPrompt);
  }

  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    return this.runReplicate(this.buildModelPrompt(prompt));
  }

  private async runReplicate(fullPrompt: string): Promise<ImageGenerationResult> {
    console.log(`[ImageGenerator] Generating with Replicate (${this.model})...`);
    console.log(`[ImageGenerator] Prompt: ${fullPrompt.substring(0, 100)}...`);

    try {
      const output: any = await this.replicate.run(
        this.model as any,
        {
          input: {
            prompt: fullPrompt,
            num_outputs: 1,
            aspect_ratio: '1:1',
            output_format: 'png',
            output_quality: 80,
          },
        }
      );

      // Replicate returns an array of URLs
      const imageUrl = Array.isArray(output) ? output[0] : output;
      
      if (!imageUrl) {
        throw new Error('Replicate returned no image URL');
      }

      // Download the image
      console.log(`[ImageGenerator] Downloading from ${imageUrl}...`);
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const imageBuffer = Buffer.from(response.data);
      
      console.log(`[ImageGenerator] ✓ Generated image (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

      return {
        imageBuffer,
        metadata: {
          model: this.model,
          dimensions: {
            width: 1024,
            height: 1024,
          },
          prompt: fullPrompt,
        },
      };
    } catch (error: any) {
      console.error('[ImageGenerator] ✗ Generation failed:', error.message);

      if (error.response?.status === 401) {
        throw new Error(
          'Invalid Replicate API token. Check REPLICATE_API_TOKEN environment variable.'
        );
      }

      if (error.response?.status === 402) {
        throw new Error('Replicate API credit exhausted. Please add credits to your account.');
      }

      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }

      throw new Error(
        `Replicate API error: ${error.message}`
      );
    }
  }

  /**
   * Builds optimized prompt for FLUX model
   * 
   * WHY: FLUX models work best with clear, descriptive prompts
   */
  private buildModelPrompt(prompt: ImagePrompt): string {
    const baseStyle = 'professional social media post design, modern aesthetic, high quality, vibrant colors, clean layout, eye-catching';

    if (prompt.isFestival) {
      return `${prompt.festivalName} celebration image for ${prompt.industry} business, festive theme, ${prompt.festivalName} decorations, celebratory atmosphere, ${baseStyle}`;
    } else {
      return `${prompt.industry} business, ${prompt.pillar} content theme, ${prompt.topic}, ${baseStyle}, ${prompt.brandColors.accent} color accent`;
    }
  }
}

// ============================================================================
// HUGGINGFACE IMPLEMENTATION
// ============================================================================

/**
 * HuggingFaceGenerator - Real AI image generation using HuggingFace API
 * 
 * Model: XLabs-AI/flux-RealismLora
 * WHY: Community FLUX model available on free tier
 */
class HuggingFaceGenerator implements ImageGenerator {
  private readonly apiToken: string;
  private readonly model = 'XLabs-AI/flux-RealismLora';

  constructor() {
    const token = process.env.HUGGINGFACE_API_TOKEN;
    if (!token) {
      throw new Error('HUGGINGFACE_API_TOKEN environment variable is required');
    }
    this.apiToken = token;
  }

  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    const fullPrompt = this.buildModelPrompt(prompt);
    
    console.log(`[ImageGenerator] Generating with HuggingFace (${this.model})...`);
    console.log(`[ImageGenerator] Prompt: ${fullPrompt.substring(0, 100)}...`);

    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${this.model}`,
        {
          inputs: fullPrompt,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 90000, // 90 second timeout
        }
      );

      const imageBuffer = Buffer.from(response.data);
      
      if (imageBuffer.length < 1000) {
        // Likely an error message, not an image
        const errorText = imageBuffer.toString('utf-8');
        throw new Error(`HuggingFace returned invalid response: ${errorText}`);
      }
      
      console.log(`[ImageGenerator] ✓ Generated image (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

      return {
        imageBuffer,
        metadata: {
          model: this.model,
          dimensions: {
            width: 1024,  // FLUX.1-schnell default size
            height: 1024,
          },
          prompt: fullPrompt,
        },
      };
    } catch (error: any) {
      console.error('[ImageGenerator] ✗ Generation failed:', error.message);

      // Handle specific HuggingFace errors
      if (error.response?.status === 503) {
        throw new Error(
          'HuggingFace model is loading. Please wait 20-30 seconds and try again.'
        );
      }

      if (error.response?.status === 401) {
        throw new Error(
          'Invalid HuggingFace API token. Check HUGGINGFACE_API_TOKEN environment variable.'
        );
      }
      
      if (error.response?.status === 410) {
        throw new Error(
          `Model ${this.model} is no longer available. Please update to a different model.`
        );
      }

      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }

      if (error.code === 'ECONNABORTED') {
        throw new Error('Image generation timeout. The model may be too slow or unavailable.');
      }

      throw new Error(
        `HuggingFace API error: ${error.response?.data?.error || error.message}`
      );
    }
  }

  /**
   * Builds optimized prompt for FLUX model
   * 
   * WHY: FLUX models work best with clear, descriptive prompts
   */
  private buildModelPrompt(prompt: ImagePrompt): string {
    const baseStyle = 'professional social media post design, modern aesthetic, high quality, vibrant colors, clean layout, eye-catching';

    if (prompt.isFestival) {
      return `${prompt.festivalName} celebration image for ${prompt.industry} business, festive theme, ${prompt.festivalName} decorations, celebratory atmosphere, ${baseStyle}`;
    } else {
      return `${prompt.industry} business, ${prompt.pillar} content theme, ${prompt.topic}, ${baseStyle}, ${prompt.brandColors.accent} color accent`;
    }
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generates image from a pre-written detailed prompt (on-demand workflow).
 *
 * Uses Replicate (FLUX schnell) when IMAGE_PROVIDER=replicate, otherwise local.
 * The prompt is taken directly from the post's stored imagePrompt field so the
 * AI-crafted context is preserved.
 */
export async function generateImageFromPrompt(
  detailedPrompt: string
): Promise<ImageGenerationResult> {
  const provider = process.env.IMAGE_PROVIDER || 'local';

  if (provider === 'replicate') {
    const generator = new ReplicateGenerator();
    // Bypass buildModelPrompt — use the detailed prompt verbatim
    return generator.generateFromDetailedPrompt(detailedPrompt);
  }

  // Fallback: local placeholder
  const localGen = new LocalGenerator();
  const dummyPrompt: ImagePrompt = {
    topic: detailedPrompt.slice(0, 80),
    industry: 'Business',
    pillar: 'Content',
    brandColors: { base: '#764ba2', accent: '#667eea' },
    contentType: 'photo',
    isFestival: false,
  };
  return localGen.generate(dummyPrompt);
}

/**
 * Generates image for a calendar item
 *
 * WHY: Single entry point for image generation across the app
 * WHY: Hides implementation details from calling code
 *
 * @param calendarItem - Calendar entry to generate image for
 * @param normalized - Normalized campaign input
 * @returns Image generation result with buffer and metadata
 */
export async function generateImage(
  calendarItem: CalendarItem,
  normalized: NormalizedInput
): Promise<ImageGenerationResult> {
  // Build structured prompt from inputs
  const prompt: ImagePrompt = {
    topic: calendarItem.topic,
    industry: normalized.industry,
    pillar: calendarItem.pillar,
    brandColors: {
      base: normalized.base_color,
      accent: normalized.accent_color,
    },
    contentType: calendarItem.content_type,
    isFestival: calendarItem.is_festival,
    festivalName: calendarItem.festival_name,
  };

  // Select generator based on environment variable
  const imageProvider = process.env.IMAGE_PROVIDER || 'local';
  
  let generator: ImageGenerator;
  
  if (imageProvider === 'local') {
    generator = new LocalGenerator();
  } else if (imageProvider === 'deepai') {
    generator = new DeepAIGenerator();
  } else if (imageProvider === 'replicate') {
    generator = new ReplicateGenerator();
  } else if (imageProvider === 'huggingface') {
    generator = new HuggingFaceGenerator();
  } else {
    throw new Error(`Unsupported IMAGE_PROVIDER: ${imageProvider}. Use 'local', 'deepai', 'replicate', or 'huggingface'`);
  }

  // Generate image
  const result = await generator.generate(prompt);

  return result;
}
