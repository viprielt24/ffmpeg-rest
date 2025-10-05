import IORedis from 'ioredis';
import { env } from './env';

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
  console.log('🔍 Checking Redis connection...');

  try {
    await connection.ping();
    const info = await connection.info('server');
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    console.log(`✅ Redis health check passed (version: ${version})`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Redis health check failed: ${errorMessage}`);
  }
}
