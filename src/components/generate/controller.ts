import { timingSafeEqual } from 'crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  generateRoute,
  getGenerateStatusRoute,
  webhookCompleteRoute,
  bulkInfiniteTalkRoute,
  getBatchStatusRoute,
  type IGenerateRequest,
  type IGenerateJobStatus,
  type IWebhookCallback,
  type GenerateModel,
  type IBulkInfiniteTalkRequest,
  type IBatchStatusResponse
} from './schemas';
import { queue, JobType } from '~/queue';
import { logger } from '~/config/logger';
import { env } from '~/config/env';
import { sendWebhook, sendBatchWebhook } from '~/utils/webhook';
import { runpodClient } from '~/utils/runpod';
import { uploadBufferToS3 } from '~/utils/storage';
import { createBatch, getBatch, markBatchWebhookSent, type IBatchJobResult } from '~/utils/batch';

// Map model names to job types
const MODEL_TO_JOB_TYPE: Record<GenerateModel, string> = {
  ltx2: JobType.GENERATE_LTX2_VIDEO,
  wav2lip: JobType.GENERATE_WAV2LIP,
  zimage: JobType.GENERATE_ZIMAGE,
  longcat: JobType.GENERATE_LONGCAT,
  infinitetalk: JobType.GENERATE_INFINITETALK
};

// Map job types back to model names
const JOB_TYPE_TO_MODEL: Record<string, GenerateModel> = {
  [JobType.GENERATE_LTX2_VIDEO]: 'ltx2',
  [JobType.GENERATE_WAV2LIP]: 'wav2lip',
  [JobType.GENERATE_ZIMAGE]: 'zimage',
  [JobType.GENERATE_LONGCAT]: 'longcat',
  [JobType.GENERATE_INFINITETALK]: 'infinitetalk'
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
        case 'ltx2': {
          // Check if RunPod is configured for LTX-2
          if (runpodClient.isConfigured()) {
            logger.info({ model }, 'Using RunPod for LTX-2 job');

            // Create a placeholder job in queue to track status
            const placeholderData = {
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
              createdAt: Date.now(),
              useRunPod: true,
              runpodJobId: '' // Will be updated after submission
            };

            const job = await queue.add(jobType, placeholderData);
            const ourJobId = job.id ?? '';

            // Submit to RunPod with our job ID
            const runpodResponse = await runpodClient.submitLtx2Job({
              imageUrl: body.imageUrl ?? '',
              prompt: body.prompt,
              duration: body.duration,
              fps: body.fps ?? 24,
              width: body.width ?? 1024,
              height: body.height ?? 576,
              numInferenceSteps: body.numInferenceSteps ?? 30,
              guidanceScale: body.guidanceScale ?? 7.5,
              jobId: ourJobId
            });

            // Update job with RunPod job ID
            await job.updateData({
              ...placeholderData,
              runpodJobId: runpodResponse.id
            });

            logger.info({ jobId: ourJobId, runpodJobId: runpodResponse.id }, 'LTX-2 job submitted to RunPod');

            return c.json(
              {
                success: true as const,
                jobId: ourJobId,
                model,
                status: 'queued' as const,
                message: 'Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status.'
              },
              202
            );
          }

          // Fallback to BullMQ queue if RunPod not configured
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
        }

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

        case 'zimage': {
          // Check if RunPod is configured for Z-Image
          if (runpodClient.isConfigured('zimage')) {
            logger.info({ model }, 'Using RunPod for Z-Image job');

            const placeholderData = {
              type: jobType,
              model: 'zimage',
              prompt: body.prompt,
              negativePrompt: body.negativePrompt,
              width: body.width ?? 1024,
              height: body.height ?? 1024,
              steps: body.steps ?? 9,
              guidanceScale: body.guidanceScale ?? 0,
              seed: body.seed,
              webhookUrl: body.webhookUrl,
              createdAt: Date.now(),
              useRunPod: true,
              runpodJobId: '',
              runpodEndpointType: 'zimage' as const
            };

            const job = await queue.add(jobType, placeholderData);
            const ourJobId = job.id ?? '';

            const runpodResponse = await runpodClient.submitZImageJob({
              prompt: body.prompt ?? '',
              negativePrompt: body.negativePrompt,
              width: body.width ?? 1024,
              height: body.height ?? 1024,
              steps: body.steps ?? 9,
              guidanceScale: body.guidanceScale ?? 0,
              seed: body.seed,
              jobId: ourJobId
            });

            await job.updateData({
              ...placeholderData,
              runpodJobId: runpodResponse.id
            });

            logger.info({ jobId: ourJobId, runpodJobId: runpodResponse.id }, 'Z-Image job submitted to RunPod');

            return c.json(
              {
                success: true as const,
                jobId: ourJobId,
                model,
                status: 'queued' as const,
                message: 'Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status.'
              },
              202
            );
          }

          // Fallback to BullMQ if RunPod not configured
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

        case 'longcat': {
          // Check if RunPod is configured for LongCat
          if (runpodClient.isConfigured('longcat')) {
            logger.info({ model }, 'Using RunPod for LongCat job');

            const placeholderData = {
              type: jobType,
              model: 'longcat',
              audioUrl: body.audioUrl,
              imageUrl: body.imageUrl,
              prompt: body.prompt,
              mode: body.mode ?? 'ai2v',
              resolution: body.resolution ?? '480P',
              audioCfg: body.audioCfg ?? 4,
              numSegments: body.numSegments ?? 1,
              webhookUrl: body.webhookUrl,
              createdAt: Date.now(),
              useRunPod: true,
              runpodJobId: '',
              runpodEndpointType: 'longcat' as const
            };

            const job = await queue.add(jobType, placeholderData);
            const ourJobId = job.id ?? '';

            const runpodResponse = await runpodClient.submitLongCatJob({
              audioUrl: body.audioUrl ?? '',
              imageUrl: body.imageUrl,
              prompt: body.prompt,
              mode: body.mode ?? 'ai2v',
              resolution: body.resolution ?? '480P',
              audioCfg: body.audioCfg ?? 4,
              numSegments: body.numSegments ?? 1,
              jobId: ourJobId
            });

            await job.updateData({
              ...placeholderData,
              runpodJobId: runpodResponse.id
            });

            logger.info({ jobId: ourJobId, runpodJobId: runpodResponse.id }, 'LongCat job submitted to RunPod');

            return c.json(
              {
                success: true as const,
                jobId: ourJobId,
                model,
                status: 'queued' as const,
                message: 'Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status.'
              },
              202
            );
          }

          // Fallback to BullMQ if RunPod not configured
          jobData = {
            type: jobType,
            model: 'longcat',
            audioUrl: body.audioUrl,
            imageUrl: body.imageUrl,
            prompt: body.prompt,
            mode: body.mode ?? 'ai2v',
            resolution: body.resolution ?? '480P',
            audioCfg: body.audioCfg ?? 4,
            numSegments: body.numSegments ?? 1,
            webhookUrl: body.webhookUrl,
            createdAt: Date.now()
          };
          break;
        }

        case 'infinitetalk': {
          // Check if RunPod is configured for InfiniteTalk
          if (runpodClient.isConfigured('infinitetalk')) {
            logger.info({ model }, 'Using RunPod for InfiniteTalk job');

            const placeholderData = {
              type: jobType,
              model: 'infinitetalk',
              audioUrl: body.audioUrl,
              imageUrl: body.imageUrl,
              videoUrl: body.videoUrl,
              resolution: body.resolution ?? '720',
              webhookUrl: body.webhookUrl,
              createdAt: Date.now(),
              useRunPod: true,
              runpodJobId: '',
              runpodEndpointType: 'infinitetalk' as const
            };

            const job = await queue.add(jobType, placeholderData);
            const ourJobId = job.id ?? '';

            const runpodResponse = await runpodClient.submitInfiniteTalkJob({
              audio_url: body.audioUrl ?? '',
              image_url: body.imageUrl,
              video_url: body.videoUrl,
              resolution: body.resolution ?? '720',
              jobId: ourJobId
            });

            await job.updateData({
              ...placeholderData,
              runpodJobId: runpodResponse.id
            });

            logger.info({ jobId: ourJobId, runpodJobId: runpodResponse.id }, 'InfiniteTalk job submitted to RunPod');

            return c.json(
              {
                success: true as const,
                jobId: ourJobId,
                model,
                status: 'queued' as const,
                message: 'Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status.'
              },
              202
            );
          }

          // Fallback to BullMQ if RunPod not configured
          jobData = {
            type: jobType,
            model: 'infinitetalk',
            audioUrl: body.audioUrl,
            imageUrl: body.imageUrl,
            videoUrl: body.videoUrl,
            resolution: body.resolution ?? '720',
            webhookUrl: body.webhookUrl,
            createdAt: Date.now()
          };
          break;
        }
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

      const jobData = job.data as {
        type?: string;
        model?: string;
        createdAt?: number;
        useRunPod?: boolean;
        runpodJobId?: string;
        runpodEndpointType?: 'ltx2' | 'zimage' | 'longcat' | 'infinitetalk';
        webhookUrl?: string;
        uploadedUrl?: string; // Cached URL for InfiniteTalk base64 uploads
      };

      // If this is a RunPod job, fetch status from RunPod
      const endpointType =
        jobData.runpodEndpointType ?? (jobData.model as 'ltx2' | 'zimage' | 'longcat' | 'infinitetalk' | undefined);
      if (jobData.useRunPod && jobData.runpodJobId && endpointType && runpodClient.isConfigured(endpointType)) {
        const runpodStatus = await runpodClient.getJobStatus(endpointType, jobData.runpodJobId);
        const createdAt = new Date(jobData.createdAt ?? job.timestamp).toISOString();
        const model: GenerateModel = (jobData.model as GenerateModel) ?? endpointType;

        switch (runpodStatus.status) {
          case 'IN_QUEUE':
            return c.json(
              {
                status: 'queued' as const,
                jobId,
                model,
                createdAt
              },
              200
            );

          case 'IN_PROGRESS':
            return c.json(
              {
                status: 'processing' as const,
                jobId,
                model,
                progress: 50, // RunPod doesn't provide granular progress
                startedAt: createdAt,
                createdAt
              },
              200
            );

          case 'COMPLETED': {
            const output = runpodStatus.output;
            if (output) {
              let resultUrl = output.url ?? '';
              let contentType = output.contentType ?? 'video/mp4';
              let fileSizeBytes = output.fileSizeBytes ?? 0;
              const resultWidth = output.width ?? 0;
              const resultHeight = output.height ?? 0;
              const processingTimeMs = output.processingTimeMs ?? 0;

              // InfiniteTalk returns base64 video instead of URL
              if (endpointType === 'infinitetalk' && output.video) {
                // Check if we already uploaded this (cached URL)
                if (jobData.uploadedUrl) {
                  resultUrl = jobData.uploadedUrl;
                  logger.info({ jobId, url: resultUrl }, 'Using cached InfiniteTalk upload URL');
                } else {
                  // Decode base64 and upload to R2
                  logger.info({ jobId }, 'Decoding InfiniteTalk base64 video and uploading to R2');
                  const videoBuffer = Buffer.from(output.video, 'base64');
                  fileSizeBytes = videoBuffer.length;
                  contentType = 'video/mp4';

                  const uploadResult = await uploadBufferToS3(videoBuffer, contentType, `infinitetalk-${jobId}.mp4`);
                  resultUrl = uploadResult.url;

                  // Cache the uploaded URL in job data
                  const currentData = job.data as Record<string, unknown>;
                  await job.updateData({
                    ...currentData,
                    uploadedUrl: resultUrl
                  });

                  logger.info({ jobId, url: resultUrl, size: fileSizeBytes }, 'InfiniteTalk video uploaded to R2');
                }
              }

              // Update job data with result
              const currentJobData = job.data as Record<string, unknown>;
              await job.updateData({
                ...currentJobData,
                uploadedUrl: resultUrl,
                completedResult: {
                  url: resultUrl,
                  contentType,
                  fileSizeBytes,
                  durationMs: output.durationMs,
                  width: resultWidth,
                  height: resultHeight,
                  processingTimeMs
                }
              });

              // Send webhook if configured
              if (jobData.webhookUrl) {
                await sendWebhook(jobData.webhookUrl, jobId, 'completed', {
                  url: resultUrl,
                  fileSizeBytes,
                  processingTimeMs
                });
              }

              return c.json(
                {
                  status: 'completed' as const,
                  jobId,
                  model,
                  result: {
                    url: resultUrl,
                    contentType,
                    fileSizeBytes,
                    durationMs: output.durationMs,
                    width: resultWidth,
                    height: resultHeight
                  },
                  processingTimeMs,
                  createdAt,
                  completedAt: new Date().toISOString()
                },
                200
              );
            }
            break;
          }

          case 'FAILED':
          case 'CANCELLED': {
            const errorMsg = runpodStatus.error ?? 'Job failed on RunPod';

            // Update job data with error
            const failedJobData = job.data as Record<string, unknown>;
            await job.updateData({
              ...failedJobData,
              failedError: errorMsg,
              failedAt: Date.now()
            });

            if (jobData.webhookUrl) {
              await sendWebhook(jobData.webhookUrl, jobId, 'failed', undefined, errorMsg);
            }

            return c.json(
              {
                status: 'failed' as const,
                jobId,
                model,
                error: errorMsg,
                createdAt,
                failedAt: new Date().toISOString()
              },
              200
            );
          }
        }
      }

      const state = await job.getState();
      const progress = job.progress as number | undefined;

      // Extract model from job data or type
      let model: GenerateModel;
      if (jobData.model && ['ltx2', 'wav2lip', 'zimage', 'longcat', 'infinitetalk'].includes(jobData.model)) {
        model = jobData.model as GenerateModel;
      } else if (jobData.type && jobData.type in JOB_TYPE_TO_MODEL) {
        const mappedModel = JOB_TYPE_TO_MODEL[jobData.type];
        if (!mappedModel) {
          return c.json({ error: 'Job not found or invalid job type' }, 404);
        }
        model = mappedModel;
      } else {
        return c.json({ error: 'Job not found or invalid job type' }, 404);
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
        // Update job data with result
        const currentData = job.data as Record<string, unknown>;
        await job.updateData({
          ...currentData,
          completedAt: Date.now(),
          completedResult: {
            url: result.url,
            contentType: result.contentType,
            fileSizeBytes: result.fileSizeBytes,
            durationMs: result.durationMs,
            width: result.width,
            height: result.height,
            processingTimeMs
          }
        });

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
        // Update job data with error
        const currentData = job.data as Record<string, unknown>;
        await job.updateData({
          ...currentData,
          failedError: error ?? 'Unknown error',
          failedAt: Date.now()
        });

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

  // POST /api/v1/generate/bulk/infinitetalk
  app.openapi(bulkInfiniteTalkRoute, async (c) => {
    try {
      const body = c.req.valid('json') as IBulkInfiniteTalkRequest;
      const { jobs, webhookUrl } = body;

      // Verify RunPod is configured for InfiniteTalk
      if (!runpodClient.isConfigured('infinitetalk')) {
        return c.json({ error: 'InfiniteTalk is not configured on RunPod' }, 500);
      }

      logger.info({ jobCount: jobs.length, webhookUrl }, 'Processing bulk InfiniteTalk request');

      // Submit all jobs to RunPod in parallel
      const jobPromises = jobs.map(async (jobInput, index) => {
        // Create a placeholder job in queue to track status
        const placeholderData = {
          type: JobType.GENERATE_INFINITETALK,
          model: 'infinitetalk',
          audioUrl: jobInput.audioUrl,
          imageUrl: jobInput.imageUrl,
          videoUrl: jobInput.videoUrl,
          resolution: jobInput.resolution ?? '720',
          createdAt: Date.now(),
          useRunPod: true,
          runpodJobId: '',
          runpodEndpointType: 'infinitetalk' as const,
          isBulkJob: true
        };

        const job = await queue.add(JobType.GENERATE_INFINITETALK, placeholderData);
        const ourJobId = job.id ?? '';

        // Submit to RunPod
        const runpodResponse = await runpodClient.submitInfiniteTalkJob({
          audio_url: jobInput.audioUrl,
          image_url: jobInput.imageUrl,
          video_url: jobInput.videoUrl,
          resolution: jobInput.resolution ?? '720',
          jobId: ourJobId
        });

        // Update job with RunPod job ID
        await job.updateData({
          ...placeholderData,
          runpodJobId: runpodResponse.id
        });

        logger.info(
          { jobId: ourJobId, runpodJobId: runpodResponse.id, index },
          'Bulk InfiniteTalk job submitted to RunPod'
        );

        return {
          jobId: ourJobId,
          status: 'queued' as const
        };
      });

      // Wait for all job submissions
      const submittedJobs = await Promise.all(jobPromises);
      const jobIds = submittedJobs.map((j) => j.jobId);

      // Create batch for tracking
      const batchMetadata = await createBatch(jobIds, 'infinitetalk', webhookUrl);

      logger.info({ batchId: batchMetadata.batchId, totalJobs: jobIds.length }, 'Bulk InfiniteTalk batch created');

      return c.json(
        {
          success: true as const,
          batchId: batchMetadata.batchId,
          model: 'infinitetalk' as const,
          totalJobs: jobs.length,
          jobs: submittedJobs,
          message: `Batch queued. Poll GET /api/v1/generate/bulk/${batchMetadata.batchId} for status.`
        },
        202
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to create bulk InfiniteTalk batch');
      return c.json({ error: 'Failed to create batch', details: { message: errorMessage } }, 500);
    }
  });

  // GET /api/v1/generate/bulk/:batchId
  app.openapi(getBatchStatusRoute, async (c) => {
    try {
      const { batchId } = c.req.valid('param');

      const batchMetadata = await getBatch(batchId);
      if (!batchMetadata) {
        return c.json({ error: 'Batch not found' }, 404);
      }

      // Fetch status of all jobs in the batch
      const jobResults: IBatchJobResult[] = [];
      let completedCount = 0;
      let failedCount = 0;

      for (const jobId of batchMetadata.jobIds) {
        const job = await queue.getJob(jobId);
        if (!job) {
          jobResults.push({
            jobId,
            status: 'failed',
            error: 'Job not found'
          });
          failedCount++;
          continue;
        }

        const jobData = job.data as {
          useRunPod?: boolean;
          runpodJobId?: string;
          runpodEndpointType?: 'infinitetalk';
          uploadedUrl?: string;
          completedResult?: {
            url: string;
            fileSizeBytes: number;
            processingTimeMs: number;
          };
          failedError?: string;
        };

        // If this is a RunPod job, fetch status from RunPod
        if (jobData.useRunPod && jobData.runpodJobId && runpodClient.isConfigured('infinitetalk')) {
          try {
            const runpodStatus = await runpodClient.getJobStatus('infinitetalk', jobData.runpodJobId);

            switch (runpodStatus.status) {
              case 'IN_QUEUE':
                jobResults.push({ jobId, status: 'queued' });
                break;

              case 'IN_PROGRESS':
                jobResults.push({ jobId, status: 'processing' });
                break;

              case 'COMPLETED': {
                const output = runpodStatus.output;
                if (output) {
                  let resultUrl = output.url ?? '';
                  let fileSizeBytes = output.fileSizeBytes ?? 0;
                  const processingTimeMs = output.processingTimeMs ?? 0;

                  // InfiniteTalk returns base64 video - upload to R2 if not cached
                  if (output.video && !jobData.uploadedUrl) {
                    logger.info({ jobId }, 'Decoding batch InfiniteTalk base64 video and uploading to R2');
                    const videoBuffer = Buffer.from(output.video, 'base64');
                    fileSizeBytes = videoBuffer.length;

                    const uploadResult = await uploadBufferToS3(videoBuffer, 'video/mp4', `infinitetalk-${jobId}.mp4`);
                    resultUrl = uploadResult.url;

                    // Cache the uploaded URL
                    const currentData = job.data as Record<string, unknown>;
                    await job.updateData({
                      ...currentData,
                      uploadedUrl: resultUrl,
                      completedResult: { url: resultUrl, fileSizeBytes, processingTimeMs }
                    });
                  } else if (jobData.uploadedUrl) {
                    resultUrl = jobData.uploadedUrl;
                    fileSizeBytes = jobData.completedResult?.fileSizeBytes ?? fileSizeBytes;
                  }

                  jobResults.push({
                    jobId,
                    status: 'completed',
                    result: { url: resultUrl, fileSizeBytes, processingTimeMs }
                  });
                  completedCount++;
                } else {
                  jobResults.push({ jobId, status: 'completed', result: jobData.completedResult });
                  completedCount++;
                }
                break;
              }

              case 'FAILED':
              case 'CANCELLED': {
                const errorMsg = runpodStatus.error ?? 'Job failed on RunPod';
                jobResults.push({ jobId, status: 'failed', error: errorMsg });
                failedCount++;
                break;
              }

              default:
                jobResults.push({ jobId, status: 'queued' });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error({ jobId, error: errMsg }, 'Failed to fetch RunPod job status');
            jobResults.push({ jobId, status: 'failed', error: errMsg });
            failedCount++;
          }
        } else {
          // Fallback for non-RunPod jobs
          const state = await job.getState();
          if (state === 'completed') {
            jobResults.push({
              jobId,
              status: 'completed',
              result: jobData.completedResult
            });
            completedCount++;
          } else if (state === 'failed') {
            jobResults.push({
              jobId,
              status: 'failed',
              error: jobData.failedError ?? 'Unknown error'
            });
            failedCount++;
          } else if (state === 'active') {
            jobResults.push({ jobId, status: 'processing' });
          } else {
            jobResults.push({ jobId, status: 'queued' });
          }
        }
      }

      // Calculate overall batch status
      const totalFinished = completedCount + failedCount;
      let batchStatus: 'pending' | 'processing' | 'completed' | 'partial_failure';

      if (totalFinished === 0) {
        batchStatus = 'pending';
      } else if (totalFinished < batchMetadata.totalJobs) {
        batchStatus = 'processing';
      } else if (failedCount === 0) {
        batchStatus = 'completed';
      } else {
        batchStatus = 'partial_failure';
      }

      // Send webhook if batch is complete and webhook hasn't been sent yet
      if (
        (batchStatus === 'completed' || batchStatus === 'partial_failure') &&
        batchMetadata.webhookUrl &&
        !batchMetadata.webhookSent
      ) {
        // Transform results for webhook
        const webhookResults = jobResults.map((r) => ({
          jobId: r.jobId,
          model: 'infinitetalk',
          status: r.status === 'completed' ? ('completed' as const) : ('failed' as const),
          result: r.result,
          error: r.error
        }));

        await sendBatchWebhook(
          batchMetadata.webhookUrl,
          batchId,
          batchStatus === 'completed' ? 'completed' : 'partial_failure',
          batchMetadata.totalJobs,
          completedCount,
          failedCount,
          webhookResults
        );

        await markBatchWebhookSent(batchId);
      }

      // Build response based on status
      const baseResponse = {
        batchId,
        model: 'infinitetalk' as const,
        totalJobs: batchMetadata.totalJobs,
        completedJobs: completedCount,
        failedJobs: failedCount,
        results: jobResults,
        createdAt: batchMetadata.createdAt
      };

      let response: IBatchStatusResponse;

      switch (batchStatus) {
        case 'pending':
          response = {
            status: 'pending',
            ...baseResponse,
            completedJobs: 0,
            failedJobs: 0
          };
          break;
        case 'processing':
          response = {
            status: 'processing',
            ...baseResponse
          };
          break;
        case 'completed':
          response = {
            status: 'completed',
            ...baseResponse,
            failedJobs: 0,
            completedAt: batchMetadata.completedAt ?? new Date().toISOString()
          };
          break;
        case 'partial_failure':
          response = {
            status: 'partial_failure',
            ...baseResponse,
            completedAt: batchMetadata.completedAt ?? new Date().toISOString()
          };
          break;
      }

      return c.json(response, 200);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to get batch status');
      return c.json({ error: 'Failed to get batch status' }, 500);
    }
  });
}
