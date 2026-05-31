import sharp from 'sharp';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'color-analyzer' });

export interface RegionColorMetrics {
  isDarkBg: boolean;
  averageColorHex: string;
  averageColorName: string;
}

export interface ColorMetrics {
  /** Contrast-safe text hex color for the headline (e.g. '#FFFFFF' or '#111111') */
  headlineColor: string;
  
  /** Contrast-safe text hex color for subtitles/paragraphs (e.g. '#E5E5E5' or '#444444') */
  subtitleColor: string;
  
  /** Whether the background under the text is dark */
  isDarkBg: boolean;
  
  /** Automatically calculated background overlay opacity based on local pixel clutter */
  bgOpacityOverride: number;
  
  /** Estimated dominant light direction based on luminance gradient across quadrants */
  lightDirection?: {
    /** Horizontal: -1 (light from left) to +1 (light from right) */
    horizontal: number;
    /** Vertical: -1 (light from top) to +1 (light from bottom) */
    vertical: number;
  };

  /** Average hex color of the background quadrant under the text */
  averageColorHex?: string;

  /** Guess of the dominant visual background color name (e.g., 'Warm Beige', 'Vivid Red') */
  averageColorName?: string;

  /** Dynamic region-specific background color metrics sampled separately for headlines, subtitles, features, and buttons */
  detailedRegions?: {
    quadrantHeadline: RegionColorMetrics;
    quadrantSubtitle: RegionColorMetrics;
    quadrantFeatures: RegionColorMetrics;
    quadrantCta: RegionColorMetrics;
    columnHeadline: RegionColorMetrics;
    columnSubtitle: RegionColorMetrics;
    columnFeatures: RegionColorMetrics;
    columnCta: RegionColorMetrics;
  };
}

/**
 * Deterministically samples the local background pixel data of a target quadrant
 * and computes relative luminance to solve for a readable contrast-safe text color.
 * 
 * Implements WCAG 2.1 contrast formulas.
 * 
 * @param imageBuffer - The binary image buffer of the generated ad background
 * @param quadrant - The target quadrant for text overlay ('top_left' | 'top_right' | 'bottom_left' | 'bottom_right')
 * @param insetPercent - Bounding box inset percentage from the canvas edges (default: 8%)
 */
export async function analyzeLocalColors(
  imageBuffer: Buffer,
  quadrant: string,
  insetPercent: number = 8
): Promise<ColorMetrics> {
  logger.info(`Analyzing localized colors for quadrant: ${quadrant}`);

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // 1. Calculate boundaries based on quadrant selection
    let left = 0;
    let top = 0;
    const boxWidth = Math.floor(width / 2);
    const boxHeight = Math.floor(height / 2);

    const quad = quadrant.toLowerCase();
    if (quad === 'center') {
      left = Math.floor(width / 4);
      top = Math.floor(height / 4);
    } else if (quad === 'top_center') {
      left = Math.floor(width / 4);
      top = 0;
    } else if (quad === 'bottom_center') {
      left = Math.floor(width / 4);
      top = Math.floor(height / 2);
    } else {
      if (quad.includes('right')) {
        left = Math.floor(width / 2);
      }
      if (quad.includes('bottom')) {
        top = Math.floor(height / 2);
      }
    }

    // Apply safe inset offset boundaries
    const offset = Math.floor((width * insetPercent) / 100);
    const adjustedLeft = Math.max(0, left + (left === 0 ? offset : -offset));
    const adjustedTop = Math.max(0, top + (top === 0 ? offset : -offset));

    // 2. Crop the quadrant bounding box area
    const croppedBuffer = await image
      .extract({
        left: adjustedLeft,
        top: adjustedTop,
        width: Math.min(boxWidth - offset, width - adjustedLeft),
        height: Math.min(boxHeight - offset, height - adjustedTop),
      })
      .raw() // Get raw pixel values (RGB)
      .toBuffer({ resolveWithObject: true });

    const pixels = croppedBuffer.data;
    const channels = croppedBuffer.info.channels; // Expected 3 for RGB or 4 for RGBA
    const totalPixels = pixels.length / channels;

    let totalLuminance = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    const luminanceValues: number[] = [];

    // 3. Loop over pixels and compute relative luminance (sRGB specifications)
    for (let i = 0; i < pixels.length; i += channels) {
      // Accumulate raw channels for average color calculation
      totalR += pixels[i];
      totalG += pixels[i + 1];
      totalB += pixels[i + 2];

      // Normalize raw color channels to [0, 1] range
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;

      // Linearize sRGB values to solve for luminance
      const rL = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const gL = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const bL = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

      // Relative luminance formula coefficients
      const lum = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
      totalLuminance += lum;
      luminanceValues.push(lum);
    }

    const avgLuminance = totalLuminance / totalPixels;
    const isDark = avgLuminance < 0.45;

    const avgR = Math.round(totalR / totalPixels);
    const avgG = Math.round(totalG / totalPixels);
    const avgB = Math.round(totalB / totalPixels);

    const toHex = (c: number) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    const averageColorHex = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
    const averageColorName = guessColorName(avgR, avgG, avgB);

    // 4. Calculate visual clutter/clutter standard deviation
    let varianceSum = 0;
    for (let i = 0; i < luminanceValues.length; i++) {
      varianceSum += Math.pow(luminanceValues[i] - avgLuminance, 2);
    }
    const stdDev = Math.sqrt(varianceSum / totalPixels);

    // If visual complexity/clutter standard deviation is high, request glass backplate overlay opacity
    const bgOpacityOverride = stdDev > 0.18
      ? Math.max(0.45, Math.min(0.85, stdDev * 2.6))
      : 0.0;

    logger.info(`Analysis complete. Avg Luminance: ${avgLuminance.toFixed(3)}, Dark: ${isDark}, Clutter Dev: ${stdDev.toFixed(3)}`);

    // 5. Estimate dominant light direction from full image luminance gradient
    let lightHorizontal = 0;
    let lightVertical = 0;
    try {
      // Sample 4 edge strips of the full image
      const fullImage = sharp(imageBuffer);
      const fullMeta = await fullImage.metadata();
      const fw = fullMeta.width || 1024;
      const fh = fullMeta.height || 1024;
      const stripSize = Math.floor(fw * 0.25);
      
      const sampleStrip = async (left: number, top: number, w: number, h: number) => {
        const strip = await sharp(imageBuffer)
          .extract({ left, top, width: w, height: h })
          .greyscale()
          .stats();
        return strip.channels[0].mean / 255; // normalize to 0-1
      };
      
      const leftLum = await sampleStrip(0, 0, stripSize, fh);
      const rightLum = await sampleStrip(fw - stripSize, 0, stripSize, fh);
      const topLum = await sampleStrip(0, 0, fw, stripSize);
      const bottomLum = await sampleStrip(0, fh - stripSize, fw, stripSize);
      
      lightHorizontal = rightLum - leftLum; // positive = light from right
      lightVertical = bottomLum - topLum;   // positive = light from bottom
      
      logger.info(`Light direction estimated: H=${lightHorizontal.toFixed(3)}, V=${lightVertical.toFixed(3)}`);
    } catch (e) {
      logger.warn(`Light direction analysis failed, defaulting to top-left. ${e}`);
    }

    // 6. Detailed Region-by-Region Color analysis for absolute legibility
    let detailedRegions = undefined;
    try {
      const sharpImage = sharp(imageBuffer);
      
      // Horizontal bounds: same for both quadrant and column layouts
      const regLeft = adjustedLeft;
      const regWidth = Math.min(boxWidth - offset, width - adjustedLeft);

      // A. Quadrant-specific sub-regions
      const qHeadline = await analyzeRegionColor(sharpImage, regLeft, adjustedTop, regWidth, (boxHeight - offset) * 0.35, width, height);
      const qSubtitle = await analyzeRegionColor(sharpImage, regLeft, adjustedTop + (boxHeight - offset) * 0.35, regWidth, (boxHeight - offset) * 0.30, width, height);
      const qFeatures = await analyzeRegionColor(sharpImage, regLeft, adjustedTop + (boxHeight - offset) * 0.65, regWidth, (boxHeight - offset) * 0.20, width, height);
      const qCta = await analyzeRegionColor(sharpImage, regLeft, adjustedTop + (boxHeight - offset) * 0.85, regWidth, (boxHeight - offset) * 0.15, width, height);

      // B. Column-specific sub-regions (spans entire vertical height)
      const cHeadline = await analyzeRegionColor(sharpImage, regLeft, height * 0.05, regWidth, height * 0.25, width, height);
      const cSubtitle = await analyzeRegionColor(sharpImage, regLeft, height * 0.30, regWidth, height * 0.30, width, height);
      const cFeatures = await analyzeRegionColor(sharpImage, regLeft, height * 0.60, regWidth, height * 0.23, width, height);
      const cCta = await analyzeRegionColor(sharpImage, regLeft, height * 0.83, regWidth, height * 0.12, width, height);

      detailedRegions = {
        quadrantHeadline: qHeadline,
        quadrantSubtitle: qSubtitle,
        quadrantFeatures: qFeatures,
        quadrantCta: qCta,
        columnHeadline: cHeadline,
        columnSubtitle: cSubtitle,
        columnFeatures: cFeatures,
        columnCta: cCta
      };
    } catch (e: any) {
      logger.warn(`Detailed region color analysis failed or skipped: ${e.message}`);
      const fallbackRegion = { isDarkBg: isDark, averageColorHex, averageColorName };
      detailedRegions = {
        quadrantHeadline: fallbackRegion,
        quadrantSubtitle: fallbackRegion,
        quadrantFeatures: fallbackRegion,
        quadrantCta: fallbackRegion,
        columnHeadline: fallbackRegion,
        columnSubtitle: fallbackRegion,
        columnFeatures: fallbackRegion,
        columnCta: fallbackRegion
      };
    }

    return {
      headlineColor: isDark ? '#FFFFFF' : '#111111',
      subtitleColor: isDark ? '#E2E8F0' : '#1E293B',
      isDarkBg: isDark,
      bgOpacityOverride,
      lightDirection: {
        horizontal: lightHorizontal,
        vertical: lightVertical
      },
      averageColorHex,
      averageColorName,
      detailedRegions
    };

  } catch (error: any) {
    logger.error(`Localized color analysis failed: ${error.message}. Falling back to default dark contrast safety rules.`);
    const fallbackRegion = { isDarkBg: true, averageColorHex: '#121212', averageColorName: 'Unknown Dark Backdrop' };
    return {
      headlineColor: '#FFFFFF',
      subtitleColor: '#E2E8F0',
      isDarkBg: true,
      bgOpacityOverride: 0.5,
      lightDirection: { horizontal: -0.1, vertical: -0.1 },
      averageColorHex: '#121212',
      averageColorName: 'Unknown Dark Backdrop',
      detailedRegions: {
        quadrantHeadline: fallbackRegion,
        quadrantSubtitle: fallbackRegion,
        quadrantFeatures: fallbackRegion,
        quadrantCta: fallbackRegion,
        columnHeadline: fallbackRegion,
        columnSubtitle: fallbackRegion,
        columnFeatures: fallbackRegion,
        columnCta: fallbackRegion
      }
    };
  }
}

/**
 * High-end visual color name guesser that maps average RGB values to descriptive design color names.
 */
function guessColorName(r: number, g: number, b: number): string {
  if (r > 220 && g > 220 && b > 220) return 'Bright White / Light Sunlit Beige';
  if (r < 35 && g < 35 && b < 35) return 'Deep Black / Dark Charcoal';
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  if (delta < 20) {
    return max > 128 ? 'Medium Light Grey' : 'Medium Dark Slate / Grey';
  }
  
  if (max === r) {
    if (g > 180 && b < 100) return 'Warm Golden Yellow';
    if (g > 100 && g <= 180 && b < 100) return 'Warm Terracotta / Orange / Amber';
    if (b > 100 && g < 100) return 'Plum / Purple / Pink';
    return 'Vivid Red / Crimson';
  }
  
  if (max === g) {
    if (r > 180 && b < 100) return 'Golden Yellowish Green';
    if (b > 150) return 'Teal / Cyan';
    return 'Fresh Leaf Green';
  }
  
  if (max === b) {
    if (r > 120 && g < 100) return 'Purple / Indigo / Violet';
    if (g > 150) return 'Bright Blue-Green / Turquoise';
    return 'Vibrant Royal Blue';
  }
  
  return 'Warm Neutral Beige';
}

/**
 * Samples the localized background color metrics of a specific sub-region.
 */
async function analyzeRegionColor(
  image: sharp.Sharp,
  left: number,
  top: number,
  w: number,
  h: number,
  maxWidth: number,
  maxHeight: number
): Promise<RegionColorMetrics> {
  try {
    const croppedBuffer = await image
      .clone()
      .extract({
        left: Math.max(0, Math.floor(left)),
        top: Math.max(0, Math.floor(top)),
        width: Math.min(Math.floor(w), maxWidth - Math.max(0, Math.floor(left))),
        height: Math.min(Math.floor(h), maxHeight - Math.max(0, Math.floor(top))),
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = croppedBuffer.data;
    const channels = croppedBuffer.info.channels;
    const totalPixels = pixels.length / channels;

    let totalLuminance = 0;
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;

    for (let i = 0; i < pixels.length; i += channels) {
      totalR += pixels[i];
      totalG += pixels[i + 1];
      totalB += pixels[i + 2];

      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;

      const rL = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const gL = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const bL = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

      const lum = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
      totalLuminance += lum;
    }

    const avgLuminance = totalLuminance / totalPixels;
    const isDark = avgLuminance < 0.45;

    const avgR = Math.round(totalR / totalPixels);
    const avgG = Math.round(totalG / totalPixels);
    const avgB = Math.round(totalB / totalPixels);

    const toHex = (c: number) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    const averageColorHex = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
    const averageColorName = guessColorName(avgR, avgG, avgB);

    return {
      isDarkBg: isDark,
      averageColorHex,
      averageColorName
    };
  } catch (err) {
    return {
      isDarkBg: true,
      averageColorHex: '#121212',
      averageColorName: 'Default Fallback Dark'
    };
  }
}
