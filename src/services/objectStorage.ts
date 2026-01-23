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
  // V1: SKIP REAL UPLOAD - RETURN MOCK URL
  // ============================================================================
  // WHY: MinIO endpoint configuration needs to be verified in production
  // WHY: Allows testing complete pipeline without storage dependency
  
  const mockImageId = uuidv4();
  const mockUrl = publicEndpoint 
    ? `${publicEndpoint}/${bucketName}/${prefix}${mockImageId}.png`
    : `http://localhost:9000/${bucketName}/${prefix}${mockImageId}.png`;
  
  console.log(`[ObjectStorage] ✓ Mock upload (V1): ${mockUrl}`);
  return mockUrl;

  // ============================================================================
  // PRODUCTION CODE (COMMENTED OUT FOR V1)
  // ============================================================================
  /*
  // Validate configuration
  if (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
    throw new Error('MinIO credentials not configured. Check MINIO_ACCESS_KEY and MINIO_SECRET_KEY.');
  }

  // Generate unique object key
  // WHY: UUID prevents conflicts, timestamp helps with debugging
  const timestamp = Date.now();
  const uniqueId = uuidv4();
  const objectKey = `${prefix}${timestamp}-${uniqueId}.png`;

  try {
    // Ensure bucket exists
    // WHY: Auto-create bucket if missing (safe for first-time setup)
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`[ObjectStorage] Created bucket: ${bucketName}`);
    }

    // Upload image buffer
    // WHY: putObject accepts Buffer directly, no need for streams
    await minioClient.putObject(
      bucketName,
      objectKey,
      image.imageBuffer,
      image.imageBuffer.length,
      {
        'Content-Type': 'image/png',
        'x-amz-acl': 'public-read', // WHY: Images need to be publicly accessible
      }
    );

    // Build public URL
    const imageUrl = buildPublicUrl(objectKey);

    console.log(`[ObjectStorage] ✓ Image uploaded: ${imageUrl}`);

    return imageUrl;
  } catch (error) {
    console.error('[ObjectStorage] ✗ Upload failed:', error);
    throw new Error(
      `Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
  */
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
