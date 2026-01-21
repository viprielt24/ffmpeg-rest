import { createRoute, z } from '@hono/zod-openapi';

// ========== Model Enum ==========
export const GenerateModelSchema = z.enum(['ltx2', 'wav2lip', 'zimage']).openapi({
  description: 'AI model to use for generation',
  example: 'ltx2'
});

export type GenerateModel = z.infer<typeof GenerateModelSchema>;

// ========== LTX-2 Request Schema (Image-to-Video) ==========
export const LTX2RequestSchema = z.object({
  model: z.literal('ltx2'),
  imageUrl: z.string().url().openapi({
    description: 'URL to the source image',
    example: 'https://example.com/input.jpg'
  }),
  prompt: z.string().max(500).optional().openapi({
    description: 'Text prompt for video generation',
    example: 'A cinematic video of the scene coming to life'
  }),
  duration: z.number().int().min(3).max(10).default(5).openapi({
    description: 'Video duration in seconds (3-10)',
    example: 5
  }),
  width: z.number().int().min(512).max(1920).default(1024).optional().openapi({
    description: 'Output width (512-1920)',
    example: 1024
  }),
  height: z.number().int().min(512).max(1080).default(576).optional().openapi({
    description: 'Output height (512-1080)',
    example: 576
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'URL to call when processing completes'
  })
});

export type ILTX2Request = z.infer<typeof LTX2RequestSchema>;

// ========== Wav2Lip Request Schema (Lip-Sync) ==========
export const Wav2LipRequestSchema = z.object({
  model: z.literal('wav2lip'),
  videoUrl: z.string().url().openapi({
    description: 'URL to the source video with face',
    example: 'https://example.com/face-video.mp4'
  }),
  audioUrl: z.string().url().openapi({
    description: 'URL to the audio for lip-sync',
    example: 'https://example.com/speech.wav'
  }),
  padTop: z.number().int().min(0).max(50).default(0).optional().openapi({
    description: 'Padding above mouth region (0-50)',
    example: 0
  }),
  padBottom: z.number().int().min(0).max(50).default(10).optional().openapi({
    description: 'Padding below mouth region (0-50)',
    example: 10
  }),
  padLeft: z.number().int().min(0).max(50).default(0).optional().openapi({
    description: 'Padding left of mouth region (0-50)',
    example: 0
  }),
  padRight: z.number().int().min(0).max(50).default(0).optional().openapi({
    description: 'Padding right of mouth region (0-50)',
    example: 0
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'URL to call when processing completes'
  })
});

export type IWav2LipRequest = z.infer<typeof Wav2LipRequestSchema>;

// ========== Z-Image Request Schema (Text-to-Image) ==========
export const ZImageRequestSchema = z.object({
  model: z.literal('zimage'),
  prompt: z.string().min(1).max(1000).openapi({
    description: 'Text prompt for image generation (supports English and Chinese)',
    example: 'A photorealistic portrait of a businesswoman in an office'
  }),
  negativePrompt: z.string().max(500).optional().openapi({
    description: 'Negative prompt to avoid certain features',
    example: 'blurry, low quality, distorted'
  }),
  width: z.number().int().min(512).max(2048).default(1024).optional().openapi({
    description: 'Output width (512-2048)',
    example: 1024
  }),
  height: z.number().int().min(512).max(2048).default(1024).optional().openapi({
    description: 'Output height (512-2048)',
    example: 1024
  }),
  steps: z.number().int().min(8).max(100).default(30).optional().openapi({
    description: 'Number of inference steps (8-100, use 8-9 for Turbo variant)',
    example: 9
  }),
  guidanceScale: z.number().min(0).max(20).default(0).optional().openapi({
    description: 'Guidance scale (0 for Turbo variant, 1-20 for Base)',
    example: 0
  }),
  seed: z.number().int().optional().openapi({
    description: 'Random seed for reproducibility'
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'URL to call when processing completes'
  })
});

export type IZImageRequest = z.infer<typeof ZImageRequestSchema>;

// ========== Discriminated Union for Request ==========
export const GenerateRequestSchema = z.discriminatedUnion('model', [
  LTX2RequestSchema,
  Wav2LipRequestSchema,
  ZImageRequestSchema
]);

export type IGenerateRequest = z.infer<typeof GenerateRequestSchema>;

// ========== Response Schemas ==========
export const GenerateJobQueuedResponseSchema = z.object({
  success: z.literal(true),
  jobId: z.string().openapi({
    description: 'Unique job identifier',
    example: 'gen_abc123'
  }),
  model: GenerateModelSchema,
  status: z.literal('queued'),
  message: z.string().openapi({
    example: 'Job queued. Poll GET /api/v1/generate/{jobId} for status.'
  })
});

export const GenerateJobStatusSchema = z.discriminatedUnion('status', [
  // Queued
  z.object({
    status: z.literal('queued'),
    jobId: z.string(),
    model: GenerateModelSchema,
    position: z.number().optional().openapi({
      description: 'Position in queue'
    }),
    createdAt: z.string().datetime()
  }),
  // Processing
  z.object({
    status: z.literal('processing'),
    jobId: z.string(),
    model: GenerateModelSchema,
    progress: z.number().min(0).max(100),
    startedAt: z.string().datetime(),
    createdAt: z.string().datetime()
  }),
  // Completed
  z.object({
    status: z.literal('completed'),
    jobId: z.string(),
    model: GenerateModelSchema,
    result: z.object({
      url: z.string().url().openapi({
        description: 'URL to generated output (video or image)'
      }),
      contentType: z.string().openapi({
        example: 'video/mp4'
      }),
      fileSizeBytes: z.number(),
      durationMs: z.number().optional().openapi({
        description: 'Video duration in ms (for video outputs)'
      }),
      width: z.number(),
      height: z.number()
    }),
    processingTimeMs: z.number(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime()
  }),
  // Failed
  z.object({
    status: z.literal('failed'),
    jobId: z.string(),
    model: GenerateModelSchema,
    error: z.string(),
    createdAt: z.string().datetime(),
    failedAt: z.string().datetime()
  })
]);

export type IGenerateJobStatus = z.infer<typeof GenerateJobStatusSchema>;

// ========== Error Response ==========
export const GenerateErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional().openapi({
    description: 'Error code for programmatic handling',
    example: 'INVALID_MODEL'
  }),
  details: z.record(z.string(), z.unknown()).optional()
});

// ========== Webhook Callback Schema (from GPU worker) ==========
export const WebhookCallbackSchema = z.object({
  jobId: z.string(),
  status: z.enum(['completed', 'failed']),
  result: z
    .object({
      url: z.string().url(),
      contentType: z.string(),
      fileSizeBytes: z.number(),
      durationMs: z.number().optional(),
      width: z.number(),
      height: z.number()
    })
    .optional(),
  error: z.string().optional(),
  processingTimeMs: z.number().optional(),
  timestamp: z.string().datetime()
});

export type IWebhookCallback = z.infer<typeof WebhookCallbackSchema>;

// ========== Route Definitions ==========

/**
 * POST /api/v1/generate - Create AI generation job
 */
export const generateRoute = createRoute({
  method: 'post',
  path: '/api/v1/generate',
  tags: ['Generate'],
  summary: 'Create AI generation job',
  description:
    'Queue an AI generation job. Supports LTX-2 (image-to-video), Wav2Lip (lip-sync), and Z-Image (text-to-image). Jobs are processed by external GPU workers.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: GenerateRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    202: {
      content: {
        'application/json': {
          schema: GenerateJobQueuedResponseSchema
        }
      },
      description: 'Job queued successfully'
    },
    400: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Invalid request parameters'
    },
    401: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Unauthorized'
    },
    500: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Internal server error'
    }
  }
});

/**
 * GET /api/v1/generate/:jobId - Get job status
 */
export const getGenerateStatusRoute = createRoute({
  method: 'get',
  path: '/api/v1/generate/{jobId}',
  tags: ['Generate'],
  summary: 'Get generation job status',
  description: 'Poll for status of an AI generation job',
  request: {
    params: z.object({
      jobId: z.string().openapi({
        description: 'Job ID from generate endpoint',
        example: 'gen_abc123'
      })
    })
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: GenerateJobStatusSchema
        }
      },
      description: 'Job status retrieved'
    },
    404: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Job not found'
    },
    401: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Unauthorized'
    }
  }
});

/**
 * POST /webhooks/generate/complete - GPU worker callback
 */
export const webhookCompleteRoute = createRoute({
  method: 'post',
  path: '/webhooks/generate/complete',
  tags: ['Webhooks'],
  summary: 'GPU worker completion callback',
  description: 'Called by GPU workers when job completes or fails. Requires X-Webhook-Secret header.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: WebhookCallbackSchema
        }
      },
      required: true
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ received: z.literal(true) })
        }
      },
      description: 'Webhook processed'
    },
    401: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Invalid webhook secret'
    },
    404: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Job not found'
    }
  }
});
