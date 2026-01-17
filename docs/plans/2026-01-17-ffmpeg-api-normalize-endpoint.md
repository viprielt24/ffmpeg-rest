# FFmpeg API - Add Normalize Endpoint

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/normalize` endpoint to the FFmpeg API service that re-encodes videos to standardized parameters.

**Architecture:** New POST endpoint using Hono OpenAPI, queues normalize jobs to BullMQ, processed by worker, results uploaded to Cloudflare R2.

**Tech Stack:** TypeScript, Hono (OpenAPIHono), BullMQ, Redis, FFmpeg, Cloudflare R2

**Working Directory:** `ffmpeg-backend/`

---

## API Specification

**Endpoint:** `POST /normalize`

**Request Body:**
```json
{
  "videoUrl": "string (required)",
  "webhookUrl": "string (optional)",
  "width": "number (default: 1080)",
  "height": "number (default: 1920)",
  "fps": "number (default: 30)",
  "videoBitrate": "string (optional, e.g. '5M' - overrides CRF if set)",
  "crf": "number (default: 23, ignored if videoBitrate set)",
  "preset": "string (default: 'fast', one of: ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)",
  "audioBitrate": "string (optional, e.g. '192k')",
  "audioSampleRate": "number (default: 48000)",
  "audioChannels": "number (default: 2, range: 1-2)",
  "duration": "number (optional, trims to this duration in seconds)"
}
```

**Response:** `202 Accepted`
```json
{
  "success": true,
  "jobId": "abc123",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}
```

**Result URL format:** `{S3_PUBLIC_URL}/normalized-{jobId}.mp4`

---

## File Structure

**Files to CREATE:**
```
src/components/normalize/
├── controller.ts     # Route handler (registerNormalizeRoutes)
└── schemas.ts        # Zod schemas + OpenAPI route definition

src/queue/normalize/
├── processor.ts      # Job processing logic (processNormalizeVideo)
└── schemas.ts        # Job data schema (INormalizeVideoJobData)
```

**Files to MODIFY:**
```
src/app.ts           # Register route: registerNormalizeRoutes(app)
src/queue/index.ts   # Add JobType.NORMALIZE_VIDEO
src/worker.ts        # Add case for NORMALIZE_VIDEO processor
```

---

## Task 1: Add Job Type to Queue Index

**Files:**
- Modify: `src/queue/index.ts`

**Step 1: Add NORMALIZE_VIDEO to JobType**

Find the `JobType` object and add the new job type:

```typescript
export const JobType = {
  AUDIO_TO_MP3: 'audio:mp3',
  AUDIO_TO_WAV: 'audio:wav',
  VIDEO_TO_MP4: 'video:mp4',
  VIDEO_EXTRACT_AUDIO: 'video:audio',
  VIDEO_EXTRACT_FRAMES: 'video:frames',
  IMAGE_TO_JPG: 'image:jpg',
  IMAGE_RESIZE: 'image:resize',
  MEDIA_PROBE: 'media:info',
  MUX_VIDEO_AUDIO: 'mux:video-audio',
  CONCATENATE_VIDEOS: 'concatenate:videos',
  NORMALIZE_VIDEO: 'normalize:video'
} as const;
```

**Step 2: Commit**

```bash
git add src/queue/index.ts
git commit -m "feat(queue): add NORMALIZE_VIDEO job type"
```

---

## Task 2: Create Queue Schema

**Files:**
- Create: `src/queue/normalize/schemas.ts`

**Step 1: Create the file with full content**

```typescript
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
```

**Step 2: Commit**

```bash
git add src/queue/normalize/schemas.ts
git commit -m "feat(queue): add normalize job data schema"
```

---

## Task 3: Create Job Processor

**Files:**
- Create: `src/queue/normalize/processor.ts`

**Step 1: Create the file with full content**

```typescript
import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { INormalizeVideoJobData } from './schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, writeFile } from 'fs/promises';
import { statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { env } from '~/config/env';
import { uploadToS3 } from '~/utils/storage';
import { logger } from '~/config/logger';

const execFileAsync = promisify(execFile);

const PROCESSING_TIMEOUT = 600000; // 10 minutes
const DOWNLOAD_TIMEOUT = 300000; // 5 minutes

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(outputPath, buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function processNormalizeVideo(job: Job<INormalizeVideoJobData>): Promise<JobResult> {
  const {
    videoUrl,
    width,
    height,
    fps,
    videoBitrate,
    crf,
    preset,
    audioBitrate,
    audioSampleRate,
    audioChannels,
    duration
  } = job.data;
  const jobId = job.id ?? randomUUID();

  const jobDir = join(env.TEMP_DIR, `normalize-${jobId}`);
  const inputPath = join(jobDir, 'input.mp4');
  const outputPath = join(jobDir, 'output.mp4');

  const startTime = Date.now();

  try {
    await mkdir(jobDir, { recursive: true });

    // Download input
    logger.info({ jobId, videoUrl }, 'Downloading input video');
    await job.updateProgress(5);
    await downloadFile(videoUrl, inputPath);
    await job.updateProgress(20);

    logger.info({ jobId, width, height, fps, preset }, 'Starting FFmpeg normalize');

    // Build FFmpeg args
    const ffmpegArgs = [
      '-y',
      '-i', inputPath,
      // Video filter: scale + pad (letterbox/pillarbox) + fps
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      // Video codec
      '-c:v', 'libx264',
      '-preset', preset,
      '-pix_fmt', 'yuv420p'
    ];

    // Video quality: bitrate OR crf (bitrate takes priority)
    if (videoBitrate) {
      ffmpegArgs.push('-b:v', videoBitrate);
    } else {
      ffmpegArgs.push('-crf', crf.toString());
    }

    // Audio codec
    ffmpegArgs.push(
      '-c:a', 'aac',
      '-ar', audioSampleRate.toString(),
      '-ac', audioChannels.toString()
    );

    // Audio bitrate (optional)
    if (audioBitrate) {
      ffmpegArgs.push('-b:a', audioBitrate);
    }

    // Duration trim (optional)
    if (duration !== undefined) {
      ffmpegArgs.push('-t', duration.toString());
    }

    // Output optimizations
    ffmpegArgs.push(
      '-movflags', '+faststart',
      outputPath
    );

    // Run FFmpeg
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: PROCESSING_TIMEOUT });

    await job.updateProgress(90);
    logger.info({ jobId }, 'FFmpeg normalize completed, uploading to S3');

    // Get file size
    const stats = statSync(outputPath);
    const fileSizeBytes = stats.size;

    // Upload to S3
    const { url: outputUrl } = await uploadToS3(outputPath, 'video/mp4', `normalized-${jobId}.mp4`);

    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    logger.info({ jobId, outputUrl, fileSizeBytes, processingTimeMs }, 'Normalize job completed');

    return {
      success: true,
      outputUrl,
      metadata: {
        fileSizeBytes,
        processingTimeMs
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, error: errorMessage }, 'Normalize job failed');
    return {
      success: false,
      error: `Normalize failed: ${errorMessage}`
    };
  } finally {
    // Cleanup temp files
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
```

**Step 2: Commit**

```bash
git add src/queue/normalize/processor.ts
git commit -m "feat(queue): add normalize video processor"
```

---

## Task 4: Create Component Schema

**Files:**
- Create: `src/components/normalize/schemas.ts`

**Step 1: Create the file with full content**

```typescript
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
  preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
    .default('fast').openapi({
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
  description: 'Re-encodes video to specified resolution, frame rate, and codec settings. Returns a job ID for polling.',
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
```

**Step 2: Commit**

```bash
git add src/components/normalize/schemas.ts
git commit -m "feat(components): add normalize request schema and route"
```

---

## Task 5: Create Component Controller

**Files:**
- Create: `src/components/normalize/controller.ts`

**Step 1: Create the file with full content**

```typescript
import type { OpenAPIHono } from '@hono/zod-openapi';
import { normalizeRoute } from './schemas';
import { queue, JobType } from '~/queue';
import { logger } from '~/config/logger';
import { env } from '~/config/env';

export function registerNormalizeRoutes(app: OpenAPIHono) {
  app.openapi(normalizeRoute, async (c) => {
    try {
      const body = c.req.valid('json');

      // Validate S3 mode is enabled for URL-based processing
      if (env.STORAGE_MODE !== 's3') {
        return c.json(
          {
            error: 'S3 mode required',
            message: 'URL-based normalize requires STORAGE_MODE=s3 to be configured'
          },
          400
        );
      }

      logger.info(
        { videoUrl: body.videoUrl, width: body.width, height: body.height, fps: body.fps },
        'Queueing normalize job'
      );

      const job = await queue.add(JobType.NORMALIZE_VIDEO, {
        type: 'normalize',
        videoUrl: body.videoUrl,
        webhookUrl: body.webhookUrl,
        width: body.width,
        height: body.height,
        fps: body.fps,
        videoBitrate: body.videoBitrate,
        crf: body.crf,
        preset: body.preset,
        audioBitrate: body.audioBitrate,
        audioSampleRate: body.audioSampleRate,
        audioChannels: body.audioChannels,
        duration: body.duration
      });

      logger.info({ jobId: job.id }, 'Normalize job queued');

      return c.json(
        {
          success: true as const,
          jobId: job.id ?? '',
          status: 'queued' as const,
          message: 'Job queued successfully. Poll GET /jobs/:jobId for status.'
        },
        202
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Failed to queue normalize job');
      return c.json({ error: 'Failed to queue job', message: errorMessage }, 500);
    }
  });
}
```

**Step 2: Commit**

```bash
git add src/components/normalize/controller.ts
git commit -m "feat(components): add normalize controller"
```

---

## Task 6: Register Route in App

**Files:**
- Modify: `src/app.ts`

**Step 1: Add import for normalize controller**

Find the controller imports and add:

```typescript
import { registerNormalizeRoutes } from '~/components/normalize/controller';
```

**Step 2: Register the route**

Find where routes are registered (after `registerMuxRoutes(app)`) and add:

```typescript
registerNormalizeRoutes(app);
```

**Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): register normalize routes"
```

---

## Task 7: Register Processor in Worker

**Files:**
- Modify: `src/worker.ts`

**Step 1: Add import for normalize processor**

Find the processor imports and add:

```typescript
import { processNormalizeVideo } from '~/queue/normalize/processor';
```

**Step 2: Add case in switch statement**

Find the switch statement in the worker and add before `default`:

```typescript
case JobType.NORMALIZE_VIDEO:
  return processNormalizeVideo(job as never);
```

**Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat(worker): add normalize video processor"
```

---

## Task 8: Build and Test

**Step 1: Build TypeScript**

```bash
npm run build
```

Expected: No errors, `dist/` folder updated.

**Step 2: Run tests (if applicable)**

```bash
npm test
```

**Step 3: Test locally (optional)**

If you have Redis running locally:

```bash
npm run dev
```

Test health endpoint:
```bash
curl http://localhost:3000/health
```

**Step 4: Commit build changes if any**

```bash
git add .
git commit -m "chore: build for deployment"
```

**Step 5: Push to GitHub**

```bash
git push origin main
```

---

## Task 9: Deploy and Verify

**Step 1: Verify deployment health**

```bash
curl https://ffmpeg-rest-production-850b.up.railway.app/health
```

**Step 2: Test normalize endpoint**

```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/normalize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "videoUrl": "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration": 5
  }'
```

Expected response:
```json
{
  "success": true,
  "jobId": "1",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}
```

**Step 3: Poll for job completion**

```bash
curl https://ffmpeg-rest-production-850b.up.railway.app/jobs/JOB_ID \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

**Step 4: Verify OpenAPI documentation**

Visit `/reference` to confirm the normalize endpoint appears in the API documentation.

---

## Summary

**Files created (4):**
- `src/components/normalize/schemas.ts` - Request schema + OpenAPI route
- `src/components/normalize/controller.ts` - Route handler
- `src/queue/normalize/schemas.ts` - Job data schema
- `src/queue/normalize/processor.ts` - FFmpeg processing logic

**Files modified (3):**
- `src/queue/index.ts` - Added `NORMALIZE_VIDEO` job type
- `src/app.ts` - Registered normalize routes
- `src/worker.ts` - Added processor case

**Commits:**
1. `feat(queue): add NORMALIZE_VIDEO job type`
2. `feat(queue): add normalize job data schema`
3. `feat(queue): add normalize video processor`
4. `feat(components): add normalize request schema and route`
5. `feat(components): add normalize controller`
6. `feat(app): register normalize routes`
7. `feat(worker): add normalize video processor`
8. `chore: build for deployment`
