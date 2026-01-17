import { createRoute, z } from '@hono/zod-openapi';
import { JobQueuedResponseSchema, ErrorResponseSchema } from '../mux/schemas';

/**
 * Normalize request body schema - re-encode video to standard parameters
 */
export const NormalizeRequestSchema = z.object({
  videoUrl: z.string().url().openapi({
    description: 'URL to the video file to normalize',
    example: 'https://example.com/video.mp4'
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'Optional: URL to call when processing completes',
    example: 'https://example.com/webhook'
  }),
  width: z.number().int().positive().default(1080).openapi({
    description: 'Output width in pixels',
    example: 1080
  }),
  height: z.number().int().positive().default(1920).openapi({
    description: 'Output height in pixels',
    example: 1920
  }),
  fps: z.number().int().positive().default(30).openapi({
    description: 'Output frame rate',
    example: 30
  }),
  videoBitrate: z.string().optional().openapi({
    description: 'Video bitrate (e.g. "5M"). If set, overrides CRF.',
    example: '5M'
  }),
  crf: z.number().int().min(0).max(51).default(23).openapi({
    description: 'Constant Rate Factor (0-51, lower = better quality). Ignored if videoBitrate is set.',
    example: 23
  }),
  preset: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    .default('fast')
    .openapi({
      description: 'x264 encoding preset (faster = larger file, slower = smaller file)',
      example: 'fast'
    }),
  audioBitrate: z.string().optional().openapi({
    description: 'Audio bitrate (e.g. "192k"). Defaults to encoder default (~128k).',
    example: '192k'
  }),
  audioSampleRate: z.number().int().positive().default(48000).openapi({
    description: 'Audio sample rate in Hz',
    example: 48000
  }),
  audioChannels: z.number().int().min(1).max(2).default(2).openapi({
    description: 'Audio channels: 1 (mono) or 2 (stereo)',
    example: 2
  }),
  duration: z.number().positive().optional().openapi({
    description: 'Optional: trim output to this duration in seconds',
    example: 30
  })
});

export type INormalizeRequest = z.infer<typeof NormalizeRequestSchema>;

/**
 * POST /normalize - Normalize video to standard parameters
 */
export const normalizeRoute = createRoute({
  method: 'post',
  path: '/normalize',
  tags: ['Normalize'],
  summary: 'Normalize video to standard parameters',
  description:
    'Re-encodes video to specified resolution, frame rate, and codec settings. Returns a job ID for polling.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: NormalizeRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    202: {
      content: {
        'application/json': {
          schema: JobQueuedResponseSchema
        }
      },
      description: 'Job queued successfully'
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Invalid request or S3 mode not configured'
    },
    401: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Unauthorized - missing or invalid auth token'
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Internal server error'
    }
  }
});
