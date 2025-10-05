import { Queue, QueueEvents } from 'bullmq';
import { connection } from '~/config/redis';
import { logger } from '~/config/logger';

export const JobType = {
  AUDIO_TO_MP3: 'audio:mp3',
  AUDIO_TO_WAV: 'audio:wav',
  VIDEO_TO_MP4: 'video:mp4',
  VIDEO_EXTRACT_AUDIO: 'video:audio',
  VIDEO_EXTRACT_FRAMES: 'video:frames',
  IMAGE_TO_JPG: 'image:jpg',
  MEDIA_PROBE: 'media:info'
} as const;

export type JobTypeName = (typeof JobType)[keyof typeof JobType];

export interface JobResult {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  outputUrl?: string;
  outputUrls?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
}

export const QUEUE_NAME = 'ffmpeg-jobs';

export const queue = new Queue<unknown, JobResult>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    },
    removeOnComplete: {
      age: 3600,
      count: 100
    },
    removeOnFail: {
      age: 86400,
      count: 500
    }
  }
});

export const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

export const addJob = async (name: string, data: unknown) => {
  logger.debug({ jobType: name, data }, 'Adding job to queue');

  try {
    const job = await queue.add(name, data);
    logger.info({ jobId: job.id, jobType: name }, 'Job added to queue');
    return job;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ jobType: name, error: errorMessage }, 'Failed to add job');
    throw error;
  }
};
