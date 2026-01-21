# Multi-Model Video API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted multi-model video generation API supporting LTX-2 (image-to-video) and Wav2Lip (lip-sync), deployed on Railway with GPU workers on Vast.ai.

**Architecture:** Node.js/Hono API server on Railway handles requests and routes to model-specific BullMQ queues. Separate Python GPU workers on Vast.ai pull jobs from their respective queues, run inference, and upload results to Cloudflare R2.

**Tech Stack:** Node.js 20, Hono, BullMQ, Redis, Python 3.12, PyTorch, LTX-2, Wav2Lip, Cloudflare R2, Railway, Vast.ai

**Supported Models:**
| Model | Task | GPU Required | VRAM | Processing Time |
|-------|------|--------------|------|-----------------|
| LTX-2 | Image → Video | A100 40GB | ~40GB | ~2.5 min/5s video |
| Wav2Lip | Video + Audio → Lip-sync | RTX 4090 | ~12GB | ~20s/5s video |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        RAILWAY API                              │
│                                                                 │
│  POST /api/v1/generate                                         │
│    body: { model, ...params }                                  │
│                                                                 │
│    model: "ltx2"     → Queue: video-generation-ltx2            │
│    model: "wav2lip"  → Queue: video-generation-wav2lip         │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐                            │
│  │    Redis    │    │  Postgres   │                            │
│  │  (2 queues) │    │ (job state) │                            │
│  └─────────────┘    └─────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│   VAST.AI - A100 40GB   │      │  VAST.AI - RTX 4090     │
│                         │      │                         │
│   LTX-2 Worker          │      │   Wav2Lip Worker        │
│   Queue: ltx2           │      │   Queue: wav2lip        │
│                         │      │                         │
│   Input:                │      │   Input:                │
│   - image_url           │      │   - video_url           │
│   - prompt              │      │   - audio_url           │
│   - duration            │      │                         │
│                         │      │                         │
│   Output: video.mp4     │      │   Output: video.mp4     │
└─────────────────────────┘      └─────────────────────────┘
```

---

## Phase 1: Project Setup & Infrastructure

### Task 1.1: Create Video API Project Structure

**Files:**
- Create: `../video-api/package.json`
- Create: `../video-api/tsconfig.json`
- Create: `../video-api/.gitignore`
- Create: `../video-api/.env.example`

**Step 1: Create project directory**

```bash
mkdir -p ../video-api
cd ../video-api
```

**Step 2: Initialize package.json**

```json
{
  "name": "video-api",
  "version": "1.0.0",
  "description": "Multi-model video generation API (LTX-2, Wav2Lip)",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.19.5",
    "@hono/zod-validator": "^0.4.3",
    "@aws-sdk/client-s3": "^3.901.0",
    "@aws-sdk/s3-request-presigner": "^3.901.0",
    "bullmq": "^5.60.0",
    "ioredis": "^5.8.0",
    "hono": "^4.9.9",
    "zod": "^4.1.11",
    "pino": "^10.0.0",
    "pino-pretty": "^13.1.1",
    "dotenv": "^17.2.3",
    "nanoid": "^5.1.5"
  },
  "devDependencies": {
    "@types/node": "^22.15.21",
    "tsx": "^4.19.4",
    "typescript": "^5.9.5",
    "vitest": "^3.2.3",
    "eslint": "^9.28.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
```

**Step 5: Create .env.example**

```bash
# Server
NODE_ENV=development
PORT=3000

# Authentication
API_KEY=your-secret-api-key
WEBHOOK_SECRET=your-webhook-secret

# Redis
REDIS_URL=redis://localhost:6379

# Cloudflare R2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=xxx
R2_BUCKET=video-api-storage
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

**Step 6: Install dependencies**

```bash
cd ../video-api && npm install
```

**Step 7: Commit**

```bash
cd ../video-api && git init && git add . && git commit -m "chore: initialize multi-model video-api project"
```

---

### Task 1.2: Create Core Library Files

**Files:**
- Create: `../video-api/src/lib/config.ts`
- Create: `../video-api/src/lib/logger.ts`
- Create: `../video-api/src/lib/redis.ts`

**Step 1: Create config.ts**

```typescript
// src/lib/config.ts
import { config } from "dotenv";

config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000", 10),

  // Auth
  API_KEY: process.env.API_KEY || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || "",

  // Redis
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",

  // R2
  R2_ENDPOINT: process.env.R2_ENDPOINT || "",
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY || "",
  R2_SECRET_KEY: process.env.R2_SECRET_KEY || "",
  R2_BUCKET: process.env.R2_BUCKET || "video-api-storage",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || "",
} as const;

// Supported models
export const SUPPORTED_MODELS = ["ltx2", "wav2lip"] as const;
export type ModelType = (typeof SUPPORTED_MODELS)[number];

export function validateEnv(): void {
  const required = ["API_KEY", "WEBHOOK_SECRET", "REDIS_URL"] as const;
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
```

**Step 2: Create logger.ts**

```typescript
// src/lib/logger.ts
import pino from "pino";
import { env } from "./config.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  transport: env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});
```

**Step 3: Create redis.ts**

```typescript
// src/lib/redis.ts
import Redis from "ioredis";
import { env } from "./config.js";
import { logger } from "./logger.js";

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisClient.on("error", (err) => {
      logger.error({ err }, "Redis connection error");
    });

    redisClient.on("connect", () => {
      logger.info("Redis connected");
    });
  }

  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
```

**Step 4: Commit**

```bash
git add . && git commit -m "feat: add core config, logger, and redis modules"
```

---

### Task 1.3: Create Multi-Model Queue Module

**Files:**
- Create: `../video-api/src/lib/queue.ts`

**Step 1: Create queue module with model-specific queues**

```typescript
// src/lib/queue.ts
import { Queue, Job } from "bullmq";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";
import type { ModelType } from "./config.js";

// LTX-2 job data (image-to-video)
export interface LTX2JobData {
  model: "ltx2";
  image_url: string;
  prompt?: string;
  duration: number;
  webhook_url?: string;
}

// Wav2Lip job data (lip-sync)
export interface Wav2LipJobData {
  model: "wav2lip";
  video_url: string;
  audio_url: string;
  webhook_url?: string;
}

export type VideoJobData = LTX2JobData | Wav2LipJobData;

export interface VideoJobResult {
  video_url: string;
}

// Queue instances by model
const queues: Map<ModelType, Queue<VideoJobData, VideoJobResult>> = new Map();

function getQueueName(model: ModelType): string {
  return `video-generation-${model}`;
}

export function getVideoQueue(model: ModelType): Queue<VideoJobData, VideoJobResult> {
  let queue = queues.get(model);

  if (!queue) {
    const queueName = getQueueName(model);
    queue = new Queue<VideoJobData, VideoJobResult>(queueName, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
        },
      },
    });

    queues.set(model, queue);
    logger.info({ queueName }, "Video queue initialized");
  }

  return queue;
}

export async function addVideoJob(
  data: VideoJobData
): Promise<Job<VideoJobData, VideoJobResult>> {
  const queue = getVideoQueue(data.model);
  const job = await queue.add(`generate-${data.model}`, data);
  logger.info({ jobId: job.id, model: data.model }, "Video job added to queue");
  return job;
}

export async function getJobById(
  model: ModelType,
  jobId: string
): Promise<Job<VideoJobData, VideoJobResult> | undefined> {
  const queue = getVideoQueue(model);
  return queue.getJob(jobId);
}

export async function getQueueStats(model: ModelType): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const queue = getVideoQueue(model);
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return { pending: waiting, processing: active, completed, failed };
}

export async function getAllQueueStats(): Promise<
  Record<ModelType, { pending: number; processing: number; completed: number; failed: number }>
> {
  const [ltx2Stats, wav2lipStats] = await Promise.all([
    getQueueStats("ltx2"),
    getQueueStats("wav2lip"),
  ]);

  return {
    ltx2: ltx2Stats,
    wav2lip: wav2lipStats,
  };
}

export async function closeQueues(): Promise<void> {
  for (const queue of queues.values()) {
    await queue.close();
  }
  queues.clear();
}
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add multi-model BullMQ queue module"
```

---

### Task 1.4: Create R2 Storage Module

**Files:**
- Create: `../video-api/src/lib/storage.ts`

**Step 1: Create storage module**

```typescript
// src/lib/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./config.js";
import type { ModelType } from "./config.js";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY,
        secretAccessKey: env.R2_SECRET_KEY,
      },
    });
  }
  return s3Client;
}

// Input types vary by model
type InputType = "image" | "video" | "audio";

const INPUT_CONTENT_TYPES: Record<InputType, string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/wav",
};

const INPUT_EXTENSIONS: Record<InputType, string> = {
  image: "jpg",
  video: "mp4",
  audio: "wav",
};

export async function getPresignedUploadUrl(
  jobId: string,
  inputType: InputType,
  contentType?: string
): Promise<{ uploadUrl: string; expiresIn: number; key: string }> {
  const client = getS3Client();
  const expiresIn = 3600;
  const ext = INPUT_EXTENSIONS[inputType];
  const key = `inputs/${jobId}/input.${ext}`;

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: contentType || INPUT_CONTENT_TYPES[inputType],
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  return { uploadUrl, expiresIn, key };
}

export async function getPresignedDownloadUrl(
  jobId: string
): Promise<{ downloadUrl: string; expiresIn: number }> {
  const client = getS3Client();
  const expiresIn = 86400;

  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: `outputs/${jobId}/output.mp4`,
  });

  const downloadUrl = await getSignedUrl(client, command, { expiresIn });

  return { downloadUrl, expiresIn };
}

export function getOutputUrl(jobId: string): string {
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL}/outputs/${jobId}/output.mp4`;
  }
  return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/outputs/${jobId}/output.mp4`;
}

export function getInputUrl(jobId: string, inputType: InputType): string {
  const ext = INPUT_EXTENSIONS[inputType];
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL}/inputs/${jobId}/input.${ext}`;
  }
  return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/inputs/${jobId}/input.${ext}`;
}
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add R2 storage module with multi-type support"
```

---

## Phase 2: API Routes

### Task 2.1: Create Zod Schemas for Multiple Models

**Files:**
- Create: `../video-api/src/schemas/job.ts`

**Step 1: Create model-specific schemas**

```typescript
// src/schemas/job.ts
import { z } from "zod";

// Model type enum
export const ModelTypeSchema = z.enum(["ltx2", "wav2lip"]);
export type ModelType = z.infer<typeof ModelTypeSchema>;

// LTX-2 specific request (image-to-video)
export const LTX2GenerateRequestSchema = z.object({
  model: z.literal("ltx2"),
  image_url: z.string().url(),
  prompt: z.string().optional(),
  duration: z.number().int().min(1).max(10).default(5),
  webhook_url: z.string().url().optional(),
});

export type LTX2GenerateRequest = z.infer<typeof LTX2GenerateRequestSchema>;

// Wav2Lip specific request (lip-sync)
export const Wav2LipGenerateRequestSchema = z.object({
  model: z.literal("wav2lip"),
  video_url: z.string().url(),
  audio_url: z.string().url(),
  webhook_url: z.string().url().optional(),
});

export type Wav2LipGenerateRequest = z.infer<typeof Wav2LipGenerateRequestSchema>;

// Combined generate request (discriminated union)
export const GenerateRequestSchema = z.discriminatedUnion("model", [
  LTX2GenerateRequestSchema,
  Wav2LipGenerateRequestSchema,
]);

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

// Response schemas
export const GenerateResponseSchema = z.object({
  job_id: z.string(),
  model: ModelTypeSchema,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  created_at: z.string().datetime(),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

export const JobStatusResponseSchema = z.object({
  job_id: z.string(),
  model: ModelTypeSchema,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  result_url: z.string().url().optional(),
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});

export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

// Presign request for uploading inputs
export const PresignUploadRequestSchema = z.object({
  job_id: z.string(),
  input_type: z.enum(["image", "video", "audio"]),
  content_type: z.string().optional(),
});

export type PresignUploadRequest = z.infer<typeof PresignUploadRequestSchema>;

export const PresignUploadResponseSchema = z.object({
  upload_url: z.string().url(),
  expires_in: z.number(),
  key: z.string(),
});

export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;

// Webhook payload
export const WebhookPayloadSchema = z.object({
  job_id: z.string(),
  model: ModelTypeSchema,
  status: z.enum(["completed", "failed"]),
  video_url: z.string().url().optional(),
  error: z.string().optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add Zod schemas for multi-model API"
```

---

### Task 2.2: Create Auth Middleware

**Files:**
- Create: `../video-api/src/middleware/auth.ts`

**Step 1: Create auth middleware**

```typescript
// src/middleware/auth.ts
import type { Context, Next } from "hono";
import { env } from "../lib/config.js";

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  if (token !== env.API_KEY) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  await next();
}
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add API key auth middleware"
```

---

### Task 2.3: Create Health Route with Multi-Queue Stats

**Files:**
- Create: `../video-api/src/routes/health.ts`

**Step 1: Create health route**

```typescript
// src/routes/health.ts
import { Hono } from "hono";
import { getRedis } from "../lib/redis.js";
import { getAllQueueStats } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

const health = new Hono();

health.get("/health", async (c) => {
  const checks = {
    api: "ok" as const,
    redis: "unknown" as string,
    queues: {
      ltx2: { pending: 0, processing: 0, completed: 0, failed: 0 },
      wav2lip: { pending: 0, processing: 0, completed: 0, failed: 0 },
    },
  };

  // Check Redis
  try {
    const redis = getRedis();
    await redis.ping();
    checks.redis = "ok";
  } catch (err) {
    logger.error({ err }, "Redis health check failed");
    checks.redis = "error";
  }

  // Get queue stats for all models
  try {
    checks.queues = await getAllQueueStats();
  } catch (err) {
    logger.error({ err }, "Queue stats check failed");
  }

  const healthy = checks.redis === "ok";

  return c.json(checks, healthy ? 200 : 503);
});

export default health;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add health check route with multi-queue stats"
```

---

### Task 2.4: Create Generate Route for Multiple Models

**Files:**
- Create: `../video-api/src/routes/generate.ts`

**Step 1: Create generate route**

```typescript
// src/routes/generate.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { GenerateRequestSchema } from "../schemas/job.js";
import { addVideoJob } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

const generate = new Hono();

generate.post(
  "/generate",
  zValidator("json", GenerateRequestSchema),
  async (c) => {
    const data = c.req.valid("json");

    try {
      let jobData;

      if (data.model === "ltx2") {
        jobData = {
          model: "ltx2" as const,
          image_url: data.image_url,
          prompt: data.prompt,
          duration: data.duration,
          webhook_url: data.webhook_url,
        };
      } else if (data.model === "wav2lip") {
        jobData = {
          model: "wav2lip" as const,
          video_url: data.video_url,
          audio_url: data.audio_url,
          webhook_url: data.webhook_url,
        };
      } else {
        return c.json({ error: "Unsupported model" }, 400);
      }

      const job = await addVideoJob(jobData);

      logger.info({ jobId: job.id, model: data.model }, "Video job created");

      return c.json(
        {
          job_id: job.id,
          model: data.model,
          status: "queued" as const,
          created_at: new Date().toISOString(),
        },
        201
      );
    } catch (err) {
      logger.error({ err, model: data.model }, "Failed to create video job");
      return c.json({ error: "Failed to create job" }, 500);
    }
  }
);

export default generate;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add multi-model generate route"
```

---

### Task 2.5: Create Jobs Route

**Files:**
- Create: `../video-api/src/routes/jobs.ts`

**Step 1: Create jobs route**

```typescript
// src/routes/jobs.ts
import { Hono } from "hono";
import { getJobById } from "../lib/queue.js";
import { getOutputUrl } from "../lib/storage.js";
import { logger } from "../lib/logger.js";
import { SUPPORTED_MODELS, type ModelType } from "../lib/config.js";

const jobs = new Hono();

function mapJobState(state: string): "queued" | "processing" | "completed" | "failed" {
  switch (state) {
    case "waiting":
    case "delayed":
      return "queued";
    case "active":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

// Get job by ID - need to check both queues
jobs.get("/jobs/:id", async (c) => {
  const jobId = c.req.param("id");
  const modelParam = c.req.query("model") as ModelType | undefined;

  try {
    let job;
    let foundModel: ModelType | undefined;

    // If model specified, check only that queue
    if (modelParam && SUPPORTED_MODELS.includes(modelParam)) {
      job = await getJobById(modelParam, jobId);
      foundModel = modelParam;
    } else {
      // Check all queues
      for (const model of SUPPORTED_MODELS) {
        job = await getJobById(model, jobId);
        if (job) {
          foundModel = model;
          break;
        }
      }
    }

    if (!job || !foundModel) {
      return c.json({ error: "Job not found" }, 404);
    }

    const state = await job.getState();
    const status = mapJobState(state);

    const response: {
      job_id: string;
      model: ModelType;
      status: string;
      progress?: number;
      result_url?: string;
      error_message?: string;
      created_at: string;
      completed_at?: string;
    } = {
      job_id: job.id!,
      model: foundModel,
      status,
      created_at: new Date(job.timestamp).toISOString(),
    };

    if (typeof job.progress === "number") {
      response.progress = job.progress;
    }

    if (status === "completed" && job.returnvalue) {
      response.result_url = job.returnvalue.video_url || getOutputUrl(job.id!);
      if (job.finishedOn) {
        response.completed_at = new Date(job.finishedOn).toISOString();
      }
    }

    if (status === "failed" && job.failedReason) {
      response.error_message = job.failedReason;
    }

    return c.json(response);
  } catch (err) {
    logger.error({ err, jobId }, "Failed to get job status");
    return c.json({ error: "Failed to get job status" }, 500);
  }
});

export default jobs;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add job status route with multi-queue lookup"
```

---

### Task 2.6: Create Storage and Webhook Routes

**Files:**
- Create: `../video-api/src/routes/storage.ts`
- Create: `../video-api/src/routes/webhooks.ts`

**Step 1: Create storage routes**

```typescript
// src/routes/storage.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { PresignUploadRequestSchema } from "../schemas/job.js";
import { getPresignedUploadUrl, getPresignedDownloadUrl } from "../lib/storage.js";
import { logger } from "../lib/logger.js";

const storage = new Hono();

storage.post(
  "/presign/upload",
  zValidator("json", PresignUploadRequestSchema),
  async (c) => {
    const { job_id, input_type, content_type } = c.req.valid("json");

    try {
      const result = await getPresignedUploadUrl(job_id, input_type, content_type);
      return c.json({
        upload_url: result.uploadUrl,
        expires_in: result.expiresIn,
        key: result.key,
      });
    } catch (err) {
      logger.error({ err, job_id }, "Failed to generate upload URL");
      return c.json({ error: "Failed to generate upload URL" }, 500);
    }
  }
);

storage.get("/presign/download/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  try {
    const result = await getPresignedDownloadUrl(jobId);
    return c.json({
      download_url: result.downloadUrl,
      expires_in: result.expiresIn,
    });
  } catch (err) {
    logger.error({ err, jobId }, "Failed to generate download URL");
    return c.json({ error: "Failed to generate download URL" }, 500);
  }
});

export default storage;
```

**Step 2: Create webhooks route**

```typescript
// src/routes/webhooks.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { WebhookPayloadSchema } from "../schemas/job.js";
import { getJobById } from "../lib/queue.js";
import { env } from "../lib/config.js";
import { logger } from "../lib/logger.js";

const webhooks = new Hono();

webhooks.post(
  "/webhook/complete",
  async (c, next) => {
    const secret = c.req.header("X-Webhook-Secret");
    if (secret !== env.WEBHOOK_SECRET) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  },
  zValidator("json", WebhookPayloadSchema),
  async (c) => {
    const payload = c.req.valid("json");

    logger.info({ payload }, "Received webhook from worker");

    try {
      const job = await getJobById(payload.model, payload.job_id);

      if (!job) {
        logger.warn({ jobId: payload.job_id, model: payload.model }, "Webhook for unknown job");
        return c.json({ error: "Job not found" }, 404);
      }

      // Forward to external webhook if configured
      if (job.data.webhook_url) {
        try {
          await fetch(job.data.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          logger.info({ webhookUrl: job.data.webhook_url }, "Forwarded webhook");
        } catch (err) {
          logger.error({ err, webhookUrl: job.data.webhook_url }, "Failed to forward webhook");
        }
      }

      return c.json({ success: true });
    } catch (err) {
      logger.error({ err, payload }, "Failed to process webhook");
      return c.json({ error: "Failed to process webhook" }, 500);
    }
  }
);

export default webhooks;
```

**Step 3: Commit**

```bash
git add . && git commit -m "feat: add storage and webhook routes"
```

---

### Task 2.7: Create Main App Entry Point

**Files:**
- Create: `../video-api/src/index.ts`

**Step 1: Create main entry point**

```typescript
// src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";

import { env, validateEnv } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { authMiddleware } from "./middleware/auth.js";

import healthRoutes from "./routes/health.js";
import generateRoutes from "./routes/generate.js";
import jobsRoutes from "./routes/jobs.js";
import storageRoutes from "./routes/storage.js";
import webhooksRoutes from "./routes/webhooks.js";

validateEnv();

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", honoLogger());

// Public routes
app.route("/", healthRoutes);

// Internal webhook (uses webhook secret)
app.route("/", webhooksRoutes);

// Protected routes
app.use("/api/*", authMiddleware);
app.route("/api/v1", generateRoutes);
app.route("/api/v1", jobsRoutes);
app.route("/api/v1", storageRoutes);

// Error handler
app.onError((err, c) => {
  logger.error({ err }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Start server
const port = env.PORT;
logger.info({ port }, "Starting multi-model video API server");

serve({ fetch: app.fetch, port });

export default app;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add main app entry point"
```

---

### Task 2.8: Create Dockerfile and Railway Config

**Files:**
- Create: `../video-api/Dockerfile`
- Create: `../video-api/railway.toml`

**Step 1: Create Dockerfile**

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

**Step 2: Create railway.toml**

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

**Step 3: Commit**

```bash
git add . && git commit -m "feat: add Dockerfile and Railway config"
```

---

## Phase 3: GPU Workers

### Task 3.1: Create Shared Worker Base

**Files:**
- Create: `../gpu-worker/worker/__init__.py`
- Create: `../gpu-worker/worker/config.py`
- Create: `../gpu-worker/worker/queue_client.py`
- Create: `../gpu-worker/worker/storage.py`
- Create: `../gpu-worker/worker/webhook.py`
- Create: `../gpu-worker/requirements-base.txt`

**Step 1: Create project directory**

```bash
mkdir -p ../gpu-worker/worker ../gpu-worker/scripts
cd ../gpu-worker
```

**Step 2: Create requirements-base.txt** (shared dependencies)

```
boto3>=1.34.0
redis>=5.0.0
requests>=2.31.0
Pillow>=10.0.0
python-dotenv>=1.0.0
```

**Step 3: Create worker/__init__.py**

```python
"""GPU Worker for multi-model video generation."""
```

**Step 4: Create worker/config.py**

```python
# worker/config.py
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # Model type this worker handles
    MODEL_TYPE: str = os.environ.get("MODEL_TYPE", "ltx2")

    # Redis
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")

    # R2 Storage
    R2_ENDPOINT: str = os.environ.get("R2_ENDPOINT", "")
    R2_ACCESS_KEY: str = os.environ.get("R2_ACCESS_KEY", "")
    R2_SECRET_KEY: str = os.environ.get("R2_SECRET_KEY", "")
    R2_BUCKET: str = os.environ.get("R2_BUCKET", "video-api-storage")
    R2_PUBLIC_URL: str = os.environ.get("R2_PUBLIC_URL", "")

    # Webhook
    API_WEBHOOK_URL: str = os.environ.get("API_WEBHOOK_URL", "")
    WEBHOOK_SECRET: str = os.environ.get("WEBHOOK_SECRET", "")

    # Model paths
    LTX2_MODEL_PATH: str = os.environ.get("LTX2_MODEL_PATH", "Lightricks/LTX-Video")
    WAV2LIP_MODEL_PATH: str = os.environ.get("WAV2LIP_MODEL_PATH", "/workspace/models/wav2lip")

    # Worker settings
    MAX_IDLE_SECONDS: int = int(os.environ.get("MAX_IDLE_SECONDS", "300"))

    @property
    def queue_name(self) -> str:
        return f"video-generation-{self.MODEL_TYPE}"


settings = Settings()
```

**Step 5: Create worker/queue_client.py**

```python
# worker/queue_client.py
"""BullMQ-compatible Redis queue client."""
import json
import time
import redis
import logging

logger = logging.getLogger(__name__)


class BullMQClient:
    """Python client compatible with BullMQ job structure."""

    def __init__(self, redis_url: str, queue_name: str):
        self.redis = redis.from_url(redis_url)
        self.queue_name = queue_name
        self.prefix = f"bull:{queue_name}"
        logger.info(f"Connected to queue: {queue_name}")

    def get_next_job(self, timeout: int = 5) -> dict | None:
        """Pop next job from waiting queue."""
        try:
            result = self.redis.brpoplpush(
                f"{self.prefix}:wait",
                f"{self.prefix}:active",
                timeout=timeout
            )

            if not result:
                return None

            job_id = result.decode() if isinstance(result, bytes) else result
            job_data = self.redis.hgetall(f"{self.prefix}:{job_id}")

            if not job_data:
                return None

            data = json.loads(job_data.get(b"data", b"{}").decode())
            logger.info(f"Got job {job_id}")
            return {"id": job_id, **data}

        except Exception as e:
            logger.error(f"Error getting job: {e}")
            return None

    def mark_completed(self, job_id: str, result: dict) -> None:
        """Move job to completed state."""
        try:
            now = int(time.time() * 1000)
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={
                    "returnvalue": json.dumps(result),
                    "finishedOn": str(now),
                    "processedOn": str(now),
                }
            )
            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:completed", {job_id: time.time()})
            logger.info(f"Job {job_id} completed")
        except Exception as e:
            logger.error(f"Error completing job {job_id}: {e}")

    def mark_failed(self, job_id: str, error: str) -> None:
        """Move job to failed state."""
        try:
            now = int(time.time() * 1000)
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={"failedReason": error, "finishedOn": str(now)}
            )
            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:failed", {job_id: time.time()})
            logger.info(f"Job {job_id} failed: {error}")
        except Exception as e:
            logger.error(f"Error failing job {job_id}: {e}")

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update job progress."""
        try:
            self.redis.hset(f"{self.prefix}:{job_id}", "progress", str(progress))
        except Exception as e:
            logger.error(f"Error updating progress: {e}")
```

**Step 6: Create worker/storage.py**

```python
# worker/storage.py
"""Cloudflare R2 storage client."""
import boto3
from botocore.config import Config
import logging
import os

from .config import settings

logger = logging.getLogger(__name__)


class R2Storage:
    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT,
            aws_access_key_id=settings.R2_ACCESS_KEY,
            aws_secret_access_key=settings.R2_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        self.bucket = settings.R2_BUCKET
        self.public_url = settings.R2_PUBLIC_URL

    def download_file(self, key: str, local_path: str) -> str:
        """Download file from R2."""
        logger.info(f"Downloading {key}")
        self.s3.download_file(self.bucket, key, local_path)
        return local_path

    def download_input(self, job_id: str, input_type: str, local_path: str) -> str:
        """Download input file for job."""
        ext_map = {"image": "jpg", "video": "mp4", "audio": "wav"}
        ext = ext_map.get(input_type, "bin")
        key = f"inputs/{job_id}/input.{ext}"
        return self.download_file(key, local_path)

    def upload_output(self, job_id: str, local_path: str) -> str:
        """Upload output video to R2."""
        key = f"outputs/{job_id}/output.mp4"
        logger.info(f"Uploading to {key}")
        self.s3.upload_file(
            local_path, self.bucket, key,
            ExtraArgs={"ContentType": "video/mp4"}
        )
        if self.public_url:
            return f"{self.public_url}/{key}"
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=86400 * 7
        )
```

**Step 7: Create worker/webhook.py**

```python
# worker/webhook.py
"""Webhook notifications."""
import requests
import logging

from .config import settings

logger = logging.getLogger(__name__)


def _call_webhook(url: str, payload: dict) -> bool:
    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Secret": settings.WEBHOOK_SECRET,
            },
            timeout=10,
        )
        response.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Webhook failed: {url} - {e}")
        return False


def notify_complete(job_id: str, model: str, video_url: str, webhook_url: str | None = None):
    payload = {"job_id": job_id, "model": model, "status": "completed", "video_url": video_url}
    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)
    if webhook_url:
        _call_webhook(webhook_url, payload)


def notify_failed(job_id: str, model: str, error: str, webhook_url: str | None = None):
    payload = {"job_id": job_id, "model": model, "status": "failed", "error": error}
    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)
    if webhook_url:
        _call_webhook(webhook_url, payload)
```

**Step 8: Commit**

```bash
git init && git add . && git commit -m "feat: add shared worker base modules"
```

---

### Task 3.2: Create LTX-2 Worker

**Files:**
- Create: `../gpu-worker/workers/ltx2/__init__.py`
- Create: `../gpu-worker/workers/ltx2/inference.py`
- Create: `../gpu-worker/workers/ltx2/main.py`
- Create: `../gpu-worker/requirements-ltx2.txt`

**Step 1: Create LTX-2 requirements**

```
-r requirements-base.txt
torch>=2.4.0
diffusers>=0.30.0
transformers>=4.40.0
accelerate>=0.30.0
safetensors>=0.4.0
huggingface_hub>=0.23.0
imageio>=2.34.0
imageio-ffmpeg>=0.4.9
```

**Step 2: Create workers/ltx2/__init__.py**

```python
"""LTX-2 Image-to-Video Worker."""
```

**Step 3: Create workers/ltx2/inference.py**

```python
# workers/ltx2/inference.py
"""LTX-2 video generation inference."""
import torch
import uuid
import logging
from PIL import Image

logger = logging.getLogger(__name__)


class LTX2Generator:
    def __init__(self, model_path: str = "Lightricks/LTX-Video"):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Device: {self.device}")

        from diffusers import LTXImageToVideoPipeline

        logger.info(f"Loading LTX-2 from {model_path}...")
        self.pipeline = LTXImageToVideoPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
        )
        self.pipeline.to(self.device)

        if hasattr(self.pipeline, "enable_attention_slicing"):
            self.pipeline.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded. VRAM: {vram:.1f}GB")

    def generate(
        self,
        image_path: str,
        prompt: str = "",
        duration: int = 5,
        fps: int = 24,
        width: int = 1024,
        height: int = 576,
        num_inference_steps: int = 30,
        progress_callback=None,
    ) -> str:
        logger.info(f"Generating: {image_path}, duration={duration}s")
        image = Image.open(image_path).convert("RGB")
        num_frames = (duration * fps // 8) * 8 + 1

        def callback_fn(pipe, step, timestep, callback_kwargs):
            if progress_callback:
                progress_callback(int((step / num_inference_steps) * 100))
            return callback_kwargs

        result = self.pipeline(
            image=image,
            prompt=prompt or "A smooth cinematic video",
            negative_prompt="blurry, low quality, distorted",
            num_frames=num_frames,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=7.5,
            callback_on_step_end=callback_fn,
        )

        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"
        self._export_video(result.frames[0], output_path, fps)
        return output_path

    def _export_video(self, frames, output_path: str, fps: int):
        import imageio
        writer = imageio.get_writer(output_path, fps=fps, codec="libx264")
        for frame in frames:
            writer.append_data(frame)
        writer.close()
```

**Step 4: Create workers/ltx2/main.py**

```python
# workers/ltx2/main.py
"""LTX-2 Worker main loop."""
import time
import os
import logging
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from worker.config import settings
from worker.queue_client import BullMQClient
from worker.storage import R2Storage
from worker.webhook import notify_complete, notify_failed
from .inference import LTX2Generator

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Starting LTX-2 Worker ===")

    generator = LTX2Generator(settings.LTX2_MODEL_PATH)
    queue = BullMQClient(settings.REDIS_URL, "video-generation-ltx2")
    storage = R2Storage()

    logger.info("Worker ready, polling...")
    idle_seconds = 0

    while True:
        job = queue.get_next_job(timeout=5)

        if job is None:
            idle_seconds += 5
            if idle_seconds >= settings.MAX_IDLE_SECONDS:
                logger.info("Idle timeout, shutting down...")
                break
            continue

        idle_seconds = 0
        job_id = job["id"]
        logger.info(f"Processing {job_id}")

        local_image = f"/tmp/{job_id}_input.jpg"
        local_video = None

        try:
            queue.update_progress(job_id, 0)

            # Download input image
            storage.download_input(job_id, "image", local_image)
            queue.update_progress(job_id, 10)

            # Generate
            def on_progress(p):
                queue.update_progress(job_id, 10 + int(p * 0.8))

            local_video = generator.generate(
                image_path=local_image,
                prompt=job.get("prompt", ""),
                duration=job.get("duration", 5),
                progress_callback=on_progress,
            )
            queue.update_progress(job_id, 90)

            # Upload
            video_url = storage.upload_output(job_id, local_video)
            queue.update_progress(job_id, 100)

            queue.mark_completed(job_id, {"video_url": video_url})
            notify_complete(job_id, "ltx2", video_url, job.get("webhook_url"))
            logger.info(f"Job {job_id} completed")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            queue.mark_failed(job_id, str(e))
            notify_failed(job_id, "ltx2", str(e), job.get("webhook_url"))

        finally:
            for f in [local_image, local_video]:
                if f and os.path.exists(f):
                    try:
                        os.remove(f)
                    except:
                        pass

    logger.info("=== LTX-2 Worker shutdown ===")


if __name__ == "__main__":
    main()
```

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add LTX-2 worker"
```

---

### Task 3.3: Create Wav2Lip Worker

**Files:**
- Create: `../gpu-worker/workers/wav2lip/__init__.py`
- Create: `../gpu-worker/workers/wav2lip/inference.py`
- Create: `../gpu-worker/workers/wav2lip/main.py`
- Create: `../gpu-worker/requirements-wav2lip.txt`

**Step 1: Create Wav2Lip requirements**

```
-r requirements-base.txt
torch>=2.0.1
torchvision
opencv-python
librosa>=0.9.0
numpy<2.0
scipy
tqdm
numba
```

**Step 2: Create workers/wav2lip/__init__.py**

```python
"""Wav2Lip Lip-Sync Worker."""
```

**Step 3: Create workers/wav2lip/inference.py**

```python
# workers/wav2lip/inference.py
"""Wav2Lip lip-sync inference."""
import subprocess
import uuid
import logging
import os

logger = logging.getLogger(__name__)


class Wav2LipGenerator:
    def __init__(self, model_path: str = "/workspace/models/wav2lip"):
        self.model_path = model_path
        self.checkpoint = os.path.join(model_path, "wav2lip_gan.pth")

        if not os.path.exists(self.checkpoint):
            raise FileNotFoundError(f"Wav2Lip checkpoint not found: {self.checkpoint}")

        logger.info(f"Wav2Lip initialized with checkpoint: {self.checkpoint}")

    def generate(
        self,
        video_path: str,
        audio_path: str,
        progress_callback=None,
    ) -> str:
        """Generate lip-synced video."""
        logger.info(f"Lip-syncing: video={video_path}, audio={audio_path}")

        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"

        # Wav2Lip inference command
        cmd = [
            "python",
            os.path.join(self.model_path, "inference.py"),
            "--checkpoint_path", self.checkpoint,
            "--face", video_path,
            "--audio", audio_path,
            "--outfile", output_path,
            "--resize_factor", "1",
            "--nosmooth",
        ]

        logger.info(f"Running: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=self.model_path,
        )

        # Stream output and track progress
        for line in process.stdout:
            logger.debug(line.strip())
            # Parse progress from output if available
            if "%" in line and progress_callback:
                try:
                    # Try to extract percentage
                    import re
                    match = re.search(r"(\d+)%", line)
                    if match:
                        progress_callback(int(match.group(1)))
                except:
                    pass

        process.wait()

        if process.returncode != 0:
            raise RuntimeError(f"Wav2Lip failed with code {process.returncode}")

        if not os.path.exists(output_path):
            raise RuntimeError("Wav2Lip did not produce output file")

        logger.info(f"Lip-sync complete: {output_path}")
        return output_path
```

**Step 4: Create workers/wav2lip/main.py**

```python
# workers/wav2lip/main.py
"""Wav2Lip Worker main loop."""
import time
import os
import logging
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from worker.config import settings
from worker.queue_client import BullMQClient
from worker.storage import R2Storage
from worker.webhook import notify_complete, notify_failed
from .inference import Wav2LipGenerator

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Starting Wav2Lip Worker ===")

    generator = Wav2LipGenerator(settings.WAV2LIP_MODEL_PATH)
    queue = BullMQClient(settings.REDIS_URL, "video-generation-wav2lip")
    storage = R2Storage()

    logger.info("Worker ready, polling...")
    idle_seconds = 0

    while True:
        job = queue.get_next_job(timeout=5)

        if job is None:
            idle_seconds += 5
            if idle_seconds >= settings.MAX_IDLE_SECONDS:
                logger.info("Idle timeout, shutting down...")
                break
            continue

        idle_seconds = 0
        job_id = job["id"]
        logger.info(f"Processing {job_id}")

        local_video = f"/tmp/{job_id}_input.mp4"
        local_audio = f"/tmp/{job_id}_input.wav"
        output_video = None

        try:
            queue.update_progress(job_id, 0)

            # Download inputs
            storage.download_input(job_id, "video", local_video)
            queue.update_progress(job_id, 10)

            storage.download_input(job_id, "audio", local_audio)
            queue.update_progress(job_id, 20)

            # Generate
            def on_progress(p):
                queue.update_progress(job_id, 20 + int(p * 0.7))

            output_video = generator.generate(
                video_path=local_video,
                audio_path=local_audio,
                progress_callback=on_progress,
            )
            queue.update_progress(job_id, 90)

            # Upload
            video_url = storage.upload_output(job_id, output_video)
            queue.update_progress(job_id, 100)

            queue.mark_completed(job_id, {"video_url": video_url})
            notify_complete(job_id, "wav2lip", video_url, job.get("webhook_url"))
            logger.info(f"Job {job_id} completed")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            queue.mark_failed(job_id, str(e))
            notify_failed(job_id, "wav2lip", str(e), job.get("webhook_url"))

        finally:
            for f in [local_video, local_audio, output_video]:
                if f and os.path.exists(f):
                    try:
                        os.remove(f)
                    except:
                        pass

    logger.info("=== Wav2Lip Worker shutdown ===")


if __name__ == "__main__":
    main()
```

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add Wav2Lip worker"
```

---

### Task 3.4: Create Worker Scripts

**Files:**
- Create: `../gpu-worker/scripts/setup-ltx2.sh`
- Create: `../gpu-worker/scripts/setup-wav2lip.sh`
- Create: `../gpu-worker/scripts/start-ltx2.sh`
- Create: `../gpu-worker/scripts/start-wav2lip.sh`
- Create: `../gpu-worker/.env.example`

**Step 1: Create setup-ltx2.sh**

```bash
#!/bin/bash
set -e
echo "=== Setting up LTX-2 Worker ==="

apt-get update && apt-get install -y git ffmpeg

pip install --upgrade pip
pip install -r requirements-ltx2.txt

# Download model
python -c "
from huggingface_hub import snapshot_download
snapshot_download('Lightricks/LTX-Video', local_dir='/workspace/models/ltx-video', ignore_patterns=['*.md'])
"

echo "=== LTX-2 Setup Complete ==="
```

**Step 2: Create setup-wav2lip.sh**

```bash
#!/bin/bash
set -e
echo "=== Setting up Wav2Lip Worker ==="

apt-get update && apt-get install -y git ffmpeg libsndfile1

pip install --upgrade pip
pip install -r requirements-wav2lip.txt

# Clone Wav2Lip if not exists
if [ ! -d "/workspace/models/wav2lip" ]; then
    git clone https://github.com/Rudrabha/Wav2Lip.git /workspace/models/wav2lip
fi

# Download pretrained models
cd /workspace/models/wav2lip
mkdir -p checkpoints face_detection/detection/sfd

# Download Wav2Lip GAN model
if [ ! -f "checkpoints/wav2lip_gan.pth" ]; then
    echo "Download wav2lip_gan.pth from https://github.com/Rudrabha/Wav2Lip#getting-the-weights"
    echo "Place it in /workspace/models/wav2lip/checkpoints/"
fi

# Download face detection model
if [ ! -f "face_detection/detection/sfd/s3fd.pth" ]; then
    wget -O face_detection/detection/sfd/s3fd.pth \
        "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth"
fi

echo "=== Wav2Lip Setup Complete ==="
```

**Step 3: Create start-ltx2.sh**

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/.."

[ -f .env ] && export $(grep -v '^#' .env | xargs)

export MODEL_TYPE=ltx2
export LTX2_MODEL_PATH="${LTX2_MODEL_PATH:-/workspace/models/ltx-video}"

echo "Starting LTX-2 worker..."
python -m workers.ltx2.main
```

**Step 4: Create start-wav2lip.sh**

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/.."

[ -f .env ] && export $(grep -v '^#' .env | xargs)

export MODEL_TYPE=wav2lip
export WAV2LIP_MODEL_PATH="${WAV2LIP_MODEL_PATH:-/workspace/models/wav2lip}"

echo "Starting Wav2Lip worker..."
python -m workers.wav2lip.main
```

**Step 5: Create .env.example**

```bash
# Redis (Railway)
REDIS_URL=redis://default:xxx@xxx.railway.app:6379

# Cloudflare R2
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=xxx
R2_BUCKET=video-api-storage
R2_PUBLIC_URL=https://pub-xxx.r2.dev

# Webhook
API_WEBHOOK_URL=https://your-api.railway.app/webhook/complete
WEBHOOK_SECRET=your-webhook-secret

# Model paths (set based on worker type)
LTX2_MODEL_PATH=/workspace/models/ltx-video
WAV2LIP_MODEL_PATH=/workspace/models/wav2lip

# Worker
MAX_IDLE_SECONDS=300
```

**Step 6: Make scripts executable**

```bash
chmod +x scripts/*.sh
```

**Step 7: Commit**

```bash
git add . && git commit -m "feat: add worker setup and start scripts"
```

---

## Phase 4: Convex Integration

### Task 4.1: Update Convex Schema for Multi-Model

**Files:**
- Modify: `convex/schema.ts`

**Step 1: Add videoJobs table with model field**

```typescript
// Add to convex/schema.ts

videoJobs: defineTable({
  userId: v.id("users"),
  model: v.union(v.literal("ltx2"), v.literal("wav2lip")),

  // LTX-2 inputs
  sourceImageId: v.optional(v.id("_storage")),
  prompt: v.optional(v.string()),
  durationSeconds: v.optional(v.number()),

  // Wav2Lip inputs
  sourceVideoId: v.optional(v.id("_storage")),
  sourceAudioId: v.optional(v.id("_storage")),

  // Job state
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

  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_model", ["model"])
  .index("by_external_job", ["externalJobId"]),
```

**Step 2: Run Convex dev to apply**

```bash
npm run dev:backend
```

**Step 3: Commit**

```bash
git add convex/schema.ts && git commit -m "feat: add multi-model videoJobs table"
```

---

### Task 4.2: Create Multi-Model Convex Functions

**Files:**
- Create: `convex/videoJobs.ts`
- Create: `convex/videoJobsActions.ts`

(These files follow the same pattern as the single-model version but handle both model types)

**Step 1: Commit after creating files**

```bash
git add convex/ && git commit -m "feat: add multi-model Convex video job functions"
```

---

## Cost Summary

### Infrastructure (Fixed)
| Component | Monthly Cost |
|-----------|--------------|
| Railway (API + Redis) | ~$12 |
| Cloudflare R2 | ~$1 |

### GPU Workers (Variable by Mix)

| Mix | LTX-2 Videos | Wav2Lip Videos | GPU Hours | GPU Cost | Total |
|-----|--------------|----------------|-----------|----------|-------|
| 100% LTX-2 | 1000 | 0 | 42 hrs A100 | $28 | **~$41** |
| 50/50 | 500 | 500 | 21 hrs A100 + 3 hrs 4090 | $15 | **~$28** |
| 30/70 | 300 | 700 | 12 hrs A100 + 5 hrs 4090 | $10 | **~$23** |
| 100% Wav2Lip | 0 | 1000 | 7 hrs 4090 | $2.50 | **~$15** |

---

## Execution

**Plan complete and saved to `docs/plans/2026-01-18-multi-model-video-api-implementation.md`.**

**Two execution options:**

1. **Subagent-Driven (this session)** - Fresh subagent per task, review between tasks
2. **Parallel Session (separate)** - New session with executing-plans skill

**Which approach?**
