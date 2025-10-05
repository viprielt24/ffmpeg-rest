import { GenericContainer, Wait, type StartedTestContainer, Network, type StartedNetwork } from 'testcontainers';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { LocalstackContainer, type StartedLocalStackContainer } from '@testcontainers/localstack';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import path from 'path';

interface IntegrationSetupResult {
  apiUrl: string;
  appContainer: StartedTestContainer;
  redisContainer: StartedRedisContainer;
  localstackContainer?: StartedLocalStackContainer;
}

let redisContainer: StartedRedisContainer | null = null;
let localstackContainer: StartedLocalStackContainer | null = null;
let appContainer: StartedTestContainer | null = null;
let network: StartedNetwork | null = null;
let apiUrl: string | null = null;
let currentMode: 'stateless' | 's3' | null = null;
let setupInFlight: Promise<void> | null = null;
let s3BucketInitialized = false;

export async function setupIntegrationTests(options?: { s3Mode?: boolean }): Promise<IntegrationSetupResult> {
  const requestedMode = options?.s3Mode ? 's3' : 'stateless';

  if (setupInFlight) {
    await setupInFlight;
    if (appContainer && currentMode === requestedMode) {
      return buildResult();
    }
  }

  if (appContainer && currentMode === requestedMode) {
    return buildResult();
  }

  if (appContainer && currentMode !== requestedMode) {
    await teardownIntegrationTests();
  }

  currentMode = requestedMode;

  const environment: Record<string, string> = {
    REDIS_URL: 'redis://redis:6379',
    STORAGE_MODE: 'stateless',
    NODE_ENV: 'test'
  };

  const performSetup = async () => {
    console.log('Creating network...');
    network = await new Network().start();

    console.log('Starting Redis container...');
    redisContainer = await new RedisContainer('redis:7.4-alpine')
      .withNetwork(network)
      .withNetworkAliases('redis')
      .start();

    if (options?.s3Mode) {
      console.log('Starting LocalStack container...');
      localstackContainer = await new LocalstackContainer('localstack/localstack:latest')
        .withNetwork(network)
        .withNetworkAliases('localstack')
        .start();

      const localstackHostEndpoint = localstackContainer.getConnectionUri();
      const localstackInternalEndpoint = 'http://localstack:4566';

      environment['STORAGE_MODE'] = 's3';
      environment['S3_ENDPOINT'] = localstackInternalEndpoint;
      environment['S3_REGION'] = 'us-east-1';
      environment['S3_BUCKET'] = 'test-ffmpeg-bucket';
      environment['S3_ACCESS_KEY_ID'] = 'test';
      environment['S3_SECRET_ACCESS_KEY'] = 'test';
      environment['S3_PATH_PREFIX'] = 'test-media';

      if (!s3BucketInitialized) {
        console.log('Ensuring S3 bucket exists...');
        const s3Client = new S3Client({
          endpoint: localstackHostEndpoint,
          forcePathStyle: true,
          region: environment['S3_REGION'],
          credentials: {
            accessKeyId: environment['S3_ACCESS_KEY_ID'],
            secretAccessKey: environment['S3_SECRET_ACCESS_KEY']
          }
        });

        try {
          await s3Client.send(new CreateBucketCommand({ Bucket: environment['S3_BUCKET'] }));
        } catch (error) {
          if (!isBucketAlreadyExistsError(error)) {
            throw error;
          }
        }

        s3BucketInitialized = true;
      }
    }

    console.log('Building application image...');
    const imageName = 'ffmpeg-rest-test';

    await GenericContainer.fromDockerfile(path.join(__dirname, '../..'))
      .withPlatform('linux/amd64')
      .build(imageName, { deleteOnExit: false });

    console.log('Starting application container...');
    appContainer = await new GenericContainer(imageName)
      .withNetwork(network)
      .withEnvironment(environment)
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    apiUrl = `http://${appContainer.getHost()}:${appContainer.getMappedPort(3000)}`;
    console.log(`API available at: ${apiUrl}`);
  };

  setupInFlight = performSetup();

  try {
    await setupInFlight;
  } catch (error) {
    currentMode = null;
    throw error;
  } finally {
    setupInFlight = null;
  }

  return buildResult();
}

export async function teardownIntegrationTests() {
  if (setupInFlight) {
    await setupInFlight;
  }

  if (appContainer) {
    await appContainer.stop();
  }
  if (redisContainer) {
    await redisContainer.stop();
  }
  if (localstackContainer) {
    await localstackContainer.stop();
  }
  if (network) {
    await network.stop();
  }

  appContainer = null;
  redisContainer = null;
  localstackContainer = null;
  network = null;
  apiUrl = null;
  currentMode = null;
  s3BucketInitialized = false;
}

export function getApiUrl() {
  if (!apiUrl) {
    throw new Error('Integration tests not set up. Call setupIntegrationTests() first.');
  }
  return apiUrl;
}

export function getLocalStackContainer() {
  if (!localstackContainer) {
    throw new Error('LocalStack not available. Call setupIntegrationTests({ s3Mode: true }) first.');
  }
  return localstackContainer;
}

function buildResult(): IntegrationSetupResult {
  if (!apiUrl || !appContainer || !redisContainer) {
    throw new Error('Integration test containers not initialized.');
  }

  return {
    apiUrl,
    appContainer,
    redisContainer,
    localstackContainer: localstackContainer ?? undefined
  };
}

function isBucketAlreadyExistsError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const knownCodes = new Set(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists']);
  const name = (error as { name?: string }).name;
  const code = (error as { Code?: string }).Code;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

  return Boolean((name && knownCodes.has(name)) || (code && knownCodes.has(code)) || status === 409);
}
