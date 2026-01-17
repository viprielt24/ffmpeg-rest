import { Worker } from 'bullmq';
import { connection, checkRedisHealth } from '~/config/redis';
import { env } from '~/config/env';
import { logger } from '~/config/logger';
import { QUEUE_NAME, JobType } from '~/queue';
import type { JobResult } from '~/queue';
import { checkS3Health } from '~/utils/storage';
import { sendWebhook } from '~/utils/webhook';

import { processAudioToMp3, processAudioToWav } from '~/queue/audio/processor';
import { processVideoToMp4, processVideoExtractAudio, processVideoExtractFrames } from '~/queue/video/processor';
import { processImageToJpg, processImageResize } from '~/queue/image/processor';
import { processMediaProbe } from '~/queue/media/processor';
import { processMuxVideoAudio, processConcatenateVideos } from '~/queue/mux/processor';
import { processNormalizeVideo } from '~/queue/normalize/processor';

await checkRedisHealth();

const worker = new Worker<unknown, JobResult>(
  QUEUE_NAME,
  async (job) => {
    logger.info({ jobId: job.id, jobType: job.name }, 'Processing job');

    switch (job.name) {
      case JobType.AUDIO_TO_MP3:
        return processAudioToMp3(job as never);
      case JobType.AUDIO_TO_WAV:
        return processAudioToWav(job as never);
      case JobType.VIDEO_TO_MP4:
        return processVideoToMp4(job as never);
      case JobType.VIDEO_EXTRACT_AUDIO:
        return processVideoExtractAudio(job as never);
      case JobType.VIDEO_EXTRACT_FRAMES:
        return processVideoExtractFrames(job as never);
      case JobType.IMAGE_TO_JPG:
        return processImageToJpg(job as never);
      case JobType.IMAGE_RESIZE:
        return processImageResize(job as never);
      case JobType.MEDIA_PROBE:
        return processMediaProbe(job as never);
      case JobType.MUX_VIDEO_AUDIO:
        return processMuxVideoAudio(job as never);
      case JobType.CONCATENATE_VIDEOS:
        return processConcatenateVideos(job as never);
      case JobType.NORMALIZE_VIDEO:
        return processNormalizeVideo(job as never);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY
  }
);

worker.on('completed', async (job, result: JobResult) => {
  logger.info({ jobId: job.id }, 'Job completed successfully');

  // Send webhook if configured
  const jobData = job.data as { webhookUrl?: string };
  if (jobData.webhookUrl && job.id) {
    const webhookResult =
      result.success && result.outputUrl && result.metadata
        ? {
            url: result.outputUrl,
            fileSizeBytes: (result.metadata['fileSizeBytes'] as number) ?? 0,
            processingTimeMs: (result.metadata['processingTimeMs'] as number) ?? 0
          }
        : undefined;

    await sendWebhook(jobData.webhookUrl, job.id, result.success ? 'completed' : 'failed', webhookResult, result.error);
  }
});

worker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Job failed');

  // Send webhook if configured (only on final failure after all retries)
  if (job?.id && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    const jobData = job.data as { webhookUrl?: string };
    if (jobData.webhookUrl) {
      await sendWebhook(jobData.webhookUrl, job.id, 'failed', undefined, err.message);
    }
  }
});

worker.on('error', (err) => {
  logger.error({ error: err.message }, 'Worker error');
});

logger.info(`🔄 Worker started processing queue: ${QUEUE_NAME}`);
logger.info(`⚙️  Concurrency: ${env.WORKER_CONCURRENCY}`);
logger.info(`💾 Storage Mode: ${env.STORAGE_MODE.toUpperCase()}`);

if (env.STORAGE_MODE === 's3') {
  logger.info(`   S3 Bucket: ${env.S3_BUCKET}`);
  logger.info(`   S3 Region: ${env.S3_REGION}`);
  logger.info(`   S3 Prefix: ${env.S3_PATH_PREFIX}`);
  await checkS3Health();
}
