import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '~/app';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { Worker } from 'bullmq';
import { connection } from '~/config/redis';
import { QUEUE_NAME, JobType } from '~/queue';
import type { JobResult } from '~/queue';
import { processVideoToMp4, processVideoExtractAudio, processVideoExtractFrames } from '~/queue/video/processor';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'video-controller');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'video-controller');

describe('Video Controller', () => {
  const app = createApp();
  let worker: Worker;

  beforeAll(async () => {
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    worker = new Worker<unknown, JobResult>(
      QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case JobType.VIDEO_TO_MP4:
            return processVideoToMp4(job as never);
          case JobType.VIDEO_EXTRACT_AUDIO:
            return processVideoExtractAudio(job as never);
          case JobType.VIDEO_EXTRACT_FRAMES:
            return processVideoExtractFrames(job as never);
          default:
            throw new Error(`Unknown job type: ${job.name}`);
        }
      },
      { connection }
    );
  });

  afterAll(async () => {
    await worker?.close();

    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    if (existsSync(FIXTURES_DIR)) {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    }
  });

  describe('POST /video/mp4', () => {
    it('should convert AVI to MP4', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/mp4', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp4');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 for invalid file', async () => {
      const formData = new FormData();
      const file = new File(['invalid video data'], 'invalid.avi', { type: 'video/x-msvideo' });
      formData.append('file', file);

      const res = await app.request('/video/mp4', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('should return 400 for missing file', async () => {
      const formData = new FormData();

      const res = await app.request('/video/mp4', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /video/audio', () => {
    it('should extract audio as mono WAV by default', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test-audio.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/audio', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/wav');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should extract audio preserving channels when mono=no', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test-stereo.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/audio?mono=no', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/wav');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 for invalid file', async () => {
      const formData = new FormData();
      const file = new File(['invalid video data'], 'invalid.avi', { type: 'video/x-msvideo' });
      formData.append('file', file);

      const res = await app.request('/video/audio', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });

  describe('POST /video/frames', () => {
    it('should extract frames as ZIP archive', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test-frames.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/frames?fps=1&compress=zip', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should extract frames as GZIP archive', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test-frames-gzip.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/frames?fps=1&compress=gzip', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/gzip');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 when compress parameter is missing', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test-no-compress.avi');
      createTestAviFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.avi', {
        type: 'video/x-msvideo'
      });
      formData.append('file', file);

      const res = await app.request('/video/frames?fps=1', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toContain('compress parameter is required');
    });

    it('should return 400 for invalid file', async () => {
      const formData = new FormData();
      const file = new File(['invalid video data'], 'invalid.avi', { type: 'video/x-msvideo' });
      formData.append('file', file);

      const res = await app.request('/video/frames?fps=1&compress=zip', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });
});

function createTestAviFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=1000:duration=2:sample_rate=44100 -ac 2 -pix_fmt yuv420p -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
