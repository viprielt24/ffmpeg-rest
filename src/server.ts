import { serve } from '@hono/node-server';
import { createApp } from '~/app';
import { env } from '~/config/env';
import { checkRedisHealth } from '~/config/redis';
import { logger } from '~/config/logger';

await checkRedisHealth();

const app = createApp();

const port = 3000;

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    logger.info({
      port: info.port,
      storageMode: env.STORAGE_MODE,
      openApiSpec: `http://localhost:${info.port}/doc`,
      apiReference: `http://localhost:${info.port}/reference`,
      llmDocs: `http://localhost:${info.port}/llms.txt`
    }, 'FFmpeg REST API started');
  }
);
