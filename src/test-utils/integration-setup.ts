import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import path from 'path';

let redisContainer: StartedRedisContainer;
let appContainer: StartedTestContainer;
let apiUrl: string;

export async function setupIntegrationTests() {
  if (appContainer) {
    return { apiUrl, appContainer, redisContainer };
  }

  console.log('Starting Redis container...');
  redisContainer = await new RedisContainer('redis:7.4-alpine').start();

  console.log('Building application image...');
  const imageName = 'ffmpeg-rest-test';

  await GenericContainer.fromDockerfile(path.join(__dirname, '../..'))
    .withPlatform('linux/amd64')
    .build(imageName);

  console.log('Starting application container...');
  appContainer = await new GenericContainer(imageName)
    .withEnvironment({
      REDIS_URL: redisContainer.getConnectionUrl(),
      STORAGE_MODE: 'stateless',
      NODE_ENV: 'test'
    })
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  apiUrl = `http://${appContainer.getHost()}:${appContainer.getMappedPort(3000)}`;
  console.log(`API available at: ${apiUrl}`);

  return { apiUrl, appContainer, redisContainer };
}

export async function teardownIntegrationTests() {
  await appContainer?.stop();
  await redisContainer?.stop();
}

export function getApiUrl() {
  if (!apiUrl) {
    throw new Error('Integration tests not set up. Call setupIntegrationTests() first.');
  }
  return apiUrl;
}
