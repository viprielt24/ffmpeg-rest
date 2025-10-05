import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupIntegrationTests, teardownIntegrationTests, getApiUrl } from '~/test-utils/integration-setup';
import { readFile } from 'fs/promises';
import path from 'path';

describe('Image Conversion Integration', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationTests();
  });

  it('should convert PNG to JPG', async () => {
    const apiUrl = getApiUrl();
    const testImagePath = path.join(__dirname, '../../../test-image.png');
    const imageBuffer = await readFile(testImagePath);

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });
    formData.append('file', blob, 'test-image.png');

    const response = await fetch(`${apiUrl}/image/jpg`, {
      method: 'POST',
      body: formData
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');

    const resultBuffer = await response.arrayBuffer();
    expect(resultBuffer.byteLength).toBeGreaterThan(0);
  }, 30000);

  it('should reject invalid file', async () => {
    const apiUrl = getApiUrl();
    const formData = new FormData();
    const blob = new Blob(['not an image'], { type: 'text/plain' });
    formData.append('file', blob, 'test.txt');

    const response = await fetch(`${apiUrl}/image/jpg`, {
      method: 'POST',
      body: formData
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  }, 30000);
});
