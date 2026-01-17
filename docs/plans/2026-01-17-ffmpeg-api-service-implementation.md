# FFmpeg API Service Implementation Plan (Updated)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a scalable, self-hosted FFmpeg API service with async job queuing for production multi-customer usage.

**Approach:** Fork the existing [crisog/ffmpeg-rest](https://github.com/crisog/ffmpeg-rest) Railway template and extend it with custom `/mux` and `/concatenate` endpoints.

**Why Fork Template:**
- Already has BullMQ async job queue working
- S3 storage with deduplication (SHA-256 hashing)
- Zod + OpenAPI auto-documentation
- Hono framework (faster than Express, same API style)
- Proven in production (21 active Railway deployments)
- Reduces implementation effort significantly

**Tech Stack:** TypeScript, Node.js 20, Hono, Zod, BullMQ, Redis, FFmpeg 6.x, Docker, Railway, Cloudflare R2

---

## Architecture Overview

```
Client Request (POST /mux, /concatenate)
        │
        ▼
┌──────────────────┐
│  Hono API Server │ ──→ Returns jobId immediately (202 Accepted)
└──────────────────┘
        │
        ▼ (adds to queue)
┌──────────────────┐
│     Redis        │ ← Job Queue (BullMQ)
└──────────────────┘
        │
        ▼ (workers pull jobs)
┌──────────────────┐
│  FFmpeg Worker   │ ──→ Download → Process → Upload
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Cloudflare R2   │ ← Store processed video (with deduplication)
└──────────────────┘
        │
        ▼
   Webhook callback (optional)
   or client polls GET /jobs/:id
```

## Prerequisites

Before starting, ensure you have:
- Node.js 20+ installed
- Docker Desktop installed and running
- GitHub account
- Railway account (https://railway.app)
- Cloudflare account with R2 enabled

---

## Task 1: Fork and Clone Template

**Goal:** Get the base template running locally.

**Step 1: Fork the repository**
```bash
# Fork on GitHub: https://github.com/crisog/ffmpeg-rest
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/ffmpeg-rest.git ffmpeg-api
cd ffmpeg-api
```

**Step 2: Install dependencies**
```bash
npm install
```

**Step 3: Set up local environment**
```bash
cp .env.example .env
# Edit .env with your local settings
```

**Step 4: Start Redis locally**
```bash
docker-compose up -d
```

**Step 5: Verify template works**
```bash
# Terminal 1: Start API
npm run dev

# Terminal 2: Start worker
npm run dev:worker

# Terminal 3: Test health endpoint
curl http://localhost:3000/health
```

**Step 6: Commit baseline**
```bash
git add .
git commit -m "chore: baseline from ffmpeg-rest template"
```

---

## Task 2: Add API Key Authentication

**Files:**
- Create: `src/middleware/auth.ts`
- Modify: `src/index.ts`

**Step 1: Create auth middleware**

```typescript
// src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'crypto';

export const authMiddleware = createMiddleware(async (c, next) => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error('API_KEY environment variable not set');
    throw new HTTPException(500, { message: 'Server configuration error' });
  }

  const authHeader = c.req.header('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);

  // Constant-time comparison to prevent timing attacks
  try {
    const tokenBuffer = Buffer.from(token);
    const keyBuffer = Buffer.from(apiKey);

    if (tokenBuffer.length !== keyBuffer.length || !timingSafeEqual(tokenBuffer, keyBuffer)) {
      throw new HTTPException(403, { message: 'Invalid API key' });
    }
  } catch {
    throw new HTTPException(403, { message: 'Invalid API key' });
  }

  await next();
});
```

**Step 2: Add API_KEY to .env.example**
```
# Authentication
API_KEY=your-secret-api-key-here
```

**Step 3: Write auth tests**

```typescript
// tests/auth.test.ts
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

describe('Authentication', () => {
  it('returns 401 without auth header', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 with invalid API key', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-key',
      },
    });
    expect(res.status).toBe(403);
  });

  it('allows request with valid API key', async () => {
    const res = await app.request('/health');
    // Health should work without auth
    expect(res.status).toBe(200);
  });
});
```

**Step 4: Apply middleware to routes in index.ts**
```typescript
import { authMiddleware } from './middleware/auth';

// Public routes
app.get('/health', healthRoute);
app.get('/doc', docRoute);
app.get('/reference', referenceRoute);

// Protected routes
app.use('/mux/*', authMiddleware);
app.use('/concatenate/*', authMiddleware);
app.use('/jobs/*', authMiddleware);
```

**Step 5: Commit**
```bash
git add .
git commit -m "feat: add API key authentication middleware"
```

---

## Task 3: Create Mux Endpoint Schema

**Files:**
- Create: `src/schemas/mux.ts`
- Create: `src/types/mux.ts`

**Step 1: Create Zod schema**

```typescript
// src/schemas/mux.ts
import { z } from 'zod';

export const muxRequestSchema = z.object({
  videoUrl: z.string().url('videoUrl must be a valid URL'),
  audioUrl: z.string().url('audioUrl must be a valid URL'),
  duration: z.number().positive().optional(),
  webhookUrl: z.string().url().optional(),
});

export const muxResponseSchema = z.object({
  success: z.literal(true),
  jobId: z.string(),
  status: z.literal('queued'),
  message: z.string(),
});

export type IMuxRequest = z.infer<typeof muxRequestSchema>;
export type IMuxResponse = z.infer<typeof muxResponseSchema>;
```

**Step 2: Add to job types**

```typescript
// src/types/jobs.ts (extend existing or create)
export interface IMuxJobData {
  type: 'mux';
  videoUrl: string;
  audioUrl: string;
  duration?: number;
  webhookUrl?: string;
}

export interface IConcatenateJobData {
  type: 'concatenate';
  videoUrls: string[];
  webhookUrl?: string;
}

export type IJobData = IMuxJobData | IConcatenateJobData;

export interface IJobResult {
  resultUrl: string;
  fileSizeBytes: number;
  processingTimeMs: number;
}
```

**Step 3: Commit**
```bash
git add .
git commit -m "feat: add Zod schemas for mux endpoint"
```

---

## Task 4: Implement Mux Route

**Files:**
- Create: `src/routes/mux.ts`
- Modify: `src/index.ts`

**Step 1: Write failing tests first (TDD)**

```typescript
// tests/mux.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../src/index';

// Mock the queue
vi.mock('../src/services/queue', () => ({
  addMuxJob: vi.fn().mockResolvedValue('test-job-id'),
}));

describe('POST /mux', () => {
  const validRequest = {
    videoUrl: 'https://example.com/video.mp4',
    audioUrl: 'https://example.com/audio.mp3',
  };

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.API_KEY}`,
  };

  it('returns 422 for missing videoUrl', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ audioUrl: 'https://example.com/a.mp3' }),
      headers: authHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('returns 422 for invalid URL format', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ videoUrl: 'not-a-url', audioUrl: 'https://example.com/a.mp3' }),
      headers: authHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('returns 202 with jobId for valid request', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify(validRequest),
      headers: authHeaders,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.jobId).toBe('test-job-id');
    expect(body.status).toBe('queued');
  });

  it('accepts optional duration parameter', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ ...validRequest, duration: 10.5 }),
      headers: authHeaders,
    });

    expect(res.status).toBe(202);
  });

  it('accepts optional webhookUrl parameter', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ ...validRequest, webhookUrl: 'https://example.com/webhook' }),
      headers: authHeaders,
    });

    expect(res.status).toBe(202);
  });
});
```

**Step 2: Implement route handler**

```typescript
// src/routes/mux.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { muxRequestSchema } from '../schemas/mux';
import { addMuxJob } from '../services/queue';

const mux = new Hono();

mux.post('/', zValidator('json', muxRequestSchema), async (c) => {
  const data = c.req.valid('json');

  const jobId = await addMuxJob({
    videoUrl: data.videoUrl,
    audioUrl: data.audioUrl,
    duration: data.duration,
    webhookUrl: data.webhookUrl,
  });

  return c.json({
    success: true,
    jobId,
    status: 'queued',
    message: 'Job queued successfully. Poll GET /jobs/:jobId for status.',
  }, 202);
});

export default mux;
```

**Step 3: Register route in index.ts**
```typescript
import mux from './routes/mux';

app.route('/mux', mux);
```

**Step 4: Add queue function**

```typescript
// src/services/queue.ts (add to existing)
import type { IMuxJobData } from '../types/jobs';

export async function addMuxJob(data: Omit<IMuxJobData, 'type'>): Promise<string> {
  const job = await jobQueue.add('mux', {
    type: 'mux',
    ...data,
  });
  return job.id!;
}
```

**Step 5: Run tests and verify**
```bash
npm test
```

**Step 6: Commit**
```bash
git add .
git commit -m "feat: add /mux endpoint with validation"
```

---

## Task 5: Implement Mux FFmpeg Processing

**Files:**
- Modify: `src/services/ffmpeg.ts`
- Modify: `src/worker.ts`

**Step 1: Add mux function to FFmpeg service**

```typescript
// src/services/ffmpeg.ts (add to existing)
import { spawn } from 'child_process';
import path from 'path';

interface IMuxParams {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  duration?: number;
  onProgress?: (percent: number) => void;
}

export async function muxVideoAudio(params: IMuxParams): Promise<void> {
  const { videoPath, audioPath, outputPath, duration, onProgress } = params;

  const args = [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-shortest',
    '-movflags', '+faststart',
  ];

  if (duration !== undefined) {
    args.push('-t', String(duration));
  }

  args.push(outputPath);

  return runFFmpeg(args, onProgress, duration);
}

function runFFmpeg(
  args: string[],
  onProgress?: (percent: number) => void,
  expectedDuration?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-progress', 'pipe:1', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      if (!onProgress || !expectedDuration) return;

      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('out_time_ms=')) {
          const timeMs = parseInt(line.split('=')[1], 10);
          if (!isNaN(timeMs)) {
            const currentSeconds = timeMs / 1000000;
            const percent = Math.min(99, Math.round((currentSeconds / expectedDuration) * 100));
            onProgress(percent);
          }
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr.slice(-500)}`));
      }
    });
  });
}
```

**Step 2: Add mux job processor to worker**

```typescript
// src/worker.ts (add to existing job processor)
import { muxVideoAudio } from './services/ffmpeg';
import { downloadFile, uploadFile, cleanupFiles, getFileSize, TEMP_DIR } from './services/storage';
import type { IMuxJobData, IJobResult } from './types/jobs';
import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

async function processMuxJob(job: Job<IMuxJobData>): Promise<IJobResult> {
  const { videoUrl, audioUrl, duration } = job.data;
  const jobId = job.id!;

  const videoPath = path.join(TEMP_DIR, `${jobId}-video.mp4`);
  const audioPath = path.join(TEMP_DIR, `${jobId}-audio.mp3`);
  const outputPath = path.join(TEMP_DIR, `${jobId}-output.mp4`);

  const startTime = Date.now();

  try {
    console.log(`[mux:${jobId}] Starting job`);
    await job.updateProgress(5);

    // Download inputs in parallel
    console.log(`[mux:${jobId}] Downloading inputs...`);
    await Promise.all([
      downloadFile(videoUrl, videoPath),
      downloadFile(audioUrl, audioPath),
    ]);
    await job.updateProgress(30);

    // Process with FFmpeg
    console.log(`[mux:${jobId}] Running FFmpeg mux...`);
    await muxVideoAudio({
      videoPath,
      audioPath,
      outputPath,
      duration,
      onProgress: async (percent) => {
        const scaled = 30 + Math.round(percent * 0.6);
        await job.updateProgress(scaled);
      },
    });
    await job.updateProgress(90);

    // Upload result
    console.log(`[mux:${jobId}] Uploading result...`);
    const resultUrl = await uploadFile(outputPath, `muxed/${jobId}.mp4`);
    const fileSizeBytes = await getFileSize(outputPath);
    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    console.log(`[mux:${jobId}] Completed in ${processingTimeMs}ms`);

    return { resultUrl, fileSizeBytes, processingTimeMs };
  } finally {
    await cleanupFiles([videoPath, audioPath, outputPath]);
  }
}

// Add to worker's job processor switch statement
// case 'mux':
//   return processMuxJob(job as Job<IMuxJobData>);
```

**Step 3: Commit**
```bash
git add .
git commit -m "feat: add FFmpeg mux processing in worker"
```

---

## Task 6: Implement Concatenate Endpoint

**Files:**
- Create: `src/schemas/concatenate.ts`
- Create: `src/routes/concatenate.ts`

**Step 1: Create schema**

```typescript
// src/schemas/concatenate.ts
import { z } from 'zod';

export const concatenateRequestSchema = z.object({
  videoUrls: z.array(z.string().url()).min(2, 'At least 2 video URLs required'),
  webhookUrl: z.string().url().optional(),
});

export type IConcatenateRequest = z.infer<typeof concatenateRequestSchema>;
```

**Step 2: Write tests**

```typescript
// tests/concatenate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/index';

vi.mock('../src/services/queue', () => ({
  addConcatenateJob: vi.fn().mockResolvedValue('test-concat-job-id'),
}));

describe('POST /concatenate', () => {
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.API_KEY}`,
  };

  it('returns 422 for less than 2 URLs', async () => {
    const res = await app.request('/concatenate', {
      method: 'POST',
      body: JSON.stringify({ videoUrls: ['https://example.com/v1.mp4'] }),
      headers: authHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('returns 202 with jobId for valid request', async () => {
    const res = await app.request('/concatenate', {
      method: 'POST',
      body: JSON.stringify({
        videoUrls: [
          'https://example.com/v1.mp4',
          'https://example.com/v2.mp4',
        ],
      }),
      headers: authHeaders,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.jobId).toBeDefined();
  });
});
```

**Step 3: Implement route**

```typescript
// src/routes/concatenate.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { concatenateRequestSchema } from '../schemas/concatenate';
import { addConcatenateJob } from '../services/queue';

const concatenate = new Hono();

concatenate.post('/', zValidator('json', concatenateRequestSchema), async (c) => {
  const data = c.req.valid('json');

  const jobId = await addConcatenateJob({
    videoUrls: data.videoUrls,
    webhookUrl: data.webhookUrl,
  });

  return c.json({
    success: true,
    jobId,
    status: 'queued',
    message: 'Job queued successfully. Poll GET /jobs/:jobId for status.',
  }, 202);
});

export default concatenate;
```

**Step 4: Add FFmpeg concatenate function and worker processor**
(Similar to mux - implement concatenateVideos function using ffmpeg concat demuxer)

**Step 5: Commit**
```bash
git add .
git commit -m "feat: add /concatenate endpoint with validation"
```

---

## Task 7: Implement Webhook Service

**Files:**
- Create: `src/services/webhook.ts`
- Modify: `src/worker.ts`

**Step 1: Create webhook service**

```typescript
// src/services/webhook.ts
import type { IJobResult } from '../types/jobs';

interface IWebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  result?: IJobResult;
  error?: string;
  timestamp: string;
}

export async function sendWebhook(
  webhookUrl: string,
  jobId: string,
  status: 'completed' | 'failed',
  result?: IJobResult,
  error?: string
): Promise<void> {
  const payload: IWebhookPayload = {
    jobId,
    status,
    result,
    error,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      console.error(`[webhook:${jobId}] Failed: ${response.status}`);
    } else {
      console.log(`[webhook:${jobId}] Sent successfully`);
    }
  } catch (err) {
    console.error(`[webhook:${jobId}] Error:`, err);
  }
}
```

**Step 2: Call webhook on job completion in worker**

```typescript
// In worker.ts - add to worker event handlers
worker.on('completed', async (job, result) => {
  console.log(`[worker] Job ${job.id} completed`);

  if (job.data.webhookUrl) {
    await sendWebhook(job.data.webhookUrl, job.id!, 'completed', result);
  }
});

worker.on('failed', async (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err.message);

  if (job?.data.webhookUrl) {
    await sendWebhook(job.data.webhookUrl, job.id!, 'failed', undefined, err.message);
  }
});
```

**Step 3: Commit**
```bash
git add .
git commit -m "feat: add webhook notifications for job completion"
```

---

## Task 8: Add Structured Logging

**Files:**
- Create: `src/middleware/logging.ts`
- Modify: `src/index.ts`

**Step 1: Create logging middleware**

```typescript
// src/middleware/logging.ts
import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'crypto';

interface ILogEntry {
  timestamp: string;
  level: string;
  correlationId: string;
  message: string;
  [key: string]: unknown;
}

export function log(level: string, correlationId: string, message: string, data?: object): void {
  const entry: ILogEntry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId,
    message,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

export const loggingMiddleware = createMiddleware(async (c, next) => {
  const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
  c.set('correlationId', correlationId);
  c.header('x-correlation-id', correlationId);

  const start = Date.now();

  await next();

  log('info', correlationId, 'Request completed', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});
```

**Step 2: Apply to app**
```typescript
app.use('*', loggingMiddleware);
```

**Step 3: Commit**
```bash
git add .
git commit -m "feat: add structured logging with correlation IDs"
```

---

## Task 9: Set Up Cloudflare R2

**Step 1: Create R2 bucket in Cloudflare dashboard**
1. Go to Cloudflare Dashboard > R2
2. Create bucket named `ffmpeg-output`
3. Enable public access or set up custom domain

**Step 2: Create R2 API token**
1. Go to R2 > Manage R2 API Tokens
2. Create token with Object Read & Write permissions
3. Scope to `ffmpeg-output` bucket
4. Copy Access Key ID and Secret Access Key

**Step 3: Note down values for Railway**
```
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET=ffmpeg-output
S3_PUBLIC_URL=https://pub-xxx.r2.dev
```

---

## Task 10: Deploy to Railway

**Step 1: Push to GitHub**
```bash
git remote set-url origin https://github.com/YOUR_USERNAME/ffmpeg-api.git
git push -u origin main
```

**Step 2: Create Railway project**
Use Railway MCP or dashboard:
```bash
# Using Railway skill
railway:new  # Initialize project
```

Or in Railway Dashboard:
1. New Project → Deploy from GitHub repo
2. Select your ffmpeg-api repository

**Step 3: Add Redis**
```bash
railway:database  # Add Redis
```

Or: In Railway project → New → Database → Redis

**Step 4: Create Worker service**
1. In Railway project → New → GitHub Repo → Same repo
2. Go to Settings → Deploy → Start Command: `npm run start:worker`
3. Rename service to "worker"

**Step 5: Set environment variables**
```bash
railway:environment  # View/set variables
```

For BOTH API and Worker services:
```
API_KEY=your-secure-api-key-generate-this
STORAGE_MODE=s3
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=your-r2-access-key
S3_SECRET_KEY=your-r2-secret-key
S3_BUCKET=ffmpeg-output
S3_PUBLIC_URL=https://your-public-bucket-url.com
WORKER_CONCURRENCY=2
S3_DEDUP_ENABLED=true
S3_DEDUP_TTL_DAYS=90
```

Note: `REDIS_URL` is automatically set by Railway when you add Redis.

**Step 6: Generate domain**
```bash
railway:domain  # Generate public domain
```

**Step 7: Verify deployment**
```bash
curl https://your-app.railway.app/health
```

---

## Task 11: Integration Testing

**Step 1: Test health endpoint**
```bash
curl https://your-app.railway.app/health
```

**Step 2: Test mux endpoint**
```bash
# Submit job
curl -X POST https://your-app.railway.app/mux \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "videoUrl": "https://example.com/test-video.mp4",
    "audioUrl": "https://example.com/test-audio.mp3",
    "duration": 10
  }'

# Response: {"success":true,"jobId":"abc123","status":"queued",...}

# Poll for status
curl https://your-app.railway.app/jobs/abc123 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Step 3: Test concatenate endpoint**
```bash
curl -X POST https://your-app.railway.app/concatenate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "videoUrls": [
      "https://example.com/video1.mp4",
      "https://example.com/video2.mp4"
    ]
  }'
```

**Step 4: Verify R2 uploads**
Check Cloudflare R2 dashboard for uploaded files.

---

## Task 12: Integrate with Convex App

**Files:**
- Create: `convex/ffmpegApi.ts` (in your main app repo)

**Step 1: Add environment variables to Convex**
In Convex dashboard > Settings > Environment Variables:
- `FFMPEG_API_URL` = `https://your-app.railway.app`
- `FFMPEG_API_KEY` = `your-api-key`

**Step 2: Create Convex action**

```typescript
// convex/ffmpegApi.ts
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const FFMPEG_API_URL = process.env.FFMPEG_API_URL;
const FFMPEG_API_KEY = process.env.FFMPEG_API_KEY;

async function waitForJob(jobId: string, maxWaitMs = 300000) {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`${FFMPEG_API_URL}/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${FFMPEG_API_KEY}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.status}`);
    }

    const status = await response.json();

    if (status.status === 'completed') {
      return status.result;
    }

    if (status.status === 'failed') {
      throw new Error(status.error || 'Job failed');
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Job timed out');
}

export const muxVideoAudio = action({
  args: {
    videoUrl: v.string(),
    audioUrl: v.string(),
    duration: v.optional(v.number()),
  },
  returns: v.object({
    resultUrl: v.string(),
    fileSizeBytes: v.number(),
    processingTimeMs: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!FFMPEG_API_URL || !FFMPEG_API_KEY) {
      throw new Error('FFmpeg API not configured');
    }

    const response = await fetch(`${FFMPEG_API_URL}/mux`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FFMPEG_API_KEY}`,
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`FFmpeg API error: ${await response.text()}`);
    }

    const { jobId } = await response.json();
    return waitForJob(jobId);
  },
});

export const concatenateVideos = action({
  args: {
    videoUrls: v.array(v.string()),
  },
  returns: v.object({
    resultUrl: v.string(),
    fileSizeBytes: v.number(),
    processingTimeMs: v.number(),
  }),
  handler: async (ctx, args) => {
    if (!FFMPEG_API_URL || !FFMPEG_API_KEY) {
      throw new Error('FFmpeg API not configured');
    }

    const response = await fetch(`${FFMPEG_API_URL}/concatenate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FFMPEG_API_KEY}`,
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(`FFmpeg API error: ${await response.text()}`);
    }

    const { jobId } = await response.json();
    return waitForJob(jobId);
  },
});
```

**Step 3: Commit to main app repo**
```bash
git add convex/ffmpegApi.ts
git commit -m "feat: add Convex actions for FFmpeg API integration"
```

---

## Summary

After completing all tasks, you will have:

1. **FFmpeg API Service** (forked from crisog/ffmpeg-rest)
   - Hono API server with Zod validation + OpenAPI docs
   - `/mux` endpoint for video + audio combining
   - `/concatenate` endpoint for joining videos
   - API key authentication
   - BullMQ async job queue with Redis
   - S3 storage with deduplication
   - Webhook notifications
   - Structured logging with correlation IDs

2. **Railway Deployment**
   - API service
   - Worker service
   - Redis database
   - Auto-generated domain

3. **Cloudflare R2 Storage**
   - Zero egress fees
   - SHA-256 deduplication

4. **Convex Integration**
   - Actions to call FFmpeg API
   - Polling-based job status

**Estimated effort:** 1-2 days (reduced from 2-3 days by using template)

**Benefits of forking template:**
- BullMQ integration already working
- S3 deduplication saves storage costs
- Zod + OpenAPI gives type-safe validation + auto docs
- Hono is faster than Express
- Less code to write and maintain
