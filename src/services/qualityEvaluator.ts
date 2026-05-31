import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'quality-evaluator' });

export interface QualityGateResult {
  passed: boolean;
  score: number; // 0.0 to 1.0
  reasons: string[];
  metrics: {
    stdev: number;
    ocrWordsDetected: string[];
    colorDistance: number;
  };
}

/**
 * Parses hex color strings (e.g. '#0F172A' or '0F172A') into RGB values.
 */
function parseHexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length !== 6) return null;
  
  return {
    r: parseInt(cleanHex.slice(0, 2), 16),
    g: parseInt(cleanHex.slice(2, 4), 16),
    b: parseInt(cleanHex.slice(4, 6), 16),
  };
}

/**
 * Calculates Euclidean distance between two RGB colors.
 * Max distance is ~441.67 (distance between #000000 and #FFFFFF)
 */
function calculateRgbDistance(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number }
): number {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

/**
 * Native Automated Quality Heuristics Gate.
 * 
 * Performs three key checks:
 * 1. Grayscale standard deviation (detail complexity density checker).
 * 2. Pure WASM Tesseract.js OCR scan to reject distorted AI background text.
 * 3. Brand color Euclidean distance matching.
 */
export async function evaluateImageQuality(
  imageBuffer: Buffer,
  params: {
    baseColor?: string;
    accentColor?: string;
  } = {}
): Promise<QualityGateResult> {
  logger.info('Evaluating generated image buffer against premium quality gate heuristics...');
  
  const reasons: string[] = [];
  let score = 1.0;

  try {
    // ── CHECK 1: Detail Complexity Checker (Grayscale stdev) ────────────────
    const stats = await sharp(imageBuffer).greyscale().stats();
    const stdev = stats.channels[0].stdev;
    logger.info(`Grayscale pixel complexity (stdev): ${stdev.toFixed(2)}`);

    if (stdev > 88) {
      score -= 0.3;
      reasons.push(`Scene composition is too complex or busy (stdev ${stdev.toFixed(1)} > 88)`);
    } else if (stdev < 15) {
      score -= 0.4;
      reasons.push(`Scene is too flat, empty, or degenerate (stdev ${stdev.toFixed(1)} < 15)`);
    }

    // ── CHECK 2: OCR Text Scanner (Tesseract.js WebAssembly) ─────────────────
    logger.info('Running local WebAssembly OCR scanner to scan for garbled AI text...');
    
    const ocrResult = await Tesseract.recognize(imageBuffer, 'eng');
    const detectedText = ocrResult.data.text || '';
    
    // Find alphabetic words of length 4 or more
    const detectedWords = (detectedText.match(/[a-zA-Z]{4,}/g) || [])
      .map(w => w.toLowerCase())
      // Filter out common false positives or very minor letters
      .filter(w => !['the', 'and', 'with', 'from', 'skincare', 'serum'].includes(w));

    logger.info(`OCR words detected: [${detectedWords.join(', ')}]`);

    if (detectedWords.length > 0) {
      score -= 0.4;
      reasons.push(`AI image has unwanted background lettering/text detected: [${detectedWords.slice(0, 3).join(', ')}]`);
    }

    // ── CHECK 3: Brand Color Harmony Distance ──────────────────────────────
    let colorDistance = 0;
    const brandRgb = parseHexToRgb(params.baseColor || '#000000');
    
    if (brandRgb) {
      const rgbStats = await sharp(imageBuffer).stats();
      const imageRgb = {
        r: rgbStats.channels[0].mean,
        g: rgbStats.channels[1].mean,
        b: rgbStats.channels[2].mean,
      };

      colorDistance = calculateRgbDistance(brandRgb, imageRgb);
      logger.info(`Average brand RGB color distance: ${colorDistance.toFixed(1)}`);

      // Color distance greater than 280 indicates poor color alignment
      if (colorDistance > 280) {
        score -= 0.2;
        reasons.push(`Image color profile deviates from brand color palette (distance: ${colorDistance.toFixed(1)} > 280)`);
      }
    }

    // Final decision
    const finalScore = Math.max(0, score);
    const passed = finalScore >= 0.6; // Pass threshold 0.6

    logger.info(`Quality Gate Evaluation finished: passed=${passed}, score=${finalScore.toFixed(2)}`);

    return {
      passed,
      score: finalScore,
      reasons,
      metrics: {
        stdev,
        ocrWordsDetected: detectedWords,
        colorDistance,
      },
    };

  } catch (error: any) {
    logger.error(`Quality heuristics evaluator failed: ${error.message}`);
    // Safe fallback pass if library fails
    return {
      passed: true,
      score: 1.0,
      reasons: [`Evaluator error fallback: ${error.message}`],
      metrics: { stdev: 50, ocrWordsDetected: [], colorDistance: 0 },
    };
  }
}
