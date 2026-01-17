import { z } from 'zod';

export const NormalizeVideoJobDataSchema = z.object({
  type: z.literal('normalize'),
  videoUrl: z.string().url(),
  webhookUrl: z.string().url().optional(),
  // Video parameters (all optional - defaults applied by processor)
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  videoBitrate: z.string().optional(),
  crf: z.number().min(0).max(51).optional(),
  preset: z.string().optional(),
  // Audio parameters (all optional)
  audioBitrate: z.string().optional(),
  audioSampleRate: z.number().positive().optional(),
  audioChannels: z.number().min(1).max(8).optional(),
  // Trim duration
  duration: z.number().positive().optional()
});

export type INormalizeVideoJobData = z.infer<typeof NormalizeVideoJobDataSchema>;
