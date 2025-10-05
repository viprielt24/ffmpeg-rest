import { serve } from '@hono/node-server';
import { createApp } from '~/app';
import { env } from '~/config/env';

const app = createApp();

const port = 3000;

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`🚀 FFmpeg REST API running on http://localhost:${info.port}`);
    console.log(`📚 OpenAPI Spec: http://localhost:${info.port}/doc`);
    console.log(`📖 API Reference: http://localhost:${info.port}/reference`);
    console.log(`🤖 LLM Documentation: http://localhost:${info.port}/llms.txt`);
    console.log(`💾 Storage Mode: ${env.STORAGE_MODE.toUpperCase()}`);
    if (env.STORAGE_MODE === 's3') {
      console.log(`   S3 Bucket: ${env.S3_BUCKET}`);
      console.log(`   S3 Region: ${env.S3_REGION}`);
      console.log(`   S3 Prefix: ${env.S3_PATH_PREFIX}`);
    }
  }
);
