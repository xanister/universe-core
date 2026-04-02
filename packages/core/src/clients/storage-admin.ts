/**
 * Storage Admin - S3 bucket-level administration
 *
 * Bucket configuration operations (CORS, lifecycle, etc.).
 * Distinct from storage-service.ts which handles object CRUD (upload/download/delete).
 * Called from server startup, not from application code.
 */

import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';
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
      : undefined,
});

/**
 * Configure the S3 bucket's CORS policy to allow GET requests from any origin.
 * Enables character sprite textures to load from non-localhost origins (LAN IPs, tunnels).
 * Logs a warning and returns without throwing if the IAM user lacks s3:PutBucketCors permission.
 */
export async function configureBucketCors(): Promise<void> {
  if (!config.awsS3Bucket) {
    return;
  }

  try {
    const command = new PutBucketCorsCommand({
      Bucket: config.awsS3Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET'],
            AllowedHeaders: ['Authorization'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    });
    await s3Client.send(command);
    logger.info('Storage', 'S3 bucket CORS policy configured (GET from any origin)');
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AccessDenied') {
      logger.warn(
        'Storage',
        'Cannot set S3 CORS policy: IAM user lacks s3:PutBucketCors permission. ' +
          'Character sprites will not load from non-localhost origins. ' +
          'Add s3:PutBucketCors to the IAM policy or set CORS manually in the AWS console.',
      );
      return;
    }
    throw error;
  }
}
