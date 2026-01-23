/**
 * Image Generation Service
 * 
 * Adapter-based design for model-agnostic image generation.
 * V1 uses a stub generator that returns placeholders.
 * 
 * WHY adapter pattern: Allows swapping image generation models
 * (Stable Diffusion, DALL-E, Midjourney, etc.) without changing
 * downstream code.
 */

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
// STUB IMPLEMENTATION (V1)
// ============================================================================

/**
 * StubImageGenerator - Placeholder generator for V1
 * 
 * WHY: Allows testing entire pipeline without real image generation
 * WHY: Returns placeholder images that can be uploaded and displayed
 */
class StubImageGenerator implements ImageGenerator {
  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    // TODO: In production, this would call:
    // - Stable Diffusion API
    // - DALL-E API
    // - SDXL local model
    // - Or any other image generation service

    // Log what the prompt WOULD be for a real model
    const fullPrompt = this.buildModelPrompt(prompt);
    console.log('[ImageGenerator] STUB: Would generate image with prompt:', fullPrompt);

    // Generate a simple placeholder image buffer
    // WHY: Real buffer allows testing upload pipeline
    const placeholderBuffer = this.generatePlaceholder(prompt);

    return {
      imageBuffer: placeholderBuffer,
      metadata: {
        model: 'stub-v1',
        dimensions: {
          width: 1024,
          height: 1024,
        },
        prompt: fullPrompt,
      },
    };
  }

  /**
   * Builds prompt string that WOULD be sent to a real model
   * 
   * WHY: Documents prompt engineering strategy for future implementation
   */
  private buildModelPrompt(prompt: ImagePrompt): string {
    if (prompt.isFestival) {
      // Festival post prompt
      return `Professional social media image for ${prompt.festivalName}, ${prompt.industry} business, celebration theme, vibrant festive colors, modern design, high quality, 4k`;
    } else {
      // Regular post prompt
      return `Professional social media image for ${prompt.industry}, ${prompt.pillar} content, modern design, ${prompt.brandColors.accent} accent color, clean composition, high quality, 4k`;
    }
  }

  /**
   * Generates a simple placeholder image buffer
   * 
   * WHY: Returns actual image data for testing upload pipeline
   * WHY: Small colored square is enough for V1
   */
  private generatePlaceholder(prompt: ImagePrompt): Buffer {
    // Create a simple 1024x1024 PNG placeholder
    // WHY: PNG header + colored square is minimal but valid image
    
    // For V1, return a minimal valid PNG buffer
    // In production, this would be the actual generated image
    
    // Simple 1x1 pixel PNG (smallest valid PNG)
    // WHY: Minimal size, still uploadable and displayable
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x00, 0x01, // Width: 1
      0x00, 0x00, 0x00, 0x01, // Height: 1
      0x08, 0x02, 0x00, 0x00, 0x00, // Bit depth: 8, Color type: 2 (RGB), compression, filter, interlace
      0x90, 0x77, 0x53, 0xde, // CRC
      0x00, 0x00, 0x00, 0x0c, // IDAT chunk length
      0x49, 0x44, 0x41, 0x54, // "IDAT"
      0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, // Image data (red pixel)
      0x18, 0xdd, 0x8d, 0xb4, // CRC
      0x00, 0x00, 0x00, 0x00, // IEND chunk length
      0x49, 0x45, 0x4e, 0x44, // "IEND"
      0xae, 0x42, 0x60, 0x82, // CRC
    ]);

    return pngHeader;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

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

  // Use stub generator for V1
  // TODO: In future versions, select generator based on config:
  // - new StableDiffusionGenerator()
  // - new DALLEGenerator()
  // - new SDXLGenerator()
  const generator: ImageGenerator = new StubImageGenerator();

  // Generate image
  const result = await generator.generate(prompt);

  return result;
}

// ============================================================================
// FUTURE GENERATOR EXAMPLES (COMMENTED OUT)
// ============================================================================

/*
// Example: Real Stable Diffusion implementation
class StableDiffusionGenerator implements ImageGenerator {
  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    const sdPrompt = this.buildSDPrompt(prompt);
    
    // Call Stable Diffusion API
    const response = await axios.post('http://localhost:7860/sdapi/v1/txt2img', {
      prompt: sdPrompt,
      negative_prompt: 'low quality, blurry, text, watermark',
      width: 1024,
      height: 1024,
      steps: 30,
    });

    const imageBuffer = Buffer.from(response.data.images[0], 'base64');

    return {
      imageBuffer,
      metadata: {
        model: 'stable-diffusion-xl',
        dimensions: { width: 1024, height: 1024 },
        prompt: sdPrompt,
      },
    };
  }

  private buildSDPrompt(prompt: ImagePrompt): string {
    // Stable Diffusion-specific prompt engineering
    return `...`;
  }
}

// Example: DALL-E implementation
class DALLEGenerator implements ImageGenerator {
  async generate(prompt: ImagePrompt): Promise<ImageGenerationResult> {
    // Call OpenAI DALL-E API
    // ...
  }
}
*/
