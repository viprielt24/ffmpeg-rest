import { z } from 'zod';

export const MuxVideoAudioJobDataSchema = z.object({
  type: z.literal('mux'),
  videoUrl: z.string().url(),
  audioUrl: z.string().url(),
  duration: z.number().positive().optional(),
  webhookUrl: z.string().url().optional()
});

export type IMuxVideoAudioJobData = z.infer<typeof MuxVideoAudioJobDataSchema>;

export const ConcatenateVideosJobDataSchema = z.object({
  type: z.literal('concatenate'),
  videoUrls: z.array(z.string().url()).min(2),
  webhookUrl: z.string().url().optional()
});

export type IConcatenateVideosJobData = z.infer<typeof ConcatenateVideosJobDataSchema>;
