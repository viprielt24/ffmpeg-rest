import { z } from 'zod';

export const ImageToJpgJobDataSchema = z.object({
  inputPath: z.string(),
  outputPath: z.string(),
  quality: z.number().min(1).max(31).default(2)
});

export type ImageToJpgJobData = z.infer<typeof ImageToJpgJobDataSchema>;
