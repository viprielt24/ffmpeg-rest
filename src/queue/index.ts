import { Queue, QueueEvents } from 'bullmq';
import { connection } from '~/config/redis';

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

export type JobResult = {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
};

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
  return queue.add(name, data);
};
