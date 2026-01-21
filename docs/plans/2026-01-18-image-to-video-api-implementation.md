# Image-to-Video API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted image-to-video generation API using LTX-2, deployed on Railway with GPU workers on Vast.ai.

**Architecture:** Node.js/Hono API server on Railway handles requests and job queuing via BullMQ. Python GPU workers on Vast.ai pull jobs, run LTX-2 inference, and upload results to Cloudflare R2. Convex app integrates via HTTP API and webhooks.

**Tech Stack:** Node.js 20, Hono, BullMQ, Redis, Postgres, Python 3.12, PyTorch, LTX-2, Cloudflare R2, Railway, Vast.ai

**Reference:** See `docs/plans/2026-01-18-image-to-video-api-design.md` for full design details.

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
  "description": "Image-to-video generation API using LTX-2",
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
    "@hono/zod-openapi": "^1.1.3",
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
cd ../video-api && git init && git add . && git commit -m "chore: initialize video-api project"
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

### Task 1.3: Create BullMQ Queue Module

**Files:**
- Create: `../video-api/src/lib/queue.ts`
- Test: `../video-api/src/lib/queue.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/queue.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getVideoQueue, addVideoJob, getJobById } from "./queue.js";

describe("Video Queue", () => {
  it("should create a queue instance", () => {
    const queue = getVideoQueue();
    expect(queue).toBeDefined();
    expect(queue.name).toBe("video-generation");
  });

  it("should add a job to the queue", async () => {
    const jobData = {
      image_url: "https://example.com/image.jpg",
      prompt: "Test prompt",
      duration: 5,
      webhook_url: "https://example.com/webhook",
    };

    const job = await addVideoJob(jobData);

    expect(job.id).toBeDefined();
    expect(job.data).toEqual(jobData);
  });

  it("should retrieve a job by ID", async () => {
    const jobData = {
      image_url: "https://example.com/image2.jpg",
      prompt: "Another test",
      duration: 5,
    };

    const addedJob = await addVideoJob(jobData);
    const retrievedJob = await getJobById(addedJob.id!);

    expect(retrievedJob).toBeDefined();
    expect(retrievedJob?.data.image_url).toBe(jobData.image_url);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/lib/queue.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/lib/queue.ts
import { Queue, Job } from "bullmq";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";

export interface VideoJobData {
  image_url: string;
  prompt?: string;
  duration: number;
  webhook_url?: string;
}

export interface VideoJobResult {
  video_url: string;
}

let videoQueue: Queue<VideoJobData, VideoJobResult> | null = null;

export function getVideoQueue(): Queue<VideoJobData, VideoJobResult> {
  if (!videoQueue) {
    videoQueue = new Queue<VideoJobData, VideoJobResult>("video-generation", {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          age: 24 * 3600, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // 7 days
        },
      },
    });

    logger.info("Video queue initialized");
  }

  return videoQueue;
}

export async function addVideoJob(
  data: VideoJobData
): Promise<Job<VideoJobData, VideoJobResult>> {
  const queue = getVideoQueue();
  const job = await queue.add("generate-video", data);
  logger.info({ jobId: job.id }, "Video job added to queue");
  return job;
}

export async function getJobById(
  jobId: string
): Promise<Job<VideoJobData, VideoJobResult> | undefined> {
  const queue = getVideoQueue();
  return queue.getJob(jobId);
}

export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const queue = getVideoQueue();
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);

  return {
    pending: waiting,
    processing: active,
    completed,
    failed,
  };
}

export async function closeQueue(): Promise<void> {
  if (videoQueue) {
    await videoQueue.close();
    videoQueue = null;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test:run -- src/lib/queue.test.ts
```

Expected: PASS (requires Redis running locally)

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add BullMQ video queue module with tests"
```

---

### Task 1.4: Create R2 Storage Module

**Files:**
- Create: `../video-api/src/lib/storage.ts`
- Test: `../video-api/src/lib/storage.test.ts`

**Step 1: Write the failing test**

```typescript
// src/lib/storage.test.ts
import { describe, it, expect, vi } from "vitest";
import { getPresignedUploadUrl, getPresignedDownloadUrl } from "./storage.js";

// Mock AWS SDK
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://presigned-url.example.com"),
}));

describe("Storage", () => {
  it("should generate presigned upload URL", async () => {
    const result = await getPresignedUploadUrl("job-123", "image/jpeg");

    expect(result.uploadUrl).toBeDefined();
    expect(result.expiresIn).toBe(3600);
  });

  it("should generate presigned download URL", async () => {
    const result = await getPresignedDownloadUrl("job-123");

    expect(result.downloadUrl).toBeDefined();
    expect(result.expiresIn).toBe(86400);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/lib/storage.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/lib/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./config.js";

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

export async function getPresignedUploadUrl(
  jobId: string,
  contentType: string
): Promise<{ uploadUrl: string; expiresIn: number }> {
  const client = getS3Client();
  const expiresIn = 3600; // 1 hour

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: `inputs/${jobId}/input.jpg`,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  return { uploadUrl, expiresIn };
}

export async function getPresignedDownloadUrl(
  jobId: string
): Promise<{ downloadUrl: string; expiresIn: number }> {
  const client = getS3Client();
  const expiresIn = 86400; // 24 hours

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
```

**Step 4: Run test to verify it passes**

```bash
npm run test:run -- src/lib/storage.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add R2 storage module with presigned URLs"
```

---

## Phase 2: API Routes

### Task 2.1: Create Zod Schemas

**Files:**
- Create: `../video-api/src/schemas/job.ts`

**Step 1: Create job schemas**

```typescript
// src/schemas/job.ts
import { z } from "zod";

export const GenerateRequestSchema = z.object({
  image_url: z.string().url(),
  prompt: z.string().optional(),
  duration: z.number().int().min(1).max(10).default(5),
  webhook_url: z.string().url().optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const GenerateResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  created_at: z.string().datetime(),
});

export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

export const JobStatusResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  progress: z.number().min(0).max(100).optional(),
  result_url: z.string().url().optional(),
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});

export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;

export const PresignUploadRequestSchema = z.object({
  job_id: z.string(),
  content_type: z.string().default("image/jpeg"),
});

export type PresignUploadRequest = z.infer<typeof PresignUploadRequestSchema>;

export const PresignUploadResponseSchema = z.object({
  upload_url: z.string().url(),
  expires_in: z.number(),
});

export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;

export const WebhookPayloadSchema = z.object({
  job_id: z.string(),
  status: z.enum(["completed", "failed"]),
  video_url: z.string().url().optional(),
  error: z.string().optional(),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add Zod schemas for API requests/responses"
```

---

### Task 2.2: Create Auth Middleware

**Files:**
- Create: `../video-api/src/middleware/auth.ts`
- Test: `../video-api/src/middleware/auth.test.ts`

**Step 1: Write the failing test**

```typescript
// src/middleware/auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "./auth.js";

// Mock config
vi.mock("../lib/config.js", () => ({
  env: {
    API_KEY: "test-api-key",
  },
}));

describe("Auth Middleware", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use("/*", authMiddleware);
    app.get("/test", (c) => c.json({ success: true }));
  });

  it("should reject requests without authorization header", async () => {
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing authorization header");
  });

  it("should reject requests with invalid token", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("should allow requests with valid token", async () => {
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer test-api-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/middleware/auth.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

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

**Step 4: Run test to verify it passes**

```bash
npm run test:run -- src/middleware/auth.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add API key auth middleware with tests"
```

---

### Task 2.3: Create Health Route

**Files:**
- Create: `../video-api/src/routes/health.ts`
- Test: `../video-api/src/routes/health.test.ts`

**Step 1: Write the failing test**

```typescript
// src/routes/health.test.ts
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import healthRoutes from "./health.js";

// Mock dependencies
vi.mock("../lib/redis.js", () => ({
  getRedis: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}));

vi.mock("../lib/queue.js", () => ({
  getQueueStats: vi.fn().mockResolvedValue({
    pending: 5,
    processing: 1,
    completed: 100,
    failed: 2,
  }),
}));

describe("Health Routes", () => {
  const app = new Hono().route("/", healthRoutes);

  it("GET /health should return health status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.api).toBe("ok");
    expect(body.redis).toBe("ok");
    expect(body.queue).toEqual({
      pending: 5,
      processing: 1,
      completed: 100,
      failed: 2,
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/routes/health.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/routes/health.ts
import { Hono } from "hono";
import { getRedis } from "../lib/redis.js";
import { getQueueStats } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

const health = new Hono();

health.get("/health", async (c) => {
  const checks = {
    api: "ok" as const,
    redis: "unknown" as string,
    queue: { pending: 0, processing: 0, completed: 0, failed: 0 },
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

  // Get queue stats
  try {
    checks.queue = await getQueueStats();
  } catch (err) {
    logger.error({ err }, "Queue stats check failed");
  }

  const healthy = checks.redis === "ok";

  return c.json(checks, healthy ? 200 : 503);
});

export default health;
```

**Step 4: Run test to verify it passes**

```bash
npm run test:run -- src/routes/health.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add health check route with tests"
```

---

### Task 2.4: Create Generate Route

**Files:**
- Create: `../video-api/src/routes/generate.ts`
- Test: `../video-api/src/routes/generate.test.ts`

**Step 1: Write the failing test**

```typescript
// src/routes/generate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import generateRoutes from "./generate.js";

// Mock queue
vi.mock("../lib/queue.js", () => ({
  addVideoJob: vi.fn().mockResolvedValue({
    id: "job-123",
    data: {
      image_url: "https://example.com/image.jpg",
      prompt: "Test prompt",
      duration: 5,
    },
  }),
}));

describe("Generate Routes", () => {
  const app = new Hono().route("/api/v1", generateRoutes);

  it("POST /api/v1/generate should create a job", async () => {
    const res = await app.request("/api/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "https://example.com/image.jpg",
        prompt: "A cinematic video",
        duration: 5,
      }),
    });

    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.job_id).toBe("job-123");
    expect(body.status).toBe("queued");
    expect(body.created_at).toBeDefined();
  });

  it("POST /api/v1/generate should validate input", async () => {
    const res = await app.request("/api/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: "not-a-url",
      }),
    });

    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/routes/generate.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

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
      const job = await addVideoJob({
        image_url: data.image_url,
        prompt: data.prompt,
        duration: data.duration,
        webhook_url: data.webhook_url,
      });

      logger.info({ jobId: job.id }, "Video generation job created");

      return c.json(
        {
          job_id: job.id,
          status: "queued" as const,
          created_at: new Date().toISOString(),
        },
        201
      );
    } catch (err) {
      logger.error({ err }, "Failed to create video job");
      return c.json({ error: "Failed to create job" }, 500);
    }
  }
);

export default generate;
```

**Step 4: Add zod-validator dependency and run test**

```bash
npm install @hono/zod-validator
npm run test:run -- src/routes/generate.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add generate video route with validation"
```

---

### Task 2.5: Create Jobs Route

**Files:**
- Create: `../video-api/src/routes/jobs.ts`
- Test: `../video-api/src/routes/jobs.test.ts`

**Step 1: Write the failing test**

```typescript
// src/routes/jobs.test.ts
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import jobsRoutes from "./jobs.js";

// Mock queue
vi.mock("../lib/queue.js", () => ({
  getJobById: vi.fn().mockImplementation((id) => {
    if (id === "job-123") {
      return Promise.resolve({
        id: "job-123",
        data: { image_url: "https://example.com/image.jpg" },
        timestamp: Date.now(),
        finishedOn: null,
        returnvalue: null,
        failedReason: null,
        getState: vi.fn().mockResolvedValue("waiting"),
        progress: 0,
      });
    }
    return Promise.resolve(undefined);
  }),
}));

describe("Jobs Routes", () => {
  const app = new Hono().route("/api/v1", jobsRoutes);

  it("GET /api/v1/jobs/:id should return job status", async () => {
    const res = await app.request("/api/v1/jobs/job-123");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.job_id).toBe("job-123");
    expect(body.status).toBeDefined();
  });

  it("GET /api/v1/jobs/:id should return 404 for unknown job", async () => {
    const res = await app.request("/api/v1/jobs/unknown-id");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:run -- src/routes/jobs.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/routes/jobs.ts
import { Hono } from "hono";
import { getJobById } from "../lib/queue.js";
import { getOutputUrl } from "../lib/storage.js";
import { logger } from "../lib/logger.js";

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

jobs.get("/jobs/:id", async (c) => {
  const jobId = c.req.param("id");

  try {
    const job = await getJobById(jobId);

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    const state = await job.getState();
    const status = mapJobState(state);

    const response: {
      job_id: string;
      status: string;
      progress?: number;
      result_url?: string;
      error_message?: string;
      created_at: string;
      completed_at?: string;
    } = {
      job_id: job.id!,
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

**Step 4: Run test to verify it passes**

```bash
npm run test:run -- src/routes/jobs.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add job status route"
```

---

### Task 2.6: Create Storage Routes

**Files:**
- Create: `../video-api/src/routes/storage.ts`

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
    const { job_id, content_type } = c.req.valid("json");

    try {
      const result = await getPresignedUploadUrl(job_id, content_type);
      return c.json({
        upload_url: result.uploadUrl,
        expires_in: result.expiresIn,
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

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add storage presigned URL routes"
```

---

### Task 2.7: Create Webhook Route

**Files:**
- Create: `../video-api/src/routes/webhooks.ts`

**Step 1: Create webhook route**

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
    // Verify webhook secret
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
      const job = await getJobById(payload.job_id);

      if (!job) {
        logger.warn({ jobId: payload.job_id }, "Webhook for unknown job");
        return c.json({ error: "Job not found" }, 404);
      }

      // Job state is managed by BullMQ worker
      // This webhook is for external notifications
      // Forward to external webhook if configured
      if (job.data.webhook_url) {
        try {
          await fetch(job.data.webhook_url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
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

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add webhook completion route"
```

---

### Task 2.8: Create Main App Entry Point

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

// Validate environment
validateEnv();

const app = new Hono();

// Global middleware
app.use("*", cors());
app.use("*", honoLogger());

// Public routes (no auth)
app.route("/", healthRoutes);

// Internal webhook route (uses webhook secret, not API key)
app.route("/", webhooksRoutes);

// Protected routes (require API key)
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
logger.info({ port }, "Starting server");

serve({
  fetch: app.fetch,
  port,
});

export default app;
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add main app entry point with all routes"
```

---

### Task 2.9: Create Dockerfile and Railway Config

**Files:**
- Create: `../video-api/Dockerfile`
- Create: `../video-api/railway.toml`

**Step 1: Create Dockerfile**

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
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

## Phase 3: GPU Worker (Python)

### Task 3.1: Create GPU Worker Project Structure

**Files:**
- Create: `../gpu-worker/requirements.txt`
- Create: `../gpu-worker/worker/__init__.py`
- Create: `../gpu-worker/worker/config.py`

**Step 1: Create project directory**

```bash
mkdir -p ../gpu-worker/worker ../gpu-worker/scripts
cd ../gpu-worker
```

**Step 2: Create requirements.txt**

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
python-dotenv>=1.0.0
```

**Step 3: Create worker/__init__.py**

```python
# worker/__init__.py
"""GPU Worker for video generation."""
```

**Step 4: Create worker/config.py**

```python
# worker/config.py
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")
    R2_ENDPOINT: str = os.environ.get("R2_ENDPOINT", "")
    R2_ACCESS_KEY: str = os.environ.get("R2_ACCESS_KEY", "")
    R2_SECRET_KEY: str = os.environ.get("R2_SECRET_KEY", "")
    R2_BUCKET: str = os.environ.get("R2_BUCKET", "video-api-storage")
    R2_PUBLIC_URL: str = os.environ.get("R2_PUBLIC_URL", "")
    API_WEBHOOK_URL: str = os.environ.get("API_WEBHOOK_URL", "")
    WEBHOOK_SECRET: str = os.environ.get("WEBHOOK_SECRET", "")
    MODEL_PATH: str = os.environ.get("MODEL_PATH", "Lightricks/LTX-Video")
    MAX_IDLE_SECONDS: int = int(os.environ.get("MAX_IDLE_SECONDS", "300"))


settings = Settings()
```

**Step 5: Commit**

```bash
cd ../gpu-worker && git init && git add . && git commit -m "chore: initialize gpu-worker project"
```

---

### Task 3.2: Create Queue Client

**Files:**
- Create: `../gpu-worker/worker/queue_client.py`

**Step 1: Create BullMQ-compatible queue client**

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

    def __init__(self, redis_url: str, queue_name: str = "video-generation"):
        self.redis = redis.from_url(redis_url)
        self.queue_name = queue_name
        self.prefix = f"bull:{queue_name}"
        logger.info(f"Connected to Redis queue: {queue_name}")

    def get_next_job(self, timeout: int = 5) -> dict | None:
        """Pop next job from waiting queue."""
        try:
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
                logger.warning(f"Job {job_id} has no data")
                return None

            data = json.loads(job_data.get(b"data", b"{}").decode())

            logger.info(f"Got job {job_id} from queue")
            return {"id": job_id, **data}

        except Exception as e:
            logger.error(f"Error getting job from queue: {e}")
            return None

    def mark_completed(self, job_id: str, result: dict) -> None:
        """Move job to completed state."""
        try:
            now = int(time.time() * 1000)

            # Update job hash
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={
                    "returnvalue": json.dumps(result),
                    "finishedOn": str(now),
                    "processedOn": str(now),
                }
            )

            # Move from active to completed
            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:completed", {job_id: time.time()})

            logger.info(f"Job {job_id} marked as completed")

        except Exception as e:
            logger.error(f"Error marking job {job_id} as completed: {e}")

    def mark_failed(self, job_id: str, error: str) -> None:
        """Move job to failed state."""
        try:
            now = int(time.time() * 1000)

            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={
                    "failedReason": error,
                    "finishedOn": str(now),
                }
            )

            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:failed", {job_id: time.time()})

            logger.info(f"Job {job_id} marked as failed: {error}")

        except Exception as e:
            logger.error(f"Error marking job {job_id} as failed: {e}")

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update job progress."""
        try:
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                "progress",
                str(progress)
            )
        except Exception as e:
            logger.error(f"Error updating progress for job {job_id}: {e}")
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add BullMQ-compatible queue client"
```

---

### Task 3.3: Create Storage Client

**Files:**
- Create: `../gpu-worker/worker/storage.py`

**Step 1: Create R2 storage client**

```python
# worker/storage.py
"""Cloudflare R2 storage client."""
import boto3
from botocore.config import Config
import logging

from .config import settings

logger = logging.getLogger(__name__)


class R2Storage:
    """Cloudflare R2 storage client for input/output files."""

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
        logger.info(f"R2 storage initialized for bucket: {self.bucket}")

    def download_input(self, job_id: str, local_path: str) -> str:
        """Download input image from R2."""
        key = f"inputs/{job_id}/input.jpg"
        logger.info(f"Downloading {key} to {local_path}")

        self.s3.download_file(self.bucket, key, local_path)
        return local_path

    def upload_output(self, job_id: str, local_path: str) -> str:
        """Upload output video to R2, return public URL."""
        key = f"outputs/{job_id}/output.mp4"
        logger.info(f"Uploading {local_path} to {key}")

        self.s3.upload_file(
            local_path,
            self.bucket,
            key,
            ExtraArgs={"ContentType": "video/mp4"}
        )

        if self.public_url:
            return f"{self.public_url}/{key}"

        # Generate presigned URL if not public
        url = self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=86400 * 7  # 7 days
        )
        return url
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add R2 storage client"
```

---

### Task 3.4: Create Webhook Module

**Files:**
- Create: `../gpu-worker/worker/webhook.py`

**Step 1: Create webhook notification module**

```python
# worker/webhook.py
"""Webhook notification for job completion."""
import requests
import logging

from .config import settings

logger = logging.getLogger(__name__)


def _call_webhook(url: str, payload: dict) -> bool:
    """Make webhook HTTP call."""
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
        logger.info(f"Webhook sent to {url}")
        return True
    except Exception as e:
        logger.error(f"Webhook failed: {url} - {e}")
        return False


def notify_complete(job_id: str, video_url: str, webhook_url: str | None = None) -> None:
    """Notify API that job completed."""
    payload = {
        "job_id": job_id,
        "status": "completed",
        "video_url": video_url,
    }

    # Always notify our own API
    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)

    # Notify external webhook if provided
    if webhook_url:
        _call_webhook(webhook_url, payload)


def notify_failed(job_id: str, error: str, webhook_url: str | None = None) -> None:
    """Notify API that job failed."""
    payload = {
        "job_id": job_id,
        "status": "failed",
        "error": error,
    }

    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)

    if webhook_url:
        _call_webhook(webhook_url, payload)
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add webhook notification module"
```

---

### Task 3.5: Create Inference Module

**Files:**
- Create: `../gpu-worker/worker/inference.py`

**Step 1: Create LTX-2 inference module**

```python
# worker/inference.py
"""LTX-2 video generation inference."""
import torch
import uuid
import logging
from PIL import Image

logger = logging.getLogger(__name__)


class LTXVideoGenerator:
    """LTX-2 image-to-video generator."""

    def __init__(self, model_path: str = "Lightricks/LTX-Video"):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {self.device}")

        # Import here to avoid loading at module level
        from diffusers import LTXImageToVideoPipeline

        logger.info(f"Loading model from {model_path}...")

        self.pipeline = LTXImageToVideoPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
        )
        self.pipeline.to(self.device)

        # Enable memory optimizations
        if hasattr(self.pipeline, "enable_attention_slicing"):
            self.pipeline.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded. VRAM used: {vram:.1f}GB")

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
        """Generate video from image, return path to output file."""
        logger.info(f"Generating video: {image_path}, duration={duration}s")

        image = Image.open(image_path).convert("RGB")

        # Calculate frames (must be divisible by 8 + 1)
        num_frames = (duration * fps // 8) * 8 + 1

        # Callback wrapper for progress
        def callback_fn(pipe, step, timestep, callback_kwargs):
            if progress_callback:
                progress = int((step / num_inference_steps) * 100)
                progress_callback(progress)
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

        # Export to video file
        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"
        self._export_video(result.frames[0], output_path, fps)

        logger.info(f"Video generated: {output_path}")
        return output_path

    def _export_video(self, frames, output_path: str, fps: int) -> None:
        """Export frames to MP4 video."""
        import imageio

        logger.info(f"Exporting {len(frames)} frames to {output_path}")

        writer = imageio.get_writer(output_path, fps=fps, codec="libx264")
        for frame in frames:
            writer.append_data(frame)
        writer.close()
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add LTX-2 inference module"
```

---

### Task 3.6: Create Main Worker Loop

**Files:**
- Create: `../gpu-worker/worker/main.py`

**Step 1: Create main worker entry point**

```python
# worker/main.py
"""Main worker loop for video generation."""
import time
import os
import logging

from .config import settings
from .queue_client import BullMQClient
from .inference import LTXVideoGenerator
from .storage import R2Storage
from .webhook import notify_complete, notify_failed

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def main():
    """Main worker loop."""
    logger.info("=== Starting GPU Worker ===")

    # Initialize components
    logger.info("Loading LTX-2 model...")
    generator = LTXVideoGenerator(settings.MODEL_PATH)

    logger.info("Connecting to Redis queue...")
    queue = BullMQClient(settings.REDIS_URL, "video-generation")

    logger.info("Initializing R2 storage...")
    storage = R2Storage()

    logger.info("Worker ready, polling for jobs...")
    idle_seconds = 0
    poll_interval = 5

    while True:
        job = queue.get_next_job(timeout=poll_interval)

        if job is None:
            idle_seconds += poll_interval
            if idle_seconds >= settings.MAX_IDLE_SECONDS:
                logger.info(f"Queue empty for {settings.MAX_IDLE_SECONDS}s, shutting down...")
                break
            continue

        idle_seconds = 0
        job_id = job["id"]

        logger.info(f"Processing job {job_id}")

        # Paths for temp files
        local_image = f"/tmp/{job_id}_input.jpg"
        local_video = None

        try:
            # Update progress
            queue.update_progress(job_id, 0)

            # Download input image
            logger.info(f"Downloading input image for job {job_id}")
            storage.download_input(job_id, local_image)
            queue.update_progress(job_id, 10)

            # Generate video with progress callback
            def on_progress(progress):
                # Map 0-100 to 10-90 (reserving 0-10 for download, 90-100 for upload)
                mapped_progress = 10 + int(progress * 0.8)
                queue.update_progress(job_id, mapped_progress)

            local_video = generator.generate(
                image_path=local_image,
                prompt=job.get("prompt", ""),
                duration=job.get("duration", 5),
                progress_callback=on_progress,
            )
            queue.update_progress(job_id, 90)

            # Upload result
            logger.info(f"Uploading output video for job {job_id}")
            video_url = storage.upload_output(job_id, local_video)
            queue.update_progress(job_id, 100)

            # Mark completed and notify
            queue.mark_completed(job_id, {"video_url": video_url})
            notify_complete(job_id, video_url, job.get("webhook_url"))

            logger.info(f"Job {job_id} completed successfully")

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Job {job_id} failed: {error_msg}")
            queue.mark_failed(job_id, error_msg)
            notify_failed(job_id, error_msg, job.get("webhook_url"))

        finally:
            # Cleanup temp files
            for f in [local_image, local_video]:
                if f and os.path.exists(f):
                    try:
                        os.remove(f)
                    except Exception as e:
                        logger.warning(f"Failed to cleanup {f}: {e}")

    logger.info("=== Worker shutdown complete ===")


if __name__ == "__main__":
    main()
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add main worker loop"
```

---

### Task 3.7: Create Worker Scripts

**Files:**
- Create: `../gpu-worker/scripts/setup.sh`
- Create: `../gpu-worker/scripts/start_worker.sh`
- Create: `../gpu-worker/.env.example`

**Step 1: Create setup.sh**

```bash
#!/bin/bash
# scripts/setup.sh
# Run this on first Vast.ai instance setup

set -e

echo "=== Setting up LTX-2 Worker ==="

# Update system
apt-get update && apt-get install -y git ffmpeg

# Install Python dependencies
pip install --upgrade pip
pip install -r requirements.txt

# Download LTX-2 model (cached on disk)
echo "Downloading LTX-2 model..."
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

**Step 2: Create start_worker.sh**

```bash
#!/bin/bash
# scripts/start_worker.sh
# Run this to start the worker

set -e

cd "$(dirname "$0")/.."

# Load environment from .env if exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set model path if not set
export MODEL_PATH="${MODEL_PATH:-/workspace/models/ltx-video}"

# Start worker
echo "Starting GPU worker..."
python -m worker.main
```

**Step 3: Create .env.example**

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

# Model
MODEL_PATH=/workspace/models/ltx-video

# Worker settings
MAX_IDLE_SECONDS=300
```

**Step 4: Make scripts executable**

```bash
chmod +x scripts/setup.sh scripts/start_worker.sh
```

**Step 5: Commit**

```bash
git add . && git commit -m "feat: add worker setup and start scripts"
```

---

## Phase 4: Convex Integration

### Task 4.1: Add videoJobs Table to Schema

**Files:**
- Modify: `convex/schema.ts`

**Step 1: Add videoJobs table definition**

Add to the existing schema:

```typescript
// Add to convex/schema.ts

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

  durationSeconds: v.number(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_status", ["status"])
  .index("by_external_job", ["externalJobId"]),
```

**Step 2: Run Convex dev to apply schema**

```bash
npm run dev:backend
```

**Step 3: Commit**

```bash
git add convex/schema.ts && git commit -m "feat: add videoJobs table to Convex schema"
```

---

### Task 4.2: Create videoJobs Convex Functions

**Files:**
- Create: `convex/videoJobs.ts`

**Step 1: Create Convex functions**

```typescript
// convex/videoJobs.ts
import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

// Public query - get user's video jobs
export const listByUser = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("videoJobs"),
    status: v.string(),
    prompt: v.optional(v.string()),
    outputVideoUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationSeconds: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const jobs = await ctx.db
      .query("videoJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);

    return jobs.map((job) => ({
      _id: job._id,
      status: job.status,
      prompt: job.prompt,
      outputVideoUrl: job.outputVideoUrl,
      errorMessage: job.errorMessage,
      durationSeconds: job.durationSeconds,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    }));
  },
});

// Public query - get single job
export const get = query({
  args: { jobId: v.id("videoJobs") },
  returns: v.union(v.null(), v.object({
    _id: v.id("videoJobs"),
    status: v.string(),
    prompt: v.optional(v.string()),
    outputVideoUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    durationSeconds: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) return null;

    return {
      _id: job._id,
      status: job.status,
      prompt: job.prompt,
      outputVideoUrl: job.outputVideoUrl,
      errorMessage: job.errorMessage,
      durationSeconds: job.durationSeconds,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  },
});

// Public mutation - create video job
export const create = mutation({
  args: {
    sourceImageId: v.id("_storage"),
    prompt: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
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
      durationSeconds: args.durationSeconds ?? 5,
      createdAt: Date.now(),
    });

    // Schedule the action to submit to API
    await ctx.scheduler.runAfter(0, internal.videoJobsActions.submitToApi, {
      jobId,
    });

    return jobId;
  },
});

// Internal query - get job for action
export const getJobInternal = internalQuery({
  args: { jobId: v.id("videoJobs") },
  returns: v.union(v.null(), v.object({
    sourceImageId: v.id("_storage"),
    prompt: v.optional(v.string()),
    durationSeconds: v.number(),
  })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    return {
      sourceImageId: job.sourceImageId,
      prompt: job.prompt,
      durationSeconds: job.durationSeconds,
    };
  },
});

// Internal mutation - update status
export const updateStatus = internalMutation({
  args: {
    jobId: v.id("videoJobs"),
    status: v.string(),
    externalJobId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status as "uploading" | "queued" | "processing" | "completed" | "failed",
      ...(args.externalJobId && { externalJobId: args.externalJobId }),
      ...(args.errorMessage && { errorMessage: args.errorMessage }),
    });
    return null;
  },
});

// Internal mutation - complete job
export const completeJob = internalMutation({
  args: {
    externalJobId: v.string(),
    videoUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("videoJobs")
      .withIndex("by_external_job", (q) => q.eq("externalJobId", args.externalJobId))
      .unique();

    if (job) {
      await ctx.db.patch(job._id, {
        status: "completed",
        outputVideoUrl: args.videoUrl,
        completedAt: Date.now(),
      });
    }
    return null;
  },
});

// Internal mutation - fail job
export const failJob = internalMutation({
  args: {
    externalJobId: v.string(),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("videoJobs")
      .withIndex("by_external_job", (q) => q.eq("externalJobId", args.externalJobId))
      .unique();

    if (job) {
      await ctx.db.patch(job._id, {
        status: "failed",
        errorMessage: args.errorMessage,
      });
    }
    return null;
  },
});
```

**Step 2: Commit**

```bash
git add convex/videoJobs.ts && git commit -m "feat: add videoJobs Convex mutations and queries"
```

---

### Task 4.3: Create Convex Action for API Submission

**Files:**
- Create: `convex/videoJobsActions.ts`

**Step 1: Create action file**

```typescript
// convex/videoJobsActions.ts
"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const submitToApi = internalAction({
  args: { jobId: v.id("videoJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get job details
    const job = await ctx.runQuery(internal.videoJobs.getJobInternal, {
      jobId: args.jobId,
    });

    if (!job) {
      throw new Error("Job not found");
    }

    // Get image URL from Convex storage
    const imageUrl = await ctx.storage.getUrl(job.sourceImageId);
    if (!imageUrl) {
      await ctx.runMutation(internal.videoJobs.updateStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: "Image not found in storage",
      });
      return null;
    }

    // Call Railway API
    const apiUrl = process.env.VIDEO_API_URL;
    const apiKey = process.env.VIDEO_API_KEY;
    const webhookUrl = process.env.CONVEX_SITE_URL;

    if (!apiUrl || !apiKey) {
      await ctx.runMutation(internal.videoJobs.updateStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: "Video API not configured",
      });
      return null;
    }

    try {
      const response = await fetch(`${apiUrl}/api/v1/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: job.prompt || "Generate a smooth cinematic video",
          duration: job.durationSeconds,
          webhook_url: webhookUrl ? `${webhookUrl}/api/webhooks/video-complete` : undefined,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        await ctx.runMutation(internal.videoJobs.updateStatus, {
          jobId: args.jobId,
          status: "failed",
          errorMessage: `API error: ${errorText}`,
        });
        return null;
      }

      const result = await response.json();

      await ctx.runMutation(internal.videoJobs.updateStatus, {
        jobId: args.jobId,
        status: "queued",
        externalJobId: result.job_id,
      });

    } catch (error) {
      await ctx.runMutation(internal.videoJobs.updateStatus, {
        jobId: args.jobId,
        status: "failed",
        errorMessage: `Network error: ${error}`,
      });
    }

    return null;
  },
});
```

**Step 2: Commit**

```bash
git add convex/videoJobsActions.ts && git commit -m "feat: add Convex action for video API submission"
```

---

### Task 4.4: Add Webhook HTTP Endpoint to Convex

**Files:**
- Modify: `convex/http.ts`

**Step 1: Add webhook route to http.ts**

Add the following route to the existing http router:

```typescript
// Add to convex/http.ts

import { internal } from "./_generated/api";

// Video generation webhook
http.route({
  path: "/api/webhooks/video-complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Verify webhook secret
    const secret = request.headers.get("X-Webhook-Secret");
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (expectedSecret && secret !== expectedSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const body = await request.json();
      const { job_id, status, video_url, error } = body;

      if (status === "completed" && video_url) {
        await ctx.runMutation(internal.videoJobs.completeJob, {
          externalJobId: job_id,
          videoUrl: video_url,
        });
      } else if (status === "failed") {
        await ctx.runMutation(internal.videoJobs.failJob, {
          externalJobId: job_id,
          errorMessage: error || "Unknown error",
        });
      }

      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Webhook error:", err);
      return new Response("Internal error", { status: 500 });
    }
  }),
});
```

**Step 2: Commit**

```bash
git add convex/http.ts && git commit -m "feat: add video completion webhook to Convex HTTP router"
```

---

## Phase 5: Testing & Deployment

### Task 5.1: Create Integration Test Script

**Files:**
- Create: `../video-api/scripts/test-integration.ts`

**Step 1: Create integration test**

```typescript
// scripts/test-integration.ts
/**
 * Integration test for the video API
 * Run with: npx tsx scripts/test-integration.ts
 */

const API_URL = process.env.API_URL || "http://localhost:3000";
const API_KEY = process.env.API_KEY || "test-key";

async function main() {
  console.log("🧪 Starting integration tests...\n");

  // Test 1: Health check
  console.log("1. Testing health endpoint...");
  const healthRes = await fetch(`${API_URL}/health`);
  const health = await healthRes.json();
  console.log("   Status:", healthRes.status);
  console.log("   Response:", JSON.stringify(health, null, 2));

  if (healthRes.status !== 200) {
    console.error("❌ Health check failed");
    process.exit(1);
  }
  console.log("   ✅ Health check passed\n");

  // Test 2: Generate video job
  console.log("2. Testing generate endpoint...");
  const generateRes = await fetch(`${API_URL}/api/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      image_url: "https://picsum.photos/1024/576",
      prompt: "A peaceful ocean scene with gentle waves",
      duration: 5,
    }),
  });
  const generateData = await generateRes.json();
  console.log("   Status:", generateRes.status);
  console.log("   Response:", JSON.stringify(generateData, null, 2));

  if (generateRes.status !== 201) {
    console.error("❌ Generate failed");
    process.exit(1);
  }
  console.log("   ✅ Generate passed\n");

  const jobId = generateData.job_id;

  // Test 3: Get job status
  console.log("3. Testing job status endpoint...");
  const statusRes = await fetch(`${API_URL}/api/v1/jobs/${jobId}`, {
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
    },
  });
  const statusData = await statusRes.json();
  console.log("   Status:", statusRes.status);
  console.log("   Response:", JSON.stringify(statusData, null, 2));

  if (statusRes.status !== 200) {
    console.error("❌ Job status failed");
    process.exit(1);
  }
  console.log("   ✅ Job status passed\n");

  // Test 4: Auth rejection
  console.log("4. Testing auth rejection...");
  const authRes = await fetch(`${API_URL}/api/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer wrong-key",
    },
    body: JSON.stringify({
      image_url: "https://example.com/image.jpg",
    }),
  });
  console.log("   Status:", authRes.status);

  if (authRes.status !== 401) {
    console.error("❌ Auth rejection failed");
    process.exit(1);
  }
  console.log("   ✅ Auth rejection passed\n");

  console.log("🎉 All integration tests passed!");
}

main().catch(console.error);
```

**Step 2: Commit**

```bash
git add . && git commit -m "feat: add integration test script"
```

---

### Task 5.2: Add Environment Variables Checklist

**Files:**
- Create: `../video-api/DEPLOYMENT.md`

**Step 1: Create deployment guide**

```markdown
# Deployment Guide

## Prerequisites

- Railway account
- Cloudflare account (for R2)
- Vast.ai account
- GitHub repository

## Railway Setup

### 1. Create Project

```bash
railway login
railway init
```

### 2. Add Services

```bash
railway add --database redis
railway add --database postgres  # Optional, for persistent job history
```

### 3. Set Environment Variables

```bash
railway variables set API_KEY=<generate-secure-key>
railway variables set WEBHOOK_SECRET=<generate-secure-key>
railway variables set R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
railway variables set R2_ACCESS_KEY=<r2-access-key>
railway variables set R2_SECRET_KEY=<r2-secret-key>
railway variables set R2_BUCKET=video-api-storage
railway variables set R2_PUBLIC_URL=https://pub-<id>.r2.dev
```

### 4. Deploy

```bash
railway up
```

Or connect GitHub for auto-deploy.

## Cloudflare R2 Setup

1. Create R2 bucket: `video-api-storage`
2. Create API token with R2 permissions
3. Note credentials for Railway env vars
4. (Optional) Enable public access for outputs folder

## Vast.ai Setup

### 1. Install CLI

```bash
pip install vastai
vastai set api-key <your-api-key>
```

### 2. Find A100 Instance

```bash
vastai search offers 'gpu_name=A100 gpu_ram>=40 disk_space>=150'
```

### 3. Create Instance

```bash
vastai create instance <offer-id> \
  --image pytorch/pytorch:2.4.0-cuda12.4-cudnn9-devel \
  --disk 150
```

### 4. Setup Worker

```bash
# SSH into instance
ssh root@<instance-ip> -p <port>

# Clone and setup
git clone <your-repo-url> /workspace/worker
cd /workspace/worker
bash scripts/setup.sh

# Create .env file
cp .env.example .env
# Edit .env with your credentials

# Start worker
bash scripts/start_worker.sh
```

### 5. Destroy When Done

```bash
vastai destroy instance <instance-id>
```

## Convex Setup

Add environment variables in Convex dashboard:

```
VIDEO_API_URL=https://your-app.railway.app
VIDEO_API_KEY=<same-as-railway-api-key>
WEBHOOK_SECRET=<same-as-railway-webhook-secret>
```

## Testing

```bash
# Local API testing
npm run dev
npx tsx scripts/test-integration.ts

# Production testing
API_URL=https://your-app.railway.app API_KEY=<key> npx tsx scripts/test-integration.ts
```
```

**Step 2: Commit**

```bash
git add . && git commit -m "docs: add deployment guide"
```

---

## Summary

This implementation plan covers:

1. **Phase 1**: Project setup with core libraries (config, logger, redis, queue, storage)
2. **Phase 2**: API routes (health, generate, jobs, storage, webhooks)
3. **Phase 3**: GPU worker (queue client, storage, inference, main loop)
4. **Phase 4**: Convex integration (schema, functions, actions, HTTP webhook)
5. **Phase 5**: Testing and deployment

**Total estimated tasks**: ~20 bite-sized tasks
**Each task**: 2-5 minutes with TDD approach

---

**Plan complete and saved to `docs/plans/2026-01-18-image-to-video-api-implementation.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
