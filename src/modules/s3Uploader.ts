/**
 * S3 Uploader Module
 * 
 * Responsibility: Upload generated images to S3-compatible storage (AWS S3 or MinIO)
 * NO AI - Pure object storage integration
 * 
 * WHY: Centralized upload logic with error handling
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as Minio from 'minio';
import { S3UploadRequest, S3UploadResponse } from '../types';

/**
 * Storage type configuration
 * WHY: Support both AWS S3 and MinIO (S3-compatible)
 */
const storageType = process.env.STORAGE_TYPE || 'minio'; // 'minio' or 'aws'

/**
 * AWS S3 client (if using AWS)
 */
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * MinIO client (if using MinIO)
 * WHY: MinIO is S3-compatible and can be self-hosted
 */
const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
});

const bucketName = storageType === 'minio' 
  ? (process.env.MINIO_BUCKET_NAME || 'social-scene')
  : (process.env.S3_BUCKET_NAME || 'social-scene-images');

/**
 * Uploads file to S3-compatible storage (AWS S3 or MinIO)
 * 
 * Process:
 * 1. Validate storage configuration
 * 2. Upload with proper content type
 * 3. Return public URL
 * 
 * @param request - Upload request with buffer and metadata
 * @returns Public URL and metadata
 * @throws Error if upload fails
 */
export async function uploadToS3(
  request: S3UploadRequest
): Promise<S3UploadResponse> {
  console.log(`[S3Uploader] Uploading to ${storageType}://${bucketName}/${request.key}...`);

  if (!bucketName) {
    throw new Error('Bucket name not configured');
  }

  if (storageType === 'minio') {
    return uploadToMinIO(request);
  } else {
    return uploadToAWS(request);
  }
}

/**
 * Upload to MinIO
 * WHY: MinIO is S3-compatible and can be self-hosted (used in parent project)
 */
async function uploadToMinIO(request: S3UploadRequest): Promise<S3UploadResponse> {
  if (!process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
    throw new Error('MinIO credentials not configured');
  }

  try {
    // Ensure bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
      console.log(`[S3Uploader] Created bucket: ${bucketName}`);
    }

    // Upload file
    await minioClient.putObject(
      bucketName,
      request.key,
      request.buffer,
      request.buffer.length,
      {
        'Content-Type': request.contentType,
        ...request.metadata,
      }
    );

    // Build public URL using MINIO_PUBLIC_ENDPOINT
    const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT || 
      `http${process.env.MINIO_USE_SSL === 'true' ? 's' : ''}://${process.env.MINIO_ENDPOINT}`;
    const url = `${publicEndpoint}/${bucketName}/${request.key}`;

    console.log(`[S3Uploader] ✓ Upload successful (MinIO): ${url}`);

    return {
      url,
      key: request.key,
      bucket: bucketName,
    };
  } catch (error) {
    console.error('[S3Uploader] ✗ MinIO upload failed:', error);
    throw new Error(
      `MinIO upload failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Upload to AWS S3
 * WHY: Alternative to MinIO for production deployments
 */
async function uploadToAWS(request: S3UploadRequest): Promise<S3UploadResponse> {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not configured');
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: request.key,
      Body: request.buffer,
      ContentType: request.contentType,
      Metadata: request.metadata,
      ACL: 'public-read',
    });

    await s3Client.send(command);

    const region = process.env.AWS_REGION || 'us-east-1';
    const url = `https://${bucketName}.s3.${region}.amazonaws.com/${request.key}`;

    console.log(`[S3Uploader] ✓ Upload successful (AWS): ${url}`);

    return {
      url,
      key: request.key,
      bucket: bucketName,
    };
  } catch (error) {
    console.error('[S3Uploader] ✗ AWS upload failed:', error);
    throw new Error(
      `AWS upload failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Deletes object from S3
 * 
 * TODO: Implement if needed for cleanup
 * WHY: May need to delete failed/test uploads
 */
export async function deleteFromS3(key: string): Promise<void> {
  // TODO: Implement delete functionality
  throw new Error('deleteFromS3 not implemented yet');
}
