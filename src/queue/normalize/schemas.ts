import { z } from 'zod';

export const NormalizeVideoJobDataSchema = z.object({
  type: z.literal('normalize'),
  videoUrl: z.string().url(),
  webhookUrl: z.string().url().optional(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  videoBitrate: z.string().optional(),
  crf: z.number(),
  preset: z.string(),
  audioBitrate: z.string().optional(),
  audioSampleRate: z.number(),
  audioChannels: z.number(),
  duration: z.number().optional()
});

export type INormalizeVideoJobData = z.infer<typeof NormalizeVideoJobDataSchema>;
