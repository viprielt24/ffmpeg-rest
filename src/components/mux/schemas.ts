import { createRoute, z } from '@hono/zod-openapi';

/**
 * Mux request body schema - combines video and audio from URLs
 */
export const MuxRequestSchema = z.object({
  videoUrl: z.string().url().openapi({
    description: 'URL to the video file',
    example: 'https://example.com/video.mp4'
  }),
  audioUrl: z.string().url().openapi({
    description: 'URL to the audio file',
    example: 'https://example.com/audio.mp3'
  }),
  duration: z.number().positive().optional().openapi({
    description: 'Optional: trim output to this duration in seconds',
    example: 30
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'Optional: URL to call when processing completes',
    example: 'https://example.com/webhook'
  })
});

export type IMuxRequest = z.infer<typeof MuxRequestSchema>;

/**
 * Job queued response schema
 */
export const JobQueuedResponseSchema = z.object({
  success: z.literal(true),
  jobId: z.string().openapi({
    description: 'Unique job identifier for polling status',
    example: 'job_abc123'
  }),
  status: z.literal('queued'),
  message: z.string().openapi({
    description: 'Human-readable status message',
    example: 'Job queued successfully. Poll GET /jobs/:jobId for status.'
  })
});

/**
 * Job status response schema
 */
export const JobStatusResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('queued'),
    jobId: z.string(),
    progress: z.number().min(0).max(100).optional()
  }),
  z.object({
    status: z.literal('active'),
    jobId: z.string(),
    progress: z.number().min(0).max(100)
  }),
  z.object({
    status: z.literal('completed'),
    jobId: z.string(),
    result: z.object({
      url: z.string().url(),
      fileSizeBytes: z.number(),
      processingTimeMs: z.number()
    })
  }),
  z.object({
    status: z.literal('failed'),
    jobId: z.string(),
    error: z.string()
  })
]);

export type IJobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

/**
 * Error response schema
 */
export const ErrorResponseSchema = z.object({
  error: z.string().openapi({
    description: 'Error message',
    example: 'Invalid video URL'
  }),
  message: z.string().optional().openapi({
    description: 'Additional details about the error'
  })
});

/**
 * POST /mux - Combine video and audio tracks
 */
export const muxRoute = createRoute({
  method: 'post',
  path: '/mux',
  tags: ['Mux'],
  summary: 'Combine video and audio tracks',
  description: 'Accepts video and audio URLs, queues a job to mux them together, and returns a job ID for polling.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: MuxRequestSchema
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
      description: 'Invalid request parameters'
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

/**
 * GET /jobs/:jobId - Get job status
 */
export const jobStatusRoute = createRoute({
  method: 'get',
  path: '/jobs/{jobId}',
  tags: ['Jobs'],
  summary: 'Get job status',
  description: 'Poll for the status of a queued job. Returns progress, completion status, or error.',
  request: {
    params: z.object({
      jobId: z.string().openapi({
        description: 'Job ID returned from mux or concatenate endpoint',
        example: 'job_abc123'
      })
    })
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: JobStatusResponseSchema
        }
      },
      description: 'Job status retrieved successfully'
    },
    404: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      },
      description: 'Job not found'
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
