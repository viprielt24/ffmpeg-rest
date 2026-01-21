# Image-to-Video API Design Document

**Date**: 2026-01-18
**Status**: Draft
**Author**: AI-assisted design session

---

## Executive Summary

Self-hosted image-to-video generation API using the open-source LTX-2 model from Lightricks. The system provides a cost-effective alternative to managed services like Replicate, achieving ~$0.04 per video compared to $0.15-0.25 on commercial platforms.

### Key Decisions

| Decision | Choice |
|----------|--------|
| AI Model | LTX-2 (Lightricks) - FP8 quantized |
| Video Spec | 1080p, 5 seconds, 24fps |
| Volume | 1000 videos/month |
| Latency | Background processing (hours acceptable) |
| API Framework | Node.js + Hono + BullMQ |
| API Hosting | Railway |
| GPU Provider | Vast.ai (A100 40GB, on-demand) |
| Storage | Cloudflare R2 |
| Monthly Cost | ~$41 |
| Per Video Cost | ~$0.041 |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [API Server (Railway)](#2-api-server-railway)
3. [GPU Worker (Vast.ai)](#3-gpu-worker-vastai)
4. [Storage (Cloudflare R2)](#4-storage-cloudflare-r2)
5. [Convex Integration](#5-convex-integration)
6. [Deployment & Operations](#6-deployment--operations)
7. [Cost Analysis](#7-cost-analysis)
8. [Security Considerations](#8-security-considerations)
9. [Future Improvements](#9-future-improvements)

---

## 1. Architecture Overview

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONVEX APP (Existing)                        │
│                  (React Frontend + Convex Backend)              │
│                                                                 │
│  User uploads image → Convex action → Calls Railway API         │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS POST
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        RAILWAY                                  │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │   Hono      │───►│    Redis    │    │  Postgres   │        │
│  │   API       │    │  (BullMQ)   │    │ (Job State) │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Worker pulls jobs
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VAST.AI GPU WORKER                           │
│                  (A100 40GB - On Demand)                        │
│                                                                 │
│  Pulls jobs from Redis ──► LTX-2 ──► Upload to Cloudflare R2   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
                    Webhook callback to Railway API
                               │
                               ▼
                    Convex receives completed video URL
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Convex App** | User interface, job creation, status display |
| **Railway API** | Request validation, job queuing, webhook handling |
| **Redis (BullMQ)** | Job queue with persistence and retry logic |
| **Postgres** | Job state persistence, audit logs |
| **Vast.ai Worker** | GPU inference with LTX-2 model |
| **Cloudflare R2** | Input/output file storage |

---

## 2. API Server (Railway)

### Technology Stack

- **Runtime**: Node.js 20
- **Framework**: Hono (fast, lightweight)
- **Queue**: BullMQ (Redis-based)
- **Validation**: Zod
- **Database**: Postgres (via Prisma or raw SQL)
- **Logging**: Pino

### Dependencies

```json
{
  "dependencies": {
    "@hono/node-server": "^1.19.5",
    "@hono/zod-openapi": "^1.1.3",
    "@scalar/hono-api-reference": "^0.9.20",
    "@aws-sdk/client-s3": "^3.901.0",
    "bullmq": "^5.60.0",
    "ioredis": "^5.8.0",
    "hono": "^4.9.9",
    "zod": "^4.1.11",
    "pino": "^10.0.0",
    "pino-pretty": "^13.1.1",
    "dotenv": "^17.2.3"
  }
}
```

### Project Structure

```
video-api/
├── src/
│   ├── index.ts              # Hono app entry
│   ├── routes/
│   │   ├── generate.ts       # POST /api/v1/generate
│   │   ├── jobs.ts           # GET /api/v1/jobs/:id
│   │   ├── storage.ts        # Presigned URL endpoints
│   │   ├── webhooks.ts       # POST /webhook/complete
│   │   └── health.ts         # GET /health
│   ├── lib/
│   │   ├── config.ts         # Environment config
│   │   ├── queue.ts          # BullMQ setup
│   │   ├── redis.ts          # ioredis client
│   │   ├── storage.ts        # S3/R2 client
│   │   ├── db.ts             # Postgres client
│   │   └── logger.ts         # Pino logger
│   ├── schemas/
│   │   └── job.ts            # Zod schemas
│   └── types/
│       └── index.ts          # TypeScript types
├── package.json
├── tsconfig.json
├── Dockerfile
└── railway.toml
```

### API Endpoints

#### POST /api/v1/generate

Create a new video generation job.

**Request:**
```json
{
  "image_url": "https://example.com/image.jpg",
  "prompt": "A cinematic video of the scene",
  "duration": 5,
  "webhook_url": "https://your-app.com/webhook"
}
```

**Response:**
```json
{
  "job_id": "job_abc123",
  "status": "queued",
  "created_at": "2026-01-18T10:00:00Z"
}
```

#### GET /api/v1/jobs/:id

Get job status.

**Response:**
```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "progress": 100,
  "result_url": "https://r2.example.com/outputs/job_abc123/output.mp4",
  "created_at": "2026-01-18T10:00:00Z",
  "completed_at": "2026-01-18T10:04:30Z"
}
```

#### POST /api/v1/presign/upload

Get presigned URL for uploading input image.

**Request:**
```json
{
  "job_id": "job_abc123",
  "content_type": "image/jpeg"
}
```

**Response:**
```json
{
  "upload_url": "https://xxx.r2.cloudflarestorage.com/...",
  "expires_in": 3600
}
```

#### GET /api/v1/presign/download/:jobId

Get presigned URL for downloading output video.

**Response:**
```json
{
  "download_url": "https://xxx.r2.cloudflarestorage.com/...",
  "expires_in": 86400
}
```

#### POST /webhook/complete (Internal)

Called by GPU worker when job completes.

**Request:**
```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "video_url": "https://r2.example.com/outputs/job_abc123/output.mp4"
}
```

#### GET /health

Health check endpoint.

**Response:**
```json
{
  "api": "ok",
  "redis": "ok",
  "database": "ok",
  "queue": {
    "pending": 5,
    "processing": 1
  }
}
```

### Job States

```
queued → processing → completed
                   → failed (with retry logic, max 3 attempts)
```

### Authentication

Simple API key authentication:

```typescript
// src/middleware/auth.ts
import { Context, Next } from "hono";

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  if (token !== process.env.API_KEY) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  await next();
}
```

### Environment Variables

```bash
# Railway environment variables
NODE_ENV=production
PORT=3000

# Authentication
API_KEY=your-secret-api-key
WEBHOOK_SECRET=your-webhook-secret

# Redis (auto-provided by Railway)
REDIS_URL=redis://default:xxx@xxx.railway.internal:6379

# Postgres (auto-provided by Railway)
DATABASE_URL=postgresql://xxx:xxx@xxx.railway.internal:5432/railway

# Cloudflare R2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=xxx
R2_BUCKET=video-api-storage
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

### railway.toml

```toml
[build]
builder = "dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[service]
internalPort = 3000
```

---

## 3. GPU Worker (Vast.ai)

### Overview

The GPU worker runs on Vast.ai A100 40GB instances (on-demand). It connects to the Railway Redis queue, pulls jobs, runs LTX-2 inference, and uploads results to R2.

### Hardware Requirements

| Resource | Requirement |
|----------|-------------|
| **GPU** | A100 40GB |
| **VRAM** | 40GB |
| **Disk** | 150GB+ SSD |
| **RAM** | 32GB+ system RAM |
| **CUDA** | 12.1+ |
| **Network** | 200+ Mbps download |

### Model Memory Usage (A100 40GB)

```
┌─────────────────────────────────────────┐
│           A100 40GB VRAM                │
├─────────────────────────────────────────┤
│  LTX-2 Model (FP8)         ~19GB        │
├─────────────────────────────────────────┤
│  Gemma 3 Text Encoder      ~6-8GB       │
│  (quantized)                            │
├─────────────────────────────────────────┤
│  Inference working memory  ~8-10GB      │
│  (activations, tensors)                 │
├─────────────────────────────────────────┤
│  Headroom                  ~3-5GB       │
└─────────────────────────────────────────┘
Total: ~36-40GB ✓ Fits
```

### Project Structure

```
gpu-worker/
├── worker/
│   ├── __init__.py
│   ├── main.py               # Entry point, job loop
│   ├── queue_client.py       # BullMQ-compatible Redis client
│   ├── inference.py          # LTX-2 model loading & inference
│   ├── storage.py            # R2 download/upload
│   ├── webhook.py            # Notify Railway on completion
│   └── config.py             # Environment settings
├── scripts/
│   ├── setup.sh              # Install dependencies on Vast.ai
│   └── start_worker.sh       # Launch worker
├── requirements.txt
└── Dockerfile
```

### requirements.txt

```
torch>=2.4.0
diffusers>=0.30.0
transformers>=4.40.0
accelerate>=0.30.0
safetensors>=0.4.0
huggingface_hub>=0.23.0
boto3>=1.34.0
redis>=5.0.0
requests>=2.31.0
Pillow>=10.0.0
imageio>=2.34.0
imageio-ffmpeg>=0.4.9
```

### Main Worker Loop

```python
# worker/main.py
import time
import logging
from .queue_client import BullMQClient
from .inference import LTXVideoGenerator
from .storage import R2Storage
from .webhook import notify_complete, notify_failed
from .config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    logger.info("Initializing LTX-2 model...")
    generator = LTXVideoGenerator(settings.MODEL_PATH)

    logger.info("Connecting to Redis queue...")
    queue = BullMQClient(settings.REDIS_URL, "video-generation")

    logger.info("Initializing R2 storage...")
    storage = R2Storage()

    logger.info("Worker ready, polling for jobs...")
    idle_count = 0
    max_idle = 60  # 5 minutes at 5-second intervals

    while True:
        job = queue.get_next_job()

        if job is None:
            idle_count += 1
            if idle_count >= max_idle:
                logger.info("Queue empty for 5 minutes, shutting down...")
                break
            time.sleep(5)
            continue

        idle_count = 0
        job_id = job["id"]

        logger.info(f"Processing job {job_id}")

        try:
            # Download input image
            local_image = f"/tmp/{job_id}_input.jpg"
            storage.download_input(job_id, local_image)

            # Generate video
            local_video = generator.generate(
                image_path=local_image,
                prompt=job.get("prompt", ""),
                duration=job.get("duration", 5),
            )

            # Upload result
            video_url = storage.upload_output(job_id, local_video)

            # Mark completed and notify
            queue.mark_completed(job_id, {"video_url": video_url})
            notify_complete(job_id, video_url, job.get("webhook_url"))

            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            queue.mark_failed(job_id, str(e))
            notify_failed(job_id, str(e), job.get("webhook_url"))

        finally:
            # Cleanup temp files
            import os
            for f in [local_image, local_video]:
                if os.path.exists(f):
                    os.remove(f)

if __name__ == "__main__":
    main()
```

### LTX-2 Inference Module

```python
# worker/inference.py
import torch
from diffusers import LTXImageToVideoPipeline
from PIL import Image
import uuid

class LTXVideoGenerator:
    def __init__(self, model_path: str = None):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        model_id = model_path or "Lightricks/LTX-Video"

        self.pipeline = LTXImageToVideoPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            variant="fp8",  # Use FP8 quantized for A100 40GB
        )
        self.pipeline.to(self.device)

        # Enable memory optimizations
        self.pipeline.enable_attention_slicing()

        print(f"Model loaded. VRAM: {torch.cuda.memory_allocated() / 1e9:.1f}GB")

    def generate(
        self,
        image_path: str,
        prompt: str = "",
        duration: int = 5,
        fps: int = 24,
        width: int = 1024,
        height: int = 576,
        num_inference_steps: int = 30,
    ) -> str:
        """Generate video from image, return path to output file."""

        image = Image.open(image_path).convert("RGB")

        # Calculate frames (must be divisible by 8 + 1)
        num_frames = (duration * fps // 8) * 8 + 1

        result = self.pipeline(
            image=image,
            prompt=prompt or "A smooth cinematic video",
            negative_prompt="blurry, low quality, distorted",
            num_frames=num_frames,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=7.5,
        )

        # Export to video file
        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"
        self._export_video(result.frames[0], output_path, fps)

        return output_path

    def _export_video(self, frames, output_path: str, fps: int):
        """Export frames to MP4 video."""
        import imageio

        writer = imageio.get_writer(output_path, fps=fps, codec="libx264")
        for frame in frames:
            writer.append_data(frame)
        writer.close()
```

### BullMQ-Compatible Queue Client

```python
# worker/queue_client.py
import redis
import json
import time

class BullMQClient:
    """Python client compatible with BullMQ job structure."""

    def __init__(self, redis_url: str, queue_name: str):
        self.redis = redis.from_url(redis_url)
        self.queue_name = queue_name
        self.prefix = f"bull:{queue_name}"

    def get_next_job(self, timeout: int = 5):
        """Pop next job from waiting queue."""

        # BullMQ uses lists for waiting jobs
        result = self.redis.brpoplpush(
            f"{self.prefix}:wait",
            f"{self.prefix}:active",
            timeout=timeout
        )

        if not result:
            return None

        job_id = result.decode() if isinstance(result, bytes) else result

        # Get job data
        job_data = self.redis.hgetall(f"{self.prefix}:{job_id}")

        if not job_data:
            return None

        data = json.loads(job_data.get(b"data", b"{}").decode())

        return {
            "id": job_id,
            **data
        }

    def mark_completed(self, job_id: str, result: dict):
        """Move job to completed state."""

        # Update job hash
        self.redis.hset(
            f"{self.prefix}:{job_id}",
            mapping={
                "returnvalue": json.dumps(result),
                "finishedOn": str(int(time.time() * 1000)),
                "processedOn": str(int(time.time() * 1000)),
            }
        )

        # Move from active to completed
        self.redis.lrem(f"{self.prefix}:active", 1, job_id)
        self.redis.zadd(f"{self.prefix}:completed", {job_id: time.time()})

    def mark_failed(self, job_id: str, error: str):
        """Move job to failed state."""

        self.redis.hset(
            f"{self.prefix}:{job_id}",
            mapping={
                "failedReason": error,
                "finishedOn": str(int(time.time() * 1000)),
            }
        )

        self.redis.lrem(f"{self.prefix}:active", 1, job_id)
        self.redis.zadd(f"{self.prefix}:failed", {job_id: time.time()})
```

### R2 Storage Client

```python
# worker/storage.py
import boto3
from botocore.config import Config
import os

class R2Storage:
    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=os.environ["R2_ENDPOINT"],
            aws_access_key_id=os.environ["R2_ACCESS_KEY"],
            aws_secret_access_key=os.environ["R2_SECRET_KEY"],
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        self.bucket = os.environ["R2_BUCKET"]
        self.public_url = os.environ.get("R2_PUBLIC_URL", "")

    def download_input(self, job_id: str, local_path: str) -> str:
        """Download input image from R2."""
        self.s3.download_file(
            self.bucket,
            f"inputs/{job_id}/input.jpg",
            local_path
        )
        return local_path

    def upload_output(self, job_id: str, local_path: str) -> str:
        """Upload output video to R2, return public URL."""
        key = f"outputs/{job_id}/output.mp4"

        self.s3.upload_file(
            local_path,
            self.bucket,
            key,
            ExtraArgs={"ContentType": "video/mp4"}
        )

        if self.public_url:
            return f"{self.public_url}/{key}"

        # Generate presigned URL if not public
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=86400 * 7  # 7 days
        )
```

### Webhook Notification

```python
# worker/webhook.py
import requests
import os
import logging

logger = logging.getLogger(__name__)

def notify_complete(job_id: str, video_url: str, webhook_url: str = None):
    """Notify API that job completed."""

    # Always notify our own API
    _call_webhook(
        os.environ["API_WEBHOOK_URL"],
        {
            "job_id": job_id,
            "status": "completed",
            "video_url": video_url,
        }
    )

    # Notify external webhook if provided
    if webhook_url:
        _call_webhook(webhook_url, {
            "job_id": job_id,
            "status": "completed",
            "video_url": video_url,
        })

def notify_failed(job_id: str, error: str, webhook_url: str = None):
    """Notify API that job failed."""

    _call_webhook(
        os.environ["API_WEBHOOK_URL"],
        {
            "job_id": job_id,
            "status": "failed",
            "error": error,
        }
    )

    if webhook_url:
        _call_webhook(webhook_url, {
            "job_id": job_id,
            "status": "failed",
            "error": error,
        })

def _call_webhook(url: str, payload: dict):
    """Make webhook HTTP call."""
    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Secret": os.environ.get("WEBHOOK_SECRET", ""),
            },
            timeout=10,
        )
        response.raise_for_status()
    except Exception as e:
        logger.error(f"Webhook failed: {url} - {e}")
```

### Setup Script

```bash
#!/bin/bash
# scripts/setup.sh

set -e

echo "=== Setting up LTX-2 Worker ==="

# Update system
apt-get update && apt-get install -y git ffmpeg

# Clone worker repo
cd /workspace
git clone https://github.com/YOUR_USERNAME/video-api-worker.git worker
cd worker

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Download LTX-2 model (cached on disk)
python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Lightricks/LTX-Video',
    local_dir='/workspace/models/ltx-video',
    ignore_patterns=['*.md', '*.txt']
)
print('Model downloaded successfully')
"

echo "=== Setup complete ==="
```

### Start Script

```bash
#!/bin/bash
# scripts/start_worker.sh

cd /workspace/worker

# Load environment variables
export REDIS_URL="${REDIS_URL}"
export R2_ENDPOINT="${R2_ENDPOINT}"
export R2_ACCESS_KEY="${R2_ACCESS_KEY}"
export R2_SECRET_KEY="${R2_SECRET_KEY}"
export R2_BUCKET="${R2_BUCKET}"
export R2_PUBLIC_URL="${R2_PUBLIC_URL}"
export API_WEBHOOK_URL="${API_WEBHOOK_URL}"
export WEBHOOK_SECRET="${WEBHOOK_SECRET}"
export MODEL_PATH="/workspace/models/ltx-video"

# Start worker
python -m worker.main
```

---

## 4. Storage (Cloudflare R2)

### Why Cloudflare R2?

| Provider | Storage/GB/mo | Egress | S3 Compatible |
|----------|---------------|--------|---------------|
| **Cloudflare R2** | $0.015 | **Free** | Yes |
| AWS S3 | $0.023 | $0.09/GB | Yes |
| Backblaze B2 | $0.006 | $0.01/GB | Yes |

R2's free egress saves significant costs when serving video files.

### Bucket Structure

```
video-api-storage/
├── inputs/
│   ├── {job_id}/
│   │   └── input.jpg
│   └── ...
├── outputs/
│   ├── {job_id}/
│   │   └── output.mp4
│   └── ...
└── temp/
    └── ...  (auto-deleted after 24h)
```

### Cost Estimate (1000 videos/month)

| Item | Size | Cost |
|------|------|------|
| Input images | ~2GB | $0.03 |
| Output videos | ~50GB | $0.75 |
| Class A ops (writes) | 2000 | $0.009 |
| Class B ops (reads) | 5000 | $0.002 |
| Egress | 50GB+ | **Free** |
| **Total** | | **~$1/month** |

### Setup Checklist

- [ ] Create Cloudflare account
- [ ] Create R2 bucket: `video-api-storage`
- [ ] Create API token with R2 read/write permissions
- [ ] Note credentials:
  - Endpoint URL
  - Access Key ID
  - Secret Access Key
- [ ] (Optional) Enable public access for outputs
- [ ] (Optional) Set lifecycle rule: delete `temp/*` after 24h

---

## 5. Convex Integration

### Schema Addition

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ... existing tables

  videoJobs: defineTable({
    userId: v.id("users"),
    sourceImageId: v.id("_storage"),
    prompt: v.optional(v.string()),

    status: v.union(
      v.literal("uploading"),
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    externalJobId: v.optional(v.string()),

    outputVideoUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),

    durationSeconds: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_external_job", ["externalJobId"]),
});
```

### Create Job Mutation

```typescript
// convex/videoJobs.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const create = mutation({
  args: {
    sourceImageId: v.id("_storage"),
    prompt: v.optional(v.string()),
  },
  returns: v.id("videoJobs"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const jobId = await ctx.db.insert("videoJobs", {
      userId,
      sourceImageId: args.sourceImageId,
      prompt: args.prompt,
      status: "uploading",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.videoJobs.submitToApi, {
      jobId,
    });

    return jobId;
  },
});
```

### Submit to API Action

```typescript
// convex/videoJobs.ts
"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

export const submitToApi = internalAction({
  args: { jobId: v.id("videoJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(internal.videoJobs.getJob, {
      jobId: args.jobId
    });
    if (!job) throw new Error("Job not found");

    const imageUrl = await ctx.storage.getUrl(job.sourceImageId);
    if (!imageUrl) throw new Error("Image not found");

    const response = await fetch(
      `${process.env.VIDEO_API_URL}/api/v1/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.VIDEO_API_KEY}`,
        },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: job.prompt || "Generate a smooth video",
          duration: 5,
          webhook_url: `${process.env.CONVEX_SITE_URL}/api/webhooks/video-complete`,
        }),
      }
    );

    if (!response.ok) {
      await ctx.runMutation(internal.videoJobs.updateStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: await response.text(),
      });
      return null;
    }

    const result = await response.json();

    await ctx.runMutation(internal.videoJobs.updateStatus, {
      jobId: args.jobId,
      status: "queued",
      externalJobId: result.job_id,
    });

    return null;
  },
});
```

### HTTP Webhook Endpoint

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/api/webhooks/video-complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("X-Webhook-Secret");
    if (authHeader !== process.env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    const { job_id, status, video_url, error } = body;

    if (status === "completed") {
      await ctx.runMutation(internal.videoJobs.completeJob, {
        externalJobId: job_id,
        videoUrl: video_url,
      });
    } else if (status === "failed") {
      await ctx.runMutation(internal.videoJobs.failJob, {
        externalJobId: job_id,
        errorMessage: error,
      });
    }

    return new Response("OK", { status: 200 });
  }),
});

export default http;
```

### Environment Variables (Convex)

```bash
VIDEO_API_URL=https://your-app.railway.app
VIDEO_API_KEY=your-secret-api-key
WEBHOOK_SECRET=your-webhook-secret
```

---

## 6. Deployment & Operations

### Railway Deployment

```bash
# Install CLI
npm install -g @railway/cli

# Login and init
railway login
railway init

# Add databases
railway add --database redis
railway add --database postgres

# Deploy
git push railway main
```

### Vast.ai Operations

#### Create Instance

```bash
# Install CLI
pip install vastai

# Set API key
vastai set api-key YOUR_API_KEY

# Find A100 40GB offers
vastai search offers 'gpu_name=A100 gpu_ram>=40 disk_space>=150'

# Rent instance
vastai create instance <OFFER_ID> \
  --image pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel \
  --disk 150
```

#### Start Worker

```bash
# SSH into instance
vastai ssh-url <INSTANCE_ID>

# Run setup (first time)
bash /workspace/setup.sh

# Start worker
bash /workspace/start_worker.sh
```

#### Destroy Instance

```bash
vastai destroy instance <INSTANCE_ID>
```

### Batch Processing Workflow

```
1. Jobs accumulate in queue throughout the week
2. Weekly (or when queue > threshold):
   - Spin up Vast.ai instance
   - Worker processes all jobs
   - Worker auto-stops after 5 min idle
   - Destroy instance to stop billing
```

### Automation Script

```python
# scripts/batch_processor.py
import subprocess
import time
import requests
import os

def get_queue_size():
    resp = requests.get(
        f"{os.environ['API_URL']}/api/v1/queue/stats",
        headers={"Authorization": f"Bearer {os.environ['API_KEY']}"}
    )
    return resp.json()["pending_jobs"]

def main():
    queue_size = get_queue_size()

    if queue_size < 10:
        print("Queue too small, skipping")
        return

    # Find best offer
    result = subprocess.run([
        "vastai", "search", "offers",
        "gpu_name=A100", "gpu_ram>=40",
        "--order", "dph_total", "--limit", "1", "--raw"
    ], capture_output=True, text=True)

    import json
    offer_id = json.loads(result.stdout)[0]["id"]

    # Create instance
    result = subprocess.run([
        "vastai", "create", "instance", str(offer_id),
        "--image", "pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel",
        "--disk", "150"
    ], capture_output=True, text=True)

    instance_id = result.stdout.strip().split()[-1]

    # Wait for queue to empty
    while get_queue_size() > 0:
        time.sleep(60)

    # Destroy instance
    subprocess.run(["vastai", "destroy", "instance", instance_id])

if __name__ == "__main__":
    main()
```

---

## 7. Cost Analysis

### Monthly Cost Breakdown

| Component | Cost |
|-----------|------|
| Railway (API + Redis + Postgres) | ~$12 |
| Vast.ai GPU (~42 hours @ $0.66/hr) | ~$28 |
| Cloudflare R2 | ~$1 |
| **Total** | **~$41/month** |

### Per-Video Cost

| Volume | Total Cost | Per Video |
|--------|------------|-----------|
| 1,000/month | $41 | $0.041 |
| 500/month | $35 | $0.070 |
| 2,000/month | $55 | $0.028 |

### Comparison with Alternatives

| Provider | Per Video | 1000 Videos/Month |
|----------|-----------|-------------------|
| **This Solution** | $0.041 | $41 |
| Replicate | $0.15-0.25 | $150-250 |
| Modal | $0.088 | $88 |
| RunPod Serverless | $0.072 | $72 |

**Savings: 60-85% compared to managed alternatives**

---

## 8. Security Considerations

### API Authentication

- All endpoints require `Authorization: Bearer <API_KEY>` header
- API keys stored in Railway environment variables
- Rotate keys periodically

### Webhook Verification

- All webhooks include `X-Webhook-Secret` header
- Verify secret before processing webhook payload

### Network Security

- Railway provides automatic HTTPS
- Redis and Postgres accessible only within Railway private network
- Vast.ai worker connects via public Redis URL (use strong password)

### Data Security

- Input images and output videos stored with unique job IDs
- Presigned URLs expire after configurable time
- Consider lifecycle policies to auto-delete old files

### Secrets Management

```bash
# Never commit secrets to git
# Use environment variables:

# Railway
railway variables set API_KEY=xxx
railway variables set WEBHOOK_SECRET=xxx

# Vast.ai (pass at runtime)
export REDIS_URL=xxx
export R2_ACCESS_KEY=xxx
```

---

## 9. Future Improvements

### Phase 2 Enhancements

- [ ] **Auto-scaling**: Automatically spin up Vast.ai based on queue size
- [ ] **Progress tracking**: Real-time progress updates via WebSocket
- [ ] **Multiple resolutions**: Support 720p, 1080p, 4K options
- [ ] **Longer videos**: Support 10-30 second videos
- [ ] **Text-to-video**: Add support for text-only generation

### Phase 3 Enhancements

- [ ] **Multi-model support**: Add Runway, Pika, other models
- [ ] **Style presets**: Pre-configured generation styles
- [ ] **Batch API**: Upload multiple images, get multiple videos
- [ ] **Priority queues**: Fast-track for premium users
- [ ] **Usage analytics**: Track generation stats and costs

### Cost Optimization

- [ ] **Spot instances**: Use Vast.ai spot for further savings (with retry logic)
- [ ] **Model caching**: Keep model loaded between batches
- [ ] **Compression**: Optimize video output size
- [ ] **Regional storage**: Use R2 locations closer to users

---

## References

- [LTX-2 Model (HuggingFace)](https://huggingface.co/Lightricks/LTX-2)
- [LTX-2 GitHub](https://github.com/Lightricks/LTX-2)
- [LTX-2 VRAM Requirements](https://wavespeed.ai/blog/posts/blog-ltx-2-vram-requirements/)
- [GPU Cloud Pricing Comparison](https://getdeploying.com/gpus)
- [Vast.ai Documentation](https://vast.ai/docs)
- [Railway Documentation](https://docs.railway.app)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2)
- [BullMQ Documentation](https://docs.bullmq.io)
- [Hono Framework](https://hono.dev)
