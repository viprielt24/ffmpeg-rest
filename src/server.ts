import { serve } from '@hono/node-server';
import { createApp } from '~/app';
import { env } from '~/config/env';
import { checkRedisHealth } from '~/config/redis';

await checkRedisHealth();

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
  }
);
