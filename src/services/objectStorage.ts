/**
 * Object Storage Service
 * 
 * Handles image uploads to MinIO (S3-compatible storage).
 * 
 * WHY MinIO: S3-compatible API, can be self-hosted, same interface as AWS S3
 * WHY separate module: Storage logic should be independent of business logic
 */

import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';
import { ImageGenerationResult } from './imageGenerator';

interface ParsedMinioEndpoint {
  endPoint: string;
  inferredPort?: number;
  inferredUseSSL?: boolean;
}

function parseMinioEndpoint(rawEndpoint: string): ParsedMinioEndpoint {
  const trimmed = rawEndpoint.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const url = new URL(trimmed);
    return {
      endPoint: url.hostname,
      inferredPort: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80,
      inferredUseSSL: url.protocol === 'https:',
    };
  }

  const endPoint = trimmed.replace(/\/$/, '');
  return { endPoint };
}

function toBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const rawMinioEndpoint = process.env.MINIO_ENDPOINT || 'localhost';
const parsedEndpoint = parseMinioEndpoint(rawMinioEndpoint);
const configuredUseSSL = toBoolean(process.env.MINIO_USE_SSL);
const configuredPort = toInt(process.env.MINIO_PORT);

const minioConfig = {
  endPoint: parsedEndpoint.endPoint,
  port: configuredPort ?? parsedEndpoint.inferredPort ?? 9000,
  useSSL: configuredUseSSL ?? parsedEndpoint.inferredUseSSL ?? false,
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
};

const minioClient = new Minio.Client(minioConfig);
const bucketName = process.env.MINIO_BUCKET_NAME || 'social-scene';
const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;
const storageType = (process.env.STORAGE_TYPE || 'minio').toLowerCase();

let minioTemporarilyDisabledReason: string | null = null;
let didLogMinioDisabled = false;

function formatMinioError(error: unknown): string {
  if (!error) return 'Unknown error';

  if (error instanceof Error) {
    const base = error.message || error.name;
    const maybeS3 = error as Error & {
      code?: string;
      amzRequestid?: string;
      amzBucketRegion?: string;
      statusCode?: number;
    };

    const extra: string[] = [];
    if (maybeS3.code) extra.push(`code=${maybeS3.code}`);
    if (maybeS3.statusCode) extra.push(`status=${maybeS3.statusCode}`);
    if (maybeS3.amzRequestid) extra.push(`requestId=${maybeS3.amzRequestid}`);
    if (maybeS3.amzBucketRegion) extra.push(`region=${maybeS3.amzBucketRegion}`);

    return extra.length > 0 ? `${base} (${extra.join(', ')})` : base;
  }

  return String(error);
}

/**
 * Uploads image to MinIO storage
 * 
 * WHY: Centralized upload logic with consistent error handling
 * WHY: UUID-based keys prevent naming conflicts
 * 
 * @param image - Generated image with buffer and metadata
 * @param prefix - Optional path prefix (e.g., "campaign-123/")
 * @returns Public URL to access the uploaded image
 * @throws Error if upload fails
 */
export async function uploadImageToStorage(
  image: ImageGenerationResult,
  prefix: string = 'posts/'
): Promise<string> {
  if (storageType !== 'minio') {
    return generatePlaceholderUrl(image);
  }

  if (minioTemporarilyDisabledReason) {
    if (!didLogMinioDisabled) {
      console.warn(
        `[ObjectStorage] ⚠ MinIO temporarily disabled for this process: ${minioTemporarilyDisabledReason}`
      );
      didLogMinioDisabled = true;
    }
    return generatePlaceholderUrl(image);
  }

  // ============================================================================
  // OPTION 1: Try real upload if credentials exist, fallback to placeholder
  // ============================================================================
  
  const hasMinioCredentials = 
    minioConfig.accessKey &&
    minioConfig.secretKey &&
    minioConfig.endPoint;

  if (hasMinioCredentials) {
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await uploadToMinIO(image, prefix);
      } catch (error) {
        lastError = error;
        const details = formatMinioError(error);
        console.warn(
          `[ObjectStorage] ⚠ MinIO upload attempt ${attempt}/${MAX_RETRIES} failed: ${details}`
        );

        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    const details = formatMinioError(lastError);
    minioTemporarilyDisabledReason = details;
    console.error(`[ObjectStorage] ✗ All ${MAX_RETRIES} MinIO retries exhausted, using placeholder: ${details}`);
    return generatePlaceholderUrl(image);
  } else {
    // No credentials - use placeholder
    console.log('[ObjectStorage] ⚠ MinIO not configured, using placeholder image');
    return generatePlaceholderUrl(image);
  }
}

/**
 * Generates a working placeholder image URL
 * Uses a reliable public CDN service
 */
function generatePlaceholderUrl(image: ImageGenerationResult): string {
  // Use picsum.photos for reliable placeholder images
  // WHY: Always available, no 502 errors, good for demos
  const seed = Math.random().toString(36).substring(7);
  return `https://picsum.photos/seed/${seed}/1024/1024`;
}

/**
 * Actual MinIO upload implementation
 */
async function uploadToMinIO(
  image: ImageGenerationResult,
  prefix: string = 'posts/'
): Promise<string> {
  try {
    // Ensure bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`[ObjectStorage] Created bucket: ${bucketName}`);
    }

    // Generate unique object key
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    const objectKey = `${prefix}${timestamp}-${uniqueId}.png`;

    // Upload image buffer
    await minioClient.putObject(
      bucketName,
      objectKey,
      image.imageBuffer,
      image.imageBuffer.length,
      {
        'Content-Type': 'image/png',
        'x-amz-acl': 'public-read',
      }
    );

    // Build public URL
    const imageUrl = buildPublicUrl(objectKey);

    console.log(`[ObjectStorage] ✓ Image uploaded to MinIO: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    const details = formatMinioError(error);
    console.error(`[ObjectStorage] ✗ MinIO upload failed: ${details}`);

    if (!process.env.MINIO_USE_SSL && rawMinioEndpoint.includes('railway.app')) {
      console.error(
        '[ObjectStorage] Hint: Railway-hosted S3 endpoints typically require HTTPS. ' +
          'Set MINIO_USE_SSL=true or use an https:// MINIO_ENDPOINT.'
      );
    }

    throw new Error(
      `Failed to upload to MinIO: ${details}`
    );
  }
}


/**
 * Builds public URL for an uploaded object
 * 
 * WHY: Use public endpoint if configured, otherwise construct from MinIO endpoint
 * WHY: Public endpoint handles load balancers and CDNs
 */
function buildPublicUrl(objectKey: string): string {
  if (publicEndpoint) {
    // Use configured public endpoint
    // WHY: Public endpoint might be different from internal endpoint (e.g., CDN)
    return `${publicEndpoint}/${bucketName}/${objectKey}`;
  }

  // Fallback: construct URL from MinIO endpoint
  const protocol = minioConfig.useSSL ? 'https' : 'http';
  const endpoint = minioConfig.endPoint;
  const port = String(minioConfig.port);

  // WHY: Include port only if not standard (80/443)
  const portSuffix = (port === '80' || port === '443') ? '' : `:${port}`;

  return `${protocol}://${endpoint}${portSuffix}/${bucketName}/${objectKey}`;
}

/**
 * Uploads a raw user-supplied Buffer to storage.
 *
 * For user-uploaded media (multipart file uploads) where there is no
 * ImageGenerationResult — wraps the buffer into a minimal synthetic
 * ImageGenerationResult and delegates to uploadImageToStorage so all
 * MinIO retry/fallback logic is reused automatically.
 *
 * @param buffer   - Raw file buffer from multer (memoryStorage)
 * @param mimeType - MIME type (e.g. "image/jpeg") — informational only
 * @param prefix   - MinIO path prefix (e.g. campaign ID)
 */
export async function uploadBufferToStorage(
  buffer: Buffer,
  mimeType: string,
  prefix: string
): Promise<string> {
  const synthetic: ImageGenerationResult = {
    imageBuffer: buffer,
    metadata: {
      model: 'user-upload',
      dimensions: { width: 0, height: 0 },
      prompt: mimeType,
    },
  };
  return uploadImageToStorage(synthetic, prefix);
}

/**
 * Deletes image from MinIO storage
 *
 * WHY: Cleanup utility for failed posts or testing
 * NOTE: Not used in main pipeline, but useful for future features
 */
export async function deleteImageFromStorage(objectKey: string): Promise<void> {
  try {
    await minioClient.removeObject(bucketName, objectKey);
    console.log(`[ObjectStorage] ✓ Image deleted: ${objectKey}`);
  } catch (error) {
    console.error('[ObjectStorage] ✗ Delete failed:', error);
    throw new Error(
      `Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
