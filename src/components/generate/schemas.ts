import { createRoute, z } from '@hono/zod-openapi';

// ========== Model Enum ==========
export const GenerateModelSchema = z.enum(['wav2lip', 'zimage', 'infinitetalk']).openapi({
  description: 'AI model to use for generation',
  example: 'infinitetalk'
});

export type GenerateModel = z.infer<typeof GenerateModelSchema>;

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

// ========== InfiniteTalk Request Schema (Audio-Driven Video) ==========
export const InfiniteTalkRequestSchema = z.object({
  model: z.literal('infinitetalk'),
  audioUrl: z.string().url().openapi({
    description: 'URL to the audio file for driving the video',
    example: 'https://example.com/speech.wav'
  }),
  imageUrl: z.string().url().optional().openapi({
    description: 'URL to reference image (use either imageUrl or videoUrl, not both)',
    example: 'https://example.com/portrait.jpg'
  }),
  videoUrl: z.string().url().optional().openapi({
    description: 'URL to reference video (use either imageUrl or videoUrl, not both)',
    example: 'https://example.com/reference.mp4'
  }),
  resolution: z.enum(['480', '720']).default('720').optional().openapi({
    description: 'Output resolution (480 or 720)',
    example: '720'
  }),
  aspectRatio: z.enum(['16:9', '9:16']).default('9:16').optional().openapi({
    description: 'Output aspect ratio (16:9 horizontal or 9:16 vertical)',
    example: '9:16'
  }),
  provider: z.enum(['wavespeed', 'runpod']).default('wavespeed').optional().openapi({
    description: 'Provider to use (wavespeed or runpod)',
    example: 'wavespeed'
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'URL to call when processing completes'
  })
});

export type IInfiniteTalkRequest = z.infer<typeof InfiniteTalkRequestSchema>;

// ========== Bulk InfiniteTalk Request Schema ==========
export const BulkInfiniteTalkJobSchema = z.object({
  audioUrl: z.string().url().openapi({
    description: 'URL to the audio file for driving the video',
    example: 'https://example.com/speech.wav'
  }),
  imageUrl: z.string().url().optional().openapi({
    description: 'URL to reference image (use either imageUrl or videoUrl, not both)',
    example: 'https://example.com/portrait.jpg'
  }),
  videoUrl: z.string().url().optional().openapi({
    description: 'URL to reference video (use either imageUrl or videoUrl, not both)',
    example: 'https://example.com/reference.mp4'
  }),
  resolution: z.enum(['480', '720']).default('720').optional().openapi({
    description: 'Output resolution (480 or 720)',
    example: '720'
  }),
  aspectRatio: z.enum(['16:9', '9:16']).default('9:16').optional().openapi({
    description: 'Output aspect ratio (16:9 horizontal or 9:16 vertical)',
    example: '9:16'
  })
});

export type IBulkInfiniteTalkJob = z.infer<typeof BulkInfiniteTalkJobSchema>;

export const BulkInfiniteTalkRequestSchema = z.object({
  jobs: z.array(BulkInfiniteTalkJobSchema).min(1).max(50).openapi({
    description: 'Array of InfiniteTalk jobs to process (1-50 jobs)'
  }),
  provider: z.enum(['wavespeed', 'runpod']).default('wavespeed').optional().openapi({
    description: 'Provider to use (wavespeed or runpod)',
    example: 'wavespeed'
  }),
  webhookUrl: z.string().url().optional().openapi({
    description: 'URL to call when ALL jobs complete'
  })
});

export type IBulkInfiniteTalkRequest = z.infer<typeof BulkInfiniteTalkRequestSchema>;

// ========== Bulk Response Schemas ==========
export const BulkJobStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed'])
});

export const BulkGenerateResponseSchema = z.object({
  success: z.literal(true),
  batchId: z.string().openapi({
    description: 'Unique batch identifier',
    example: 'batch_abc123def456'
  }),
  model: z.literal('infinitetalk').openapi({
    description: 'Model used for this batch'
  }),
  totalJobs: z.number(),
  jobs: z.array(BulkJobStatusSchema),
  message: z.string()
});

export type IBulkGenerateResponse = z.infer<typeof BulkGenerateResponseSchema>;

// ========== Batch Status Response Schemas ==========
export const BatchJobResultSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  result: z
    .object({
      url: z.string().url(),
      fileSizeBytes: z.number(),
      processingTimeMs: z.number()
    })
    .optional(),
  error: z.string().optional()
});

export const BatchStatusResponseSchema = z.discriminatedUnion('status', [
  // Pending (no jobs started)
  z.object({
    status: z.literal('pending'),
    batchId: z.string(),
    model: z.literal('infinitetalk'),
    totalJobs: z.number(),
    completedJobs: z.literal(0),
    failedJobs: z.literal(0),
    results: z.array(BatchJobResultSchema),
    createdAt: z.string().datetime()
  }),
  // Processing (some jobs in progress)
  z.object({
    status: z.literal('processing'),
    batchId: z.string(),
    model: z.literal('infinitetalk'),
    totalJobs: z.number(),
    completedJobs: z.number(),
    failedJobs: z.number(),
    results: z.array(BatchJobResultSchema),
    createdAt: z.string().datetime()
  }),
  // Completed (all jobs succeeded)
  z.object({
    status: z.literal('completed'),
    batchId: z.string(),
    model: z.literal('infinitetalk'),
    totalJobs: z.number(),
    completedJobs: z.number(),
    failedJobs: z.literal(0),
    results: z.array(BatchJobResultSchema),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime()
  }),
  // Partial failure (some jobs failed)
  z.object({
    status: z.literal('partial_failure'),
    batchId: z.string(),
    model: z.literal('infinitetalk'),
    totalJobs: z.number(),
    completedJobs: z.number(),
    failedJobs: z.number(),
    results: z.array(BatchJobResultSchema),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime()
  })
]);

export type IBatchStatusResponse = z.infer<typeof BatchStatusResponseSchema>;

// ========== Discriminated Union for Request ==========
export const GenerateRequestSchema = z.discriminatedUnion('model', [
  Wav2LipRequestSchema,
  ZImageRequestSchema,
  InfiniteTalkRequestSchema
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
    'Queue an AI generation job. Supports InfiniteTalk (audio-driven video), Wav2Lip (lip-sync), and Z-Image (text-to-image). Jobs are processed by external GPU workers.',
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
 * POST /api/v1/generate/bulk/infinitetalk - Submit bulk InfiniteTalk jobs
 */
export const bulkInfiniteTalkRoute = createRoute({
  method: 'post',
  path: '/api/v1/generate/bulk/infinitetalk',
  tags: ['Generate', 'Bulk'],
  summary: 'Submit bulk InfiniteTalk jobs',
  description:
    'Queue multiple InfiniteTalk audio-driven video jobs for parallel processing. Returns a batch ID to poll for status. A single webhook is sent when ALL jobs complete.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkInfiniteTalkRequestSchema
        }
      },
      required: true
    }
  },
  responses: {
    202: {
      content: {
        'application/json': {
          schema: BulkGenerateResponseSchema
        }
      },
      description: 'Batch queued successfully'
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
 * GET /api/v1/generate/bulk/:batchId - Get batch status
 */
export const getBatchStatusRoute = createRoute({
  method: 'get',
  path: '/api/v1/generate/bulk/{batchId}',
  tags: ['Generate', 'Bulk'],
  summary: 'Get batch status',
  description:
    'Poll for status of a bulk generation batch. Returns status of all jobs and sends webhook when complete.',
  request: {
    params: z.object({
      batchId: z.string().openapi({
        description: 'Batch ID from bulk endpoint',
        example: 'batch_abc123def456'
      })
    })
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: BatchStatusResponseSchema
        }
      },
      description: 'Batch status retrieved'
    },
    404: {
      content: {
        'application/json': {
          schema: GenerateErrorSchema
        }
      },
      description: 'Batch not found'
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
