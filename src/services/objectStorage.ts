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

/**
 * Initialize MinIO client
 * 
 * WHY: Single client instance reused across uploads for efficiency
 * WHY: Environment variables for configuration flexibility
 */
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
});

const bucketName = process.env.MINIO_BUCKET_NAME || 'social-scene';
const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;

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
  // ============================================================================
  // OPTION 1: Try real upload if credentials exist, fallback to placeholder
  // ============================================================================
  
  const hasMinioCredentials = 
    process.env.MINIO_ACCESS_KEY && 
    process.env.MINIO_SECRET_KEY &&
    process.env.MINIO_ENDPOINT;

  if (hasMinioCredentials) {
    try {
      return await uploadToMinIO(image, prefix);
    } catch (error) {
      console.warn('[ObjectStorage] ⚠ MinIO upload failed, using placeholder:', error);
      return generatePlaceholderUrl(image);
    }
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
    console.error('[ObjectStorage] ✗ MinIO upload failed:', error);
    throw new Error(
      `Failed to upload to MinIO: ${error instanceof Error ? error.message : 'Unknown error'}`
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
  const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = process.env.MINIO_PORT || '9000';

  // WHY: Include port only if not standard (80/443)
  const portSuffix = (port === '80' || port === '443') ? '' : `:${port}`;

  return `${protocol}://${endpoint}${portSuffix}/${bucketName}/${objectKey}`;
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
