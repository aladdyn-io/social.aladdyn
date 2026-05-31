import { removeBackground } from '@imgly/background-removal-node';
import { createLogger } from '../utils/logger';

const logger = createLogger({ service: 'subject-masker' });

/**
 * Detects MIME type from image buffer magic bytes.
 * Supports JPEG, PNG, WebP, and GIF detection.
 */
function detectMimeType(buffer: Buffer): string {
  if (buffer.length < 4) return 'image/png'; // fallback

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length > 11 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp';
  }
  // GIF: 47 49 46
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }

  return 'image/png'; // safe default
}

/**
 * Extracts a high-quality product/subject silhouette mask using local ONNX neural networks.
 * Pure Node.js/TypeScript execution (zero Python dependencies).
 * 
 * @param imageBuffer - The raw background base image buffer
 * @returns High-contrast transparent PNG buffer containing only the isolated product
 */
export async function extractSubjectMask(imageBuffer: Buffer): Promise<Buffer> {
  logger.info('Executing local ONNX neural network to extract subject silhouette mask...');
  
  try {
    const startTime = Date.now();

    // Detect the image MIME type from magic bytes so we can wrap the buffer
    // in a properly typed Blob. The @imgly/background-removal-node library
    // accepts ImageData | ArrayBuffer | Uint8Array | Blob | URL | string,
    // but raw Node.js Buffers fail internal format detection with
    // "Unsupported format: " even though Buffer extends Uint8Array.
    const mimeType = detectMimeType(imageBuffer);
    logger.info(`Detected input image MIME type: ${mimeType}`);

    const inputBlob = new Blob([imageBuffer], { type: mimeType });

    // removeBackground returns a Blob containing the transparent foreground cutout
    const resultBlob = await removeBackground(inputBlob as any, {
      output: {
        format: 'image/png',
        quality: 0.95
      }
    });
    
    const maskBuffer = Buffer.from(await resultBlob.arrayBuffer());
    const duration = Date.now() - startTime;
    logger.info(`✓ Subject mask isolated successfully in ${duration}ms. Buffer size: ${maskBuffer.length} bytes`);
    
    return maskBuffer;
  } catch (error: any) {
    logger.error(`✗ Local ONNX subject masking failed: ${error.message}`);
    throw new Error(`Subject extraction failed: ${error.message}`);
  }
}
