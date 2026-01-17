import type { OpenAPIHono } from '@hono/zod-openapi';
import { normalizeRoute } from './schemas';
import { queue, JobType } from '~/queue';
import { logger } from '~/config/logger';
import { env } from '~/config/env';

export function registerNormalizeRoutes(app: OpenAPIHono) {
  app.openapi(normalizeRoute, async (c) => {
    try {
      const body = c.req.valid('json');

      // Validate S3 mode is enabled for URL-based processing
      if (env.STORAGE_MODE !== 's3') {
        return c.json(
          {
            error: 'S3 mode required',
            message: 'URL-based normalize requires STORAGE_MODE=s3 to be configured'
          },
          400
        );
      }

      logger.info(
        { videoUrl: body.videoUrl, width: body.width, height: body.height, fps: body.fps },
        'Queueing normalize job'
      );

      const job = await queue.add(JobType.NORMALIZE_VIDEO, {
        type: 'normalize',
        videoUrl: body.videoUrl,
        webhookUrl: body.webhookUrl,
        width: body.width,
        height: body.height,
        fps: body.fps,
        videoBitrate: body.videoBitrate,
        crf: body.crf,
        preset: body.preset,
        audioBitrate: body.audioBitrate,
        audioSampleRate: body.audioSampleRate,
        audioChannels: body.audioChannels,
        duration: body.duration
      });

      logger.info({ jobId: job.id }, 'Normalize job queued');

      return c.json(
        {
          success: true as const,
          jobId: job.id ?? '',
          status: 'queued' as const,
          message: 'Job queued successfully. Poll GET /jobs/:jobId for status.'
        },
        202
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to queue normalize job');
      return c.json({ error: 'Failed to queue job', message: errorMessage }, 500);
    }
  });
}
