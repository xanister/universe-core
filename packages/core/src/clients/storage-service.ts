/**
 * Storage Service - S3-based media storage
 *
 * Provides upload, download, and URL generation for media files stored in AWS S3.
 * Used by generation services for images and audio.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { config } from '../infra/config.js';
import { logger } from '../infra/logger.js';

const s3Client = new S3Client({
  region: config.awsRegion,
  credentials:
    config.awsAccessKeyId && config.awsSecretAccessKey
      ? {
          accessKeyId: config.awsAccessKeyId,
          secretAccessKey: config.awsSecretAccessKey,
        }
      : undefined, // Use default credential chain if not provided
});

/**
 * Get the public URL for a stored file.
 * Uses CloudFront CDN URL if configured, otherwise direct S3 URL.
 */
export function getPublicUrl(key: string): string {
  if (config.awsCdnUrl) {
    return `${config.awsCdnUrl}/${key}`;
  }
  return `https://${config.awsS3Bucket}.s3.${config.awsRegion}.amazonaws.com/${key}`;
}

/**
 * Upload a file to S3 and return its public URL.
 * Errors propagate to caller (no swallowing).
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (!config.awsS3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: config.awsS3Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);

  const url = getPublicUrl(key);
  logger.info('Storage', `Uploaded file: ${key}`);
  return url;
}

/**
 * Check if a file exists in S3.
 */
export async function exists(key: string): Promise<boolean> {
  if (!config.awsS3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: config.awsS3Bucket,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error: unknown) {
    // NotFound is expected when file doesn't exist
    if (error instanceof Error && error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Download a file from S3.
 * Returns null if file doesn't exist, throws on other errors.
 */
export async function downloadFile(key: string): Promise<Buffer | null> {
  if (!config.awsS3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: config.awsS3Bucket,
      Key: key,
    });
    const response = await s3Client.send(command);

    if (!response.Body) {
      return null;
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error: unknown) {
    // NotFound is expected when file doesn't exist
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a file from S3.
 * Does not throw if file doesn't exist.
 */
export async function deleteFile(key: string): Promise<void> {
  if (!config.awsS3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

  const command = new DeleteObjectCommand({
    Bucket: config.awsS3Bucket,
    Key: key,
  });

  await s3Client.send(command);
  logger.info('Storage', `Deleted file: ${key}`);
}

/**
 * List all objects in the S3 bucket, optionally filtered by prefix.
 * Handles pagination automatically.
 */
export async function listAllObjects(prefix?: string): Promise<string[]> {
  if (!config.awsS3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured');
  }

  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: config.awsS3Bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const response = await s3Client.send(command);
    keys.push(...(response.Contents?.map((obj) => obj.Key!).filter(Boolean) ?? []));
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

/**
 * Storage service singleton for convenient imports.
 */
export const storageService = {
  uploadFile,
  getPublicUrl,
  exists,
  downloadFile,
  deleteFile,
  listAllObjects,
};
