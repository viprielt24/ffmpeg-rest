import { timingSafeEqual } from 'crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  generateRoute,
  getGenerateStatusRoute,
  webhookCompleteRoute,
  type IGenerateRequest,
  type IGenerateJobStatus,
  type IWebhookCallback,
  type GenerateModel
} from './schemas';
import { queue, JobType } from '~/queue';
import { logger } from '~/config/logger';
import { env } from '~/config/env';
import { sendWebhook } from '~/utils/webhook';

// Map model names to job types
const MODEL_TO_JOB_TYPE: Record<GenerateModel, string> = {
  ltx2: JobType.GENERATE_LTX2_VIDEO,
  wav2lip: JobType.GENERATE_WAV2LIP,
  zimage: JobType.GENERATE_ZIMAGE
};

// Map job types back to model names
const JOB_TYPE_TO_MODEL: Record<string, GenerateModel> = {
  [JobType.GENERATE_LTX2_VIDEO]: 'ltx2',
  [JobType.GENERATE_WAV2LIP]: 'wav2lip',
  [JobType.GENERATE_ZIMAGE]: 'zimage'
};

export function registerGenerateRoutes(app: OpenAPIHono) {
  // POST /api/v1/generate
  app.openapi(generateRoute, async (c) => {
    try {
      const body = c.req.valid('json') as IGenerateRequest;
      const { model } = body;

      const jobType = MODEL_TO_JOB_TYPE[model];

      logger.info({ model, jobType }, 'Queueing generation job');

      // Build job data based on model
      let jobData: Record<string, unknown>;

      switch (model) {
        case 'ltx2':
          jobData = {
            type: jobType,
            model: 'ltx2',
            imageUrl: body.imageUrl,
            prompt: body.prompt,
            duration: body.duration,
            width: body.width ?? 1024,
            height: body.height ?? 576,
            numInferenceSteps: body.numInferenceSteps ?? 30,
            guidanceScale: body.guidanceScale ?? 7.5,
            fps: body.fps ?? 24,
            webhookUrl: body.webhookUrl,
            createdAt: Date.now()
          };
          break;

        case 'wav2lip':
          jobData = {
            type: jobType,
            model: 'wav2lip',
            videoUrl: body.videoUrl,
            audioUrl: body.audioUrl,
            padTop: body.padTop ?? 0,
            padBottom: body.padBottom ?? 10,
            padLeft: body.padLeft ?? 0,
            padRight: body.padRight ?? 0,
            webhookUrl: body.webhookUrl,
            createdAt: Date.now()
          };
          break;

        case 'zimage':
          jobData = {
            type: jobType,
            model: 'zimage',
            prompt: body.prompt,
            negativePrompt: body.negativePrompt,
            width: body.width ?? 1024,
            height: body.height ?? 1024,
            steps: body.steps ?? 30,
            guidanceScale: body.guidanceScale ?? 0,
            seed: body.seed,
            webhookUrl: body.webhookUrl,
            createdAt: Date.now()
          };
          break;
      }

      const job = await queue.add(jobType, jobData);

      logger.info({ jobId: job.id, model }, 'Generation job queued');

      return c.json(
        {
          success: true as const,
          jobId: job.id ?? '',
          model,
          status: 'queued' as const,
          message: 'Job queued. Poll GET /api/v1/generate/{jobId} for status.'
        },
        202
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to queue generation job');
      return c.json({ error: 'Failed to queue job', details: { message: errorMessage } }, 500);
    }
  });

  // GET /api/v1/generate/:jobId
  app.openapi(getGenerateStatusRoute, async (c) => {
    try {
      const { jobId } = c.req.valid('param');

      const job = await queue.getJob(jobId);

      if (!job) {
        return c.json({ error: 'Job not found' }, 404);
      }

      const state = await job.getState();
      const progress = job.progress as number | undefined;
      const jobData = job.data as { type?: string; model?: string; createdAt?: number };

      // Extract model from job data or type
      let model: GenerateModel;
      if (jobData.model && ['ltx2', 'wav2lip', 'zimage'].includes(jobData.model)) {
        model = jobData.model as GenerateModel;
      } else if (jobData.type && jobData.type in JOB_TYPE_TO_MODEL) {
        model = JOB_TYPE_TO_MODEL[jobData.type];
      } else {
        return c.json({ error: 'Invalid job type' }, 400);
      }

      const createdAt = new Date(jobData.createdAt ?? job.timestamp).toISOString();

      let response: IGenerateJobStatus;

      switch (state) {
        case 'waiting':
        case 'delayed':
          response = {
            status: 'queued',
            jobId,
            model,
            createdAt
          };
          break;

        case 'active':
          response = {
            status: 'processing',
            jobId,
            model,
            progress: typeof progress === 'number' ? progress : 0,
            startedAt: new Date(job.processedOn ?? Date.now()).toISOString(),
            createdAt
          };
          break;

        case 'completed': {
          const result = job.returnvalue as {
            url?: string;
            contentType?: string;
            fileSizeBytes?: number;
            durationMs?: number;
            width?: number;
            height?: number;
            processingTimeMs?: number;
          };

          response = {
            status: 'completed',
            jobId,
            model,
            result: {
              url: result.url ?? '',
              contentType: result.contentType ?? (model === 'zimage' ? 'image/png' : 'video/mp4'),
              fileSizeBytes: result.fileSizeBytes ?? 0,
              durationMs: result.durationMs,
              width: result.width ?? 0,
              height: result.height ?? 0
            },
            processingTimeMs: result.processingTimeMs ?? 0,
            createdAt,
            completedAt: new Date(job.finishedOn ?? Date.now()).toISOString()
          };
          break;
        }

        case 'failed':
          response = {
            status: 'failed',
            jobId,
            model,
            error: job.failedReason ?? 'Unknown error',
            createdAt,
            failedAt: new Date(job.finishedOn ?? Date.now()).toISOString()
          };
          break;

        default:
          response = {
            status: 'queued',
            jobId,
            model,
            createdAt
          };
      }

      return c.json(response, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to get job status');
      return c.json({ error: 'Failed to get job status' }, 500);
    }
  });

  // POST /webhooks/generate/complete
  app.openapi(webhookCompleteRoute, async (c) => {
    try {
      // Verify webhook secret
      const webhookSecret = c.req.header('X-Webhook-Secret');
      const expectedSecret = env.WEBHOOK_SECRET;

      if (!expectedSecret) {
        logger.error('WEBHOOK_SECRET not configured');
        return c.json({ error: 'Webhook secret not configured' }, 500);
      }

      if (!webhookSecret || !timingSafeEqual(Buffer.from(webhookSecret), Buffer.from(expectedSecret))) {
        logger.warn('Invalid webhook secret received');
        return c.json({ error: 'Invalid webhook secret' }, 401);
      }

      const body = c.req.valid('json') as IWebhookCallback;
      const { jobId, status, result, error, processingTimeMs } = body;

      logger.info({ jobId, status }, 'Webhook callback received');

      const job = await queue.getJob(jobId);

      if (!job) {
        logger.warn({ jobId }, 'Job not found for webhook');
        return c.json({ error: 'Job not found' }, 404);
      }

      const jobData = job.data as { webhookUrl?: string; model?: string };

      if (status === 'completed' && result) {
        // Update job with result and mark as completed
        await job.updateData({
          ...job.data,
          completedAt: Date.now(),
          result: {
            url: result.url,
            contentType: result.contentType,
            fileSizeBytes: result.fileSizeBytes,
            durationMs: result.durationMs,
            width: result.width,
            height: result.height,
            processingTimeMs
          }
        });

        // Move to completed state with return value
        await job.moveToCompleted(
          {
            success: true,
            url: result.url,
            contentType: result.contentType,
            fileSizeBytes: result.fileSizeBytes,
            durationMs: result.durationMs,
            width: result.width,
            height: result.height,
            processingTimeMs
          },
          jobId,
          false
        );

        logger.info({ jobId }, 'Job marked as completed');

        // Forward webhook to client if configured
        if (jobData.webhookUrl) {
          await sendWebhook(jobData.webhookUrl, jobId, 'completed', {
            url: result.url,
            fileSizeBytes: result.fileSizeBytes,
            processingTimeMs: processingTimeMs ?? 0
          });
        }
      } else if (status === 'failed') {
        // Mark job as failed
        await job.moveToFailed(new Error(error ?? 'Unknown error'), jobId, false);

        logger.info({ jobId, error }, 'Job marked as failed');

        // Forward webhook to client if configured
        if (jobData.webhookUrl) {
          await sendWebhook(jobData.webhookUrl, jobId, 'failed', undefined, error);
        }
      }

      return c.json({ received: true as const }, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Webhook processing error');
      return c.json({ error: 'Webhook processing failed' }, 500);
    }
  });
}
