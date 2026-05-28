import sharp from 'sharp';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'saliency-analyzer' });

export interface SaliencyResult {
  /** The calculated safest 3x3 grid tile for placing text overlay */
  safestQuadrant: 'top_left' | 'top_center' | 'top_right' | 'middle_left' | 'middle_center' | 'middle_right' | 'bottom_left' | 'bottom_center' | 'bottom_right';
  
  /** Details of occupancy score per 3x3 tile (0 = empty safe, 1 = fully occupied busy) */
  quadrantScores: Record<string, number>;
}

/**
 * Deterministically analyzes the spatial detail density and subject occupancy of an image.
 * Uses sharp to split the image into a 3x3 grid (9 sectors) and computes quadrant scores:
 * 
 * 1. Transparency detection: If the image contains an alpha channel (e.g. rembg output),
 *    it calculates the percentage of solid pixels.
 * 2. Visual complexity check: If it's a flat RGB image, it samples local pixel variances/contrast.
 *    High contrast and detail signify busy areas (occupied), while uniform regions indicate negative space (safe).
 * 
 * @param imageBuffer - The binary image buffer to analyze
 */
export async function analyzeImageSaliency(imageBuffer: Buffer): Promise<SaliencyResult> {
  logger.info('Analyzing image spatial layout and saliency zones...');

  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    const hasAlpha = metadata.hasAlpha || false;

    // Define 9 spatial tiles mapping a strict 3x3 grid (Rule of Thirds)
    const w3 = Math.floor(width / 3);
    const h3 = Math.floor(height / 3);

    const quadrants = {
      top_left: { left: 0, top: 0, w: w3, h: h3 },
      top_center: { left: w3, top: 0, w: w3, h: h3 },
      top_right: { left: w3 * 2, top: 0, w: width - (w3 * 2), h: h3 },
      
      middle_left: { left: 0, top: h3, w: w3, h: h3 },
      middle_center: { left: w3, top: h3, w: w3, h: h3 },
      middle_right: { left: w3 * 2, top: h3, w: width - (w3 * 2), h: h3 },
      
      bottom_left: { left: 0, top: h3 * 2, w: w3, h: height - (h3 * 2) },
      bottom_center: { left: w3, top: h3 * 2, w: w3, h: height - (h3 * 2) },
      bottom_right: { left: w3 * 2, top: h3 * 2, w: width - (w3 * 2), h: height - (h3 * 2) }
    };

    const quadrantScores: Record<string, number> = {
      top_left: 0, top_center: 0, top_right: 0,
      middle_left: 0, middle_center: 0, middle_right: 0,
      bottom_left: 0, bottom_center: 0, bottom_right: 0
    };

    for (const [quad, rect] of Object.entries(quadrants)) {
      // Extract specific quadrant sub-buffer
      const cropped = await image
        .clone()
        .extract({ left: rect.left, top: rect.top, width: rect.w, height: rect.h })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixels = cropped.data;
      const channels = cropped.info.channels;
      const totalPixels = pixels.length / channels;

      if (hasAlpha && channels === 4) {
        // Method A: Transparency Occupancy (Count solid pixels where Alpha > 30)
        let solidCount = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 30) solidCount++;
        }
        quadrantScores[quad] = solidCount / totalPixels;
      } else {
        // Method B: Visual Detail Edge Density Heuristic (Standard Deviation of local pixel grayscale)
        let totalGray = 0;
        const grays: number[] = [];

        for (let i = 0; i < pixels.length; i += channels) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          // Grayscale conversion
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          totalGray += gray;
          grays.push(gray);
        }

        const avgGray = totalGray / totalPixels;
        let varianceSum = 0;
        for (let i = 0; i < grays.length; i++) {
          varianceSum += Math.pow(grays[i] - avgGray, 2);
        }
        const stdDev = Math.sqrt(varianceSum / totalPixels);

        // Normalize standard deviation (typically in 0-128 range) to a score between 0 and 1
        quadrantScores[quad] = Math.min(1.0, stdDev / 65);
      }
    }

    // Solve for the tile with the lowest occupancy score (safest), applying spatial bias to prefer top/middle zones for product layouts
    let safestQuadrant: any = 'top_left';
    let minScore = Infinity;

    for (const [quad, score] of Object.entries(quadrantScores)) {
      let biasPenalty = 0.0;
      if (quad.startsWith('bottom')) {
        // Heavy penalty for bottom overlays to protect table/pedestal staging zones from text collisions
        biasPenalty = 0.35;
      } else if (quad === 'middle_center') {
        biasPenalty = 0.05;
      }

      const biasedScore = score + biasPenalty;
      logger.info(`Quadrant '${quad}' -> Raw Score: ${score.toFixed(3)}, Biased Score: ${biasedScore.toFixed(3)}`);

      if (biasedScore < minScore) {
        minScore = biasedScore;
        safestQuadrant = quad as any;
      }
    }

    logger.info(`Safest quadrant solved: '${safestQuadrant}' (Score: ${minScore.toFixed(3)})`);

    return {
      safestQuadrant,
      quadrantScores
    };

  } catch (error: any) {
    logger.error(`Saliency grid analysis failed: ${error.message}. Defaulting to 'top_left' quadrant.`);
    return {
      safestQuadrant: 'top_left',
      quadrantScores: {
        top_left: 0, top_center: 0, top_right: 0,
        middle_left: 0, middle_center: 0, middle_right: 0,
        bottom_left: 0, bottom_center: 0, bottom_right: 0
      }
    };
  }
}
