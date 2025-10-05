import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIntegrationTests, teardownIntegrationTests } from './test-utils/integration-setup';

describe('FFmpeg REST API Integration', () => {
  let appContainer: Awaited<ReturnType<typeof setupIntegrationTests>>['appContainer'];
  let apiUrl: string;

  beforeAll(async () => {
    const setup = await setupIntegrationTests();
    appContainer = setup.appContainer;
    apiUrl = setup.apiUrl;
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationTests();
  });

  it('should have FFmpeg installed and accessible', async () => {
    const { output } = await appContainer.exec(['ffmpeg', '-version']);
    expect(output).toContain('ffmpeg version');
  }, 30000);

  it('should return health check on root endpoint', async () => {
    const response = await fetch(`${apiUrl}/`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
  }, 10000);
});
