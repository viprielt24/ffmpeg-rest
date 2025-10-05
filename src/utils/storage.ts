import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readFile } from 'fs/promises';
import { env } from '~/config/env';
import { logger } from '~/config/logger';
import { randomUUID } from 'crypto';

export interface UploadResult {
  url: string;
  key: string;
}

export async function checkS3Health(): Promise<void> {
  if (env.STORAGE_MODE !== 's3') {
    return;
  }

  if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_BUCKET ||
      !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 mode enabled but configuration is incomplete');
  }

  const s3Client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    }
  });

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    logger.info({ bucket: env.S3_BUCKET }, 'S3 health check passed');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'S3 health check failed');
    throw new Error(`S3 health check failed: ${errorMessage}`);
  }
}

export async function uploadToS3(
  filePath: string,
  contentType: string,
  originalFilename: string
): Promise<UploadResult> {
  if (env.STORAGE_MODE !== 's3') {
    throw new Error('S3 mode not enabled');
  }

  if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 configuration missing');
  }

  const s3Client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY
    }
  });

  const timestamp = new Date().toISOString().split('T')[0];
  const uuid = randomUUID();
  const key = `${env.S3_PATH_PREFIX}/${timestamp}-${uuid}/${originalFilename}`;

  const fileBuffer = await readFile(filePath);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
      ACL: 'public-read'
    })
  );

  const url = env.S3_PUBLIC_URL ? `${env.S3_PUBLIC_URL}/${key}` : `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;

  return { url, key };
}
