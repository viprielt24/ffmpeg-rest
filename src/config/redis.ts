import IORedis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export const createRedisConnection = () => {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 1000, 20000);
      return delay;
    }
  });
};

export const connection = createRedisConnection();

export async function checkRedisHealth(): Promise<void> {
  logger.info('Checking Redis connection');

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Redis health check timed out after 10 seconds')), 10000);
  });

  const healthCheckPromise = (async () => {
    await connection.ping();
    const info = await connection.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    logger.info({ version }, 'Redis health check passed');
  })();

  try {
    await Promise.race([healthCheckPromise, timeoutPromise]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Redis health check failed');
    throw new Error(`Redis health check failed: ${errorMessage}`);
  }
}
