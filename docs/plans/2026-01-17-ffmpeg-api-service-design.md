# FFmpeg API Service Design

**Date:** 2026-01-17
**Status:** Draft
**Branch:** TBD

## Overview

Build a self-hosted FFmpeg API service to replace browser-based FFmpeg WASM processing. This will significantly increase video processing speed while keeping infrastructure simple and costs low.

## Goals

1. **Speed improvement:** 5-10x faster video processing vs browser WASM
2. **Parallel processing:** Mux multiple scenes simultaneously (not possible with current WASM lock)
3. **Scalability:** Handle 50+ concurrent customers with async job queue
4. **Reliability:** Jobs persist through crashes, automatic retries
5. **Simple infrastructure:** No servers to manage, git-push deployment
6. **Cost-effective:** ~$10-15/month for production usage

## Current State (Problem)

The current `ffmpegService.ts` uses `@ffmpeg/ffmpeg` (FFmpeg WASM) which runs entirely in the browser:

- **Single-threaded** - WASM constraint
- **Sequential processing** - `muxing` lock enforces one operation at a time
- **Browser memory limits** - Large videos can crash
- **No GPU acceleration** - Pure CPU processing
- **Blocks UI** - Heavy processing affects user experience

## Solution

### Architecture

```
Your App (Convex Action)
        │
        ▼ HTTP POST (video URLs)
┌─────────────────────────┐
│   FFmpeg API Server     │ ──→ Returns jobId immediately
│   (Express.js)          │
└─────────────────────────┘
        │
        ▼ (adds to queue)
┌─────────────────────────┐
│       Redis             │ ← Job Queue (BullMQ)
└─────────────────────────┘
        │
        ▼ (workers pull jobs)
┌─────────────────────────┐
│   FFmpeg Worker(s)      │ ──→ Download → Process → Upload
│   (Railway / Docker)    │
└─────────────────────────┘
        │
        ▼
   Cloudflare R2 Storage
        │
        ▼
   Webhook callback (optional)
   or client polls GET /jobs/:id
```

### Technology Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Language | TypeScript/Node.js | Consistent with existing codebase |
| Job Queue | BullMQ | Reliable, Redis-backed, progress tracking |
| Cache/Queue | Redis | Fast, persistent, Railway provides managed Redis |
| Container | Docker | Bundles FFmpeg binary, portable |
| Compute | Railway | Git-push deploy, no CLI required, auto-scaling |
| Storage | Cloudflare R2 | Free egress, S3-compatible |

## API Design

### Endpoints

```
POST /mux
  - Queues video + audio muxing job
  - Input: { videoUrl, audioUrl, duration?, webhookUrl? }
  - Output: { success: true, jobId, status: "queued" }

POST /concatenate
  - Queues video concatenation job
  - Input: { videoUrls: string[], webhookUrl? }
  - Output: { success: true, jobId, status: "queued" }

GET /jobs/:jobId
  - Get job status and result
  - Output: { jobId, status, progress?, result?, error? }
  - Status: "queued" | "processing" | "completed" | "failed"

GET /health
  - Health check for monitoring
  - Output: { status: "ok", ffmpegVersion, redisConnected, queuedJobs, activeJobs }
```

### Authentication

Simple API key in header:
```
Authorization: Bearer your-secret-api-key
```

### Example Flow

```json
// 1. Submit job
POST /mux
{
  "videoUrl": "https://your-storage.com/scene1-video.mp4",
  "audioUrl": "https://your-storage.com/scene1-audio.mp3",
  "duration": 8.5
}

// Response (immediate)
{
  "success": true,
  "jobId": "abc123",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}

// 2. Poll for status
GET /jobs/abc123

// Response (processing)
{
  "jobId": "abc123",
  "status": "processing",
  "progress": 45
}

// Response (completed)
{
  "jobId": "abc123",
  "status": "completed",
  "progress": 100,
  "result": {
    "resultUrl": "https://your-cdn.com/muxed/abc123.mp4",
    "fileSizeBytes": 2340000,
    "processingTimeMs": 4200
  }
}
```

## Project Structure

```
ffmpeg-api/
├── src/
│   ├── index.ts              # Express API server entry
│   ├── worker.ts             # BullMQ worker entry
│   ├── routes/
│   │   ├── mux.ts            # POST /mux handler
│   │   ├── concatenate.ts    # POST /concatenate handler
│   │   ├── jobs.ts           # GET /jobs/:id handler
│   │   └── health.ts         # GET /health handler
│   ├── services/
│   │   ├── queue.ts          # BullMQ queue management
│   │   ├── ffmpeg.ts         # FFmpeg command execution
│   │   ├── storage.ts        # Download/upload files
│   │   └── webhook.ts        # Webhook notifications
│   ├── middleware/
│   │   └── auth.ts           # API key validation
│   └── types.ts              # TypeScript interfaces
├── Dockerfile
├── railway.toml              # Railway config
├── package.json
└── .env.example
```

**Railway Services:**
- **API Service** - runs `node dist/index.js`
- **Worker Service** - runs `node dist/worker.js`
- **Redis** - managed Redis from Railway

## Implementation Details

### Dockerfile

```dockerfile
FROM node:20-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### FFmpeg Service (src/services/ffmpeg.ts)

```typescript
import { spawn } from 'child_process';
import { unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import path from 'path';

const TEMP_DIR = '/tmp/ffmpeg-work';

interface MuxParams {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  duration?: number;
}

export async function muxVideoAudio(params: MuxParams): Promise<void> {
  const { videoPath, audioPath, outputPath, duration } = params;

  const args = [
    '-i', videoPath,
    '-i', audioPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '48000',
    '-ac', '2',
    '-shortest',
  ];

  if (duration) {
    args.push('-t', String(duration));
  }

  args.push('-y', outputPath);

  await runFFmpeg(args);
}

export async function concatenateVideos(
  videoPaths: string[],
  outputPath: string
): Promise<void> {
  const listPath = path.join(TEMP_DIR, `list-${randomUUID()}.txt`);
  const listContent = videoPaths.map(p => `file '${p}'`).join('\n');
  await writeFile(listPath, listContent);

  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-y', outputPath,
  ];

  try {
    await runFFmpeg(args);
  } finally {
    await unlink(listPath).catch(() => {});
  }
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed (code ${code}): ${stderr}`));
      }
    });
  });
}
```

### Storage Service (src/services/storage.ts)

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET!;
const PUBLIC_URL = process.env.S3_PUBLIC_URL!;

export async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const fileStream = createWriteStream(destPath);
  await pipeline(response.body!, fileStream);
}

export async function uploadFile(filePath: string, key: string): Promise<string> {
  const fileStream = createReadStream(filePath);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: 'video/mp4',
  }));

  return `${PUBLIC_URL}/${key}`;
}

export async function cleanupFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(p => unlink(p).catch(() => {}))
  );
}
```

### Mux Route Handler (src/routes/mux.ts)

```typescript
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { stat } from 'fs/promises';
import path from 'path';
import { downloadFile, uploadFile, cleanupFiles } from '../services/storage';
import { muxVideoAudio } from '../services/ffmpeg';

const router = Router();
const TEMP_DIR = '/tmp/ffmpeg-work';

interface MuxRequest {
  videoUrl: string;
  audioUrl: string;
  duration?: number;
}

router.post('/', async (req, res) => {
  const { videoUrl, audioUrl, duration } = req.body as MuxRequest;
  const jobId = randomUUID();

  const videoPath = path.join(TEMP_DIR, `${jobId}-video.mp4`);
  const audioPath = path.join(TEMP_DIR, `${jobId}-audio.mp3`);
  const outputPath = path.join(TEMP_DIR, `${jobId}-output.mp4`);

  const startTime = Date.now();

  try {
    await Promise.all([
      downloadFile(videoUrl, videoPath),
      downloadFile(audioUrl, audioPath),
    ]);

    await muxVideoAudio({ videoPath, audioPath, outputPath, duration });

    const resultUrl = await uploadFile(outputPath, `muxed/${jobId}.mp4`);
    const stats = await stat(outputPath);

    res.json({
      success: true,
      resultUrl,
      fileSizeBytes: stats.size,
      processingTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    });
  } finally {
    await cleanupFiles([videoPath, audioPath, outputPath]);
  }
});

export default router;
```

### Server Entry Point (src/index.ts)

```typescript
import express from 'express';
import { mkdir } from 'fs/promises';
import muxRouter from './routes/mux';
import concatenateRouter from './routes/concatenate';
import healthRouter from './routes/health';
import { authMiddleware } from './middleware/auth';

const app = express();
const PORT = process.env.PORT || 3000;
const TEMP_DIR = '/tmp/ffmpeg-work';

app.use(express.json());

app.use('/health', healthRouter);
app.use('/mux', authMiddleware, muxRouter);
app.use('/concatenate', authMiddleware, concatenateRouter);

async function start() {
  await mkdir(TEMP_DIR, { recursive: true });

  app.listen(PORT, () => {
    console.log(`FFmpeg API running on port ${PORT}`);
  });
}

start();
```

### Railway Configuration (railway.toml)

```toml
[build]
builder = "nixpacks"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### Nixpacks Configuration (nixpacks.toml)

```toml
[phases.setup]
nixPkgs = ["ffmpeg"]

[start]
cmd = "node dist/index.js"
```

## Convex Integration

### Convex Action (convex/ffmpegApi.ts)

```typescript
"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const FFMPEG_API_URL = process.env.FFMPEG_API_URL!;
const FFMPEG_API_KEY = process.env.FFMPEG_API_KEY!;

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

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Mux failed');
    }

    return {
      resultUrl: result.resultUrl,
      fileSizeBytes: result.fileSizeBytes,
      processingTimeMs: result.processingTimeMs,
    };
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

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Concatenate failed');
    }

    return {
      resultUrl: result.resultUrl,
      fileSizeBytes: result.fileSizeBytes,
      processingTimeMs: result.processingTimeMs,
    };
  },
});
```

## Cost Analysis

### Hosting Comparison

| Hosting | Monthly Base | Per-Video Cost | Best For |
|---------|-------------|----------------|----------|
| **Railway** | $5 | ~$0.001-0.002 | Git-push deploy, no CLI |
| Fly.io | $0 (free tier) | ~$0.001-0.003 | Low volume, easy deploy |
| Hetzner VPS | €4 (~$4.50) | $0 (fixed) | High volume |
| AWS Lambda | $0 | ~$0.002-0.005 | Burst traffic |

### Storage Comparison

| Provider | Storage/GB/month | Egress/GB |
|----------|------------------|-----------|
| **Cloudflare R2** | $0.015 | Free |
| Backblaze B2 | $0.006 | $0.01 |
| AWS S3 | $0.023 | $0.09 |

### Estimated Monthly Cost by Volume

| Videos/Month | Railway + R2 | vs Rendi (~$0.03/video) |
|--------------|-------------|-------------------------|
| 100 | ~$6 | $3 |
| 500 | ~$7-10 | $15 |
| 2,000 | ~$15-20 | $60 |
| 10,000 | ~$45-65 | $300 |

**Recommendation:** Railway + Cloudflare R2 = ~$5-10/month for light usage (includes $5 base)

## Deployment

### One-time Setup

1. **Create Railway project:**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your `ffmpeg-api` repository

2. **Set environment variables in Railway Dashboard:**
   - `API_KEY=your-secret-key-here`
   - `S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com`
   - `S3_ACCESS_KEY=xxx`
   - `S3_SECRET_KEY=xxx`
   - `S3_BUCKET=ffmpeg-output`
   - `S3_PUBLIC_URL=https://your-cdn.com`
   - `PORT=3000`

### Deploy

```bash
# Just push to GitHub - Railway auto-deploys
git push origin main
```

### Verify

```bash
# Check health (get URL from Railway dashboard)
curl https://your-ffmpeg-api.up.railway.app/health

# Check logs in Railway Dashboard → Deployments → View Logs
```

## Implementation Checklist

### Phase 1: Setup (Day 1)
- [ ] Create new repo `ffmpeg-api`
- [ ] Initialize Node.js/TypeScript project
- [ ] Create Dockerfile with FFmpeg
- [ ] Set up Cloudflare R2 bucket

### Phase 2: Core API (Day 1-2)
- [ ] Implement `/health` endpoint
- [ ] Implement storage service (download/upload)
- [ ] Implement FFmpeg service (mux, concatenate)
- [ ] Implement `/mux` endpoint
- [ ] Implement `/concatenate` endpoint
- [ ] Add auth middleware

### Phase 3: Deploy (Day 2)
- [ ] Deploy to Railway (via GitHub)
- [ ] Set environment variables in Railway Dashboard
- [ ] Test endpoints manually

### Phase 4: Integrate (Day 2-3)
- [ ] Add Convex actions to call API
- [ ] Update existing video generation to use new API
- [ ] Keep browser FFmpeg as fallback (optional)
- [ ] Test end-to-end

**Estimated total effort: 2-3 days**

## Future Enhancements (Not in Scope)

- Async processing with webhooks for longer videos
- Job queue for high concurrency
- Progress streaming via WebSocket
- GPU acceleration for faster encoding
- Multiple output formats/resolutions
