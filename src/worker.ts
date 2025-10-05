import { Worker } from 'bullmq';
import { connection } from '~/config/redis';
import { env } from '~/config/env';
import { QUEUE_NAME, JobType } from '~/queue';
import type { JobResult } from '~/queue';
import { checkS3Health } from '~/utils/storage';

import { processAudioToMp3, processAudioToWav } from '~/queue/audio/processor';
import { processVideoToMp4, processVideoExtractAudio, processVideoExtractFrames } from '~/queue/video/processor';
import { processImageToJpg } from '~/queue/image/processor';
import { processMediaProbe } from '~/queue/media/processor';

const worker = new Worker<unknown, JobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`Processing job ${job.id} of type ${job.name}`);

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
      case JobType.MEDIA_PROBE:
        return processMediaProbe(job as never);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY
  }
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

console.log(`🔄 Worker started processing queue: ${QUEUE_NAME}`);
console.log(`⚙️  Concurrency: ${env.WORKER_CONCURRENCY}`);
console.log(`💾 Storage Mode: ${env.STORAGE_MODE.toUpperCase()}`);
if (env.STORAGE_MODE === 's3') {
  console.log(`   S3 Bucket: ${env.S3_BUCKET}`);
  console.log(`   S3 Region: ${env.S3_REGION}`);
  console.log(`   S3 Prefix: ${env.S3_PATH_PREFIX}`);
  await checkS3Health();
}
