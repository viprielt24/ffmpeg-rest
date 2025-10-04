import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '~/app';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { Worker } from 'bullmq';
import { connection } from '~/config/redis';
import { QUEUE_NAME, JobType } from '~/queue';
import type { JobResult } from '~/queue';
import { processAudioToMp3, processAudioToWav } from '~/queue/audio/processor';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'audio-controller');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'audio-controller');

describe('Audio Controller', () => {
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
          case JobType.AUDIO_TO_MP3:
            return processAudioToMp3(job as never);
          case JobType.AUDIO_TO_WAV:
            return processAudioToWav(job as never);
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

  describe('POST /audio/mp3', () => {
    it('should convert WAV to MP3', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test.wav');
      createTestWavFile(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.wav', {
        type: 'audio/wav'
      });
      formData.append('file', file);

      const res = await app.request('/audio/mp3', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/mpeg');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);
    });

    it('should return 400 for invalid file', async () => {
      const formData = new FormData();
      const file = new File(['invalid audio data'], 'invalid.wav', { type: 'audio/wav' });
      formData.append('file', file);

      const res = await app.request('/audio/mp3', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });

    it('should return 400 for missing file', async () => {
      const formData = new FormData();

      const res = await app.request('/audio/mp3', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /audio/wav', () => {
    it('should convert MP3 to WAV', async () => {
      const inputPath = path.join(FIXTURES_DIR, 'test.mp3');
      createTestMp3File(inputPath);

      const formData = new FormData();
      const fileBuffer = readFileSync(inputPath);
      const file = new File([fileBuffer], 'test.mp3', {
        type: 'audio/mpeg'
      });
      formData.append('file', file);

      const res = await app.request('/audio/wav', {
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
      const file = new File(['invalid audio data'], 'invalid.mp3', { type: 'audio/mpeg' });
      formData.append('file', file);

      const res = await app.request('/audio/wav', {
        method: 'POST',
        body: formData
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toHaveProperty('error');
    });
  });
});

function createTestWavFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -ar 44100 -ac 2 -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function createTestMp3File(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -codec:a libmp3lame -qscale:a 2 -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
