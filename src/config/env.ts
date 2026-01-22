import { z } from 'zod';

if (process.env['NODE_ENV'] !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  TEMP_DIR: z.string().default('/tmp/ffmpeg-rest'),
  MAX_FILE_SIZE: z.coerce.number().default(100 * 1024 * 1024),

  WORKER_CONCURRENCY: z.coerce.number().default(5),

  STORAGE_MODE: z.enum(['stateless', 's3']).default('stateless'),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  S3_PATH_PREFIX: z.string().default('ffmpeg-rest'),
  S3_DEDUP_ENABLED: z.coerce.boolean().default(true),
  S3_DEDUP_TTL_DAYS: z.coerce.number().default(90),

  AUTH_TOKEN: z.string().optional(),

  // Webhook secret for GPU worker callbacks
  WEBHOOK_SECRET: z.string().optional(),

  // RunPod configuration
  RUNPOD_API_KEY: z.string().optional(),
  RUNPOD_LTX2_ENDPOINT_ID: z.string().optional(),
  RUNPOD_ZIMAGE_ENDPOINT_ID: z.string().optional(),
  RUNPOD_LONGCAT_ENDPOINT_ID: z.string().optional(),
  RUNPOD_INFINITETALK_ENDPOINT_ID: z.string().optional(),
  RUNPOD_WAN22_ENDPOINT_ID: z.string().optional()
});

export const env = schema.parse(process.env);
