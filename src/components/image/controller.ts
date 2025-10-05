import type { OpenAPIHono } from '@hono/zod-openapi';
import { imageToJpgRoute, imageToJpgUrlRoute } from './schemas';
import { addJob, JobType, queueEvents } from '~/queue';
import { env } from '~/config/env';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

export function registerImageRoutes(app: OpenAPIHono) {
  app.openapi(imageToJpgRoute, async (c) => {
    try {
      const { file } = c.req.valid('form');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPath = path.join(jobDir, 'input');
      const outputPath = path.join(jobDir, 'output.jpg');

      const arrayBuffer = await file.arrayBuffer();
      await writeFile(inputPath, Buffer.from(arrayBuffer));

      const job = await addJob(JobType.IMAGE_TO_JPG, {
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
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${file.name.replace(/\.[^.]+$/, '')}.jpg"`
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });

  app.openapi(imageToJpgUrlRoute, async (c) => {
    try {
      if (env.STORAGE_MODE !== 's3') {
        return c.json({ error: 'S3 mode not enabled' }, 400);
      }

      const { file } = c.req.valid('form');

      const jobId = randomUUID();
      const jobDir = path.join(env.TEMP_DIR, jobId);
      await mkdir(jobDir, { recursive: true });

      const inputPath = path.join(jobDir, 'input');
      const outputPath = path.join(jobDir, 'output.jpg');

      const arrayBuffer = await file.arrayBuffer();
      await writeFile(inputPath, Buffer.from(arrayBuffer));

      const job = await addJob(JobType.IMAGE_TO_JPG, {
        inputPath,
        outputPath,
        quality: 2
      });

      const result = await job.waitUntilFinished(queueEvents);

      if (!result.success || !result.outputUrl) {
        await rm(jobDir, { recursive: true, force: true });
        return c.json({ error: result.error || 'Conversion failed' }, 400);
      }

      await rm(jobDir, { recursive: true, force: true });
      return c.json({ url: result.outputUrl }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'Processing failed', message: errorMessage }, 500);
    }
  });
}
