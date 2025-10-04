import type { OpenAPIHono } from '@hono/zod-openapi';
import { audioToMp3Route, audioToWavRoute } from './schemas';
import { addJob, JobType, queueEvents } from '~/queue';
import { env } from '~/config/env';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

export function registerAudioRoutes(app: OpenAPIHono) {
  app.openapi(audioToMp3Route, async (c) => {
    try {
      const { file } = c.req.valid('form');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPath = path.join(jobDir, 'input');
      const outputPath = path.join(jobDir, 'output.mp3');

      const arrayBuffer = await file.arrayBuffer();
      await writeFile(inputPath, Buffer.from(arrayBuffer));

      const job = await addJob(JobType.AUDIO_TO_MP3, {
        inputPath,
        outputPath,
        quality: 2
      });

      const result = await job.waitUntilFinished(queueEvents);

      if (!result.success || !result.outputPath) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: result.error || 'Conversion failed' }, 400);
      }

      const outputBuffer = await readFile(result.outputPath);

      await rm(jobDir, { recursive: true, force: true });

      return c.body(new Uint8Array(outputBuffer), 200, {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^.]+$/, '')}.mp3"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(audioToWavRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPath = path.join(jobDir, 'input');
      const outputPath = path.join(jobDir, 'output.wav');

      const arrayBuffer = await file.arrayBuffer();
      await writeFile(inputPath, Buffer.from(arrayBuffer));

      const job = await addJob(JobType.AUDIO_TO_WAV, {
        inputPath,
        outputPath
      });

      const result = await job.waitUntilFinished(queueEvents);

      if (!result.success || !result.outputPath) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: result.error || 'Conversion failed' }, 400);
      }

      const outputBuffer = await readFile(result.outputPath);

      await rm(jobDir, { recursive: true, force: true });

      return c.body(new Uint8Array(outputBuffer), 200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^.]+$/, '')}.wav"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });
}
