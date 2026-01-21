import { z } from 'zod';

/**
 * Base schema for all AI generation job data
 */
const BaseJobDataSchema = z.object({
  webhookUrl: z.string().url().optional(),
  createdAt: z.number(),
  attempts: z.number().default(0)
});

/**
 * LTX-2 Job Data (Image-to-Video)
 */
export const LTX2JobDataSchema = BaseJobDataSchema.extend({
  type: z.literal('generate:ltx2'),
  model: z.literal('ltx2'),
  imageUrl: z.string().url(),
  prompt: z.string().optional(),
  duration: z.number().default(5),
  width: z.number().default(1024),
  height: z.number().default(576)
});

export type ILTX2JobData = z.infer<typeof LTX2JobDataSchema>;

/**
 * Wav2Lip Job Data (Lip-Sync)
 */
export const Wav2LipJobDataSchema = BaseJobDataSchema.extend({
  type: z.literal('generate:wav2lip'),
  model: z.literal('wav2lip'),
  videoUrl: z.string().url(),
  audioUrl: z.string().url(),
  padTop: z.number().default(0),
  padBottom: z.number().default(10),
  padLeft: z.number().default(0),
  padRight: z.number().default(0)
});

export type IWav2LipJobData = z.infer<typeof Wav2LipJobDataSchema>;

/**
 * Z-Image Job Data (Text-to-Image)
 */
export const ZImageJobDataSchema = BaseJobDataSchema.extend({
  type: z.literal('generate:zimage'),
  model: z.literal('zimage'),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  width: z.number().default(1024),
  height: z.number().default(1024),
  steps: z.number().default(30),
  guidanceScale: z.number().default(0),
  seed: z.number().optional()
});

export type IZImageJobData = z.infer<typeof ZImageJobDataSchema>;

/**
 * Union type for all AI generation job data
 */
export const GenerateJobDataSchema = z.discriminatedUnion('type', [
  LTX2JobDataSchema,
  Wav2LipJobDataSchema,
  ZImageJobDataSchema
]);

export type IGenerateJobData = z.infer<typeof GenerateJobDataSchema>;

/**
 * Job result schema (returned by GPU workers)
 */
export const GenerateJobResultSchema = z.object({
  success: z.boolean(),
  url: z.string().url().optional(),
  contentType: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  durationMs: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  processingTimeMs: z.number().optional(),
  error: z.string().optional()
});

export type IGenerateJobResult = z.infer<typeof GenerateJobResultSchema>;
