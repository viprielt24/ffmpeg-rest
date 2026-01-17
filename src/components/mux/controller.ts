import type { OpenAPIHono } from '@hono/zod-openapi';
import { muxRoute, jobStatusRoute, type IJobStatusResponse } from './schemas';
import { queue, JobType } from '~/queue';
import { logger } from '~/config/logger';
import { env } from '~/config/env';

export function registerMuxRoutes(app: OpenAPIHono) {
  app.openapi(muxRoute, async (c) => {
    try {
      const body = c.req.valid('json');

      // Validate S3 mode is enabled for URL-based processing
      if (env.STORAGE_MODE !== 's3') {
        return c.json(
          {
            error: 'S3 mode required',
            message: 'URL-based mux requires STORAGE_MODE=s3 to be configured'
          },
          400
        );
      }

      logger.info({ videoUrl: body.videoUrl, audioUrl: body.audioUrl }, 'Queueing mux job');

      const job = await queue.add(JobType.MUX_VIDEO_AUDIO, {
        type: 'mux',
        videoUrl: body.videoUrl,
        audioUrl: body.audioUrl,
        duration: body.duration,
        webhookUrl: body.webhookUrl
      });

      logger.info({ jobId: job.id }, 'Mux job queued');

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
      logger.error({ error: errorMessage }, 'Failed to queue mux job');
      return c.json({ error: 'Failed to queue job', message: errorMessage }, 500);
    }
  });

  app.openapi(jobStatusRoute, async (c) => {
    try {
      const { jobId } = c.req.valid('param');

      const job = await queue.getJob(jobId);

      if (!job) {
        return c.json({ error: 'Job not found' }, 404);
      }

      const state = await job.getState();
      const progress = job.progress as number | undefined;

      let response: IJobStatusResponse;

      switch (state) {
        case 'waiting':
        case 'delayed':
          response = {
            status: 'queued',
            jobId,
            progress: 0
          };
          break;

        case 'active':
          response = {
            status: 'active',
            jobId,
            progress: typeof progress === 'number' ? progress : 0
          };
          break;

        case 'completed': {
          const result = job.returnvalue as {
            outputUrl?: string;
            fileSizeBytes?: number;
            processingTimeMs?: number;
          };

          response = {
            status: 'completed',
            jobId,
            result: {
              url: result.outputUrl ?? '',
              fileSizeBytes: result.fileSizeBytes ?? 0,
              processingTimeMs: result.processingTimeMs ?? 0
            }
          };
          break;
        }

        case 'failed': {
          const failedReason = job.failedReason ?? 'Unknown error';
          response = {
            status: 'failed',
            jobId,
            error: failedReason
          };
          break;
        }

        default:
          response = {
            status: 'queued',
            jobId,
            progress: 0
          };
      }

      return c.json(response, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to get job status');
      return c.json({ error: 'Failed to get job status', message: errorMessage }, 500);
    }
  });
}
