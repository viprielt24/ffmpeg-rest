# FFmpeg API Service - Claude Code Guidelines

## Project Overview

**Purpose:** Self-hosted FFmpeg REST API for async video processing, replacing browser-based FFmpeg WASM.

**Base Template:** Forked from [crisog/ffmpeg-rest](https://github.com/crisog/ffmpeg-rest) - Railway-optimized FFmpeg API with BullMQ job queue.

**Architecture:**
```
Client Request (POST /mux, /concatenate)
        │
        ▼
┌──────────────────┐
│  Hono API Server │ ──→ Returns jobId immediately
└──────────────────┘
        │
        ▼ (adds to queue)
┌──────────────────┐
│  Redis (BullMQ)  │ ← Job Queue with retries
└──────────────────┘
        │
        ▼ (workers pull jobs)
┌──────────────────┐
│  FFmpeg Worker   │ ──→ Download → Process → Upload
└──────────────────┘
        │
        ▼
┌──────────────────┐
│  Cloudflare R2   │ ← S3-compatible storage
└──────────────────┘
        │
        ▼
   Webhook callback (optional)
   or client polls GET /jobs/:id
```

**Tech Stack:**
| Component | Technology | Notes |
|-----------|------------|-------|
| Runtime | Node.js 20+ | LTS version |
| Framework | Hono | Lightweight, Express-like API |
| Validation | Zod + @hono/zod-openapi | Type-safe with auto OpenAPI docs |
| Job Queue | BullMQ | Redis-backed, retries, progress |
| Storage | Cloudflare R2 | S3-compatible, zero egress fees |
| Deployment | Railway | Docker containers, auto-scaling |
| Language | TypeScript | Strict mode required |

---

## Custom Endpoints to Implement

The base template provides video/audio conversion. **Add these endpoints:**

### POST /mux
Combine video and audio tracks into single MP4.

```typescript
// Request
{
  videoUrl: string;      // URL to video file
  audioUrl: string;      // URL to audio file
  duration?: number;     // Optional: trim to duration (seconds)
  webhookUrl?: string;   // Optional: callback on completion
}

// Response (202 Accepted)
{
  success: true;
  jobId: string;
  status: "queued";
}
```

### POST /concatenate
Join multiple video files sequentially.

```typescript
// Request
{
  videoUrls: string[];   // Array of video URLs (min 2)
  webhookUrl?: string;   // Optional: callback on completion
}

// Response (202 Accepted)
{
  success: true;
  jobId: string;
  status: "queued";
}
```

### GET /jobs/:jobId
Poll job status (already in template, extend if needed).

---

## Relevant Skills & When to Use Them

| Skill | When to Use |
|-------|-------------|
| `media-processing` | FFmpeg command construction, encoding options, filters |
| `api-expert` | REST design, error responses (RFC 7807), rate limiting |
| `typescript-patterns` | Type definitions, Zod schemas, discriminated unions |
| `redis-inspect` | Debug BullMQ queue state, check job status |
| `railway:deploy` | Deploy to Railway |
| `railway:logs` | View deployment/build logs |
| `railway:domain` | Generate public domain for API |
| `railway:environment` | Set environment variables |
| `railway:database` | Add Redis service |
| `superpowers:test-driven-development` | Write tests before implementation |
| `superpowers:verification-before-completion` | Verify builds pass before committing |

**MCP Servers Available:**
- `context7` - Fetch up-to-date docs for Hono, BullMQ, Zod, AWS SDK
- `Railway` - Direct Railway CLI operations

---

## TypeScript Standards

### Strict Mode Required
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitAny": true
  }
}
```

### Interface Naming Convention
Use `I` prefix for all interfaces:
```typescript
// ✅ Correct
interface IMuxRequest {
  videoUrl: string;
  audioUrl: string;
}

// ❌ Wrong
interface MuxRequest { ... }
type MuxRequestType = { ... }
```

### Zod Schema Patterns
```typescript
import { z } from 'zod';

// Define schema with Zod
export const muxRequestSchema = z.object({
  videoUrl: z.string().url(),
  audioUrl: z.string().url(),
  duration: z.number().positive().optional(),
  webhookUrl: z.string().url().optional(),
});

// Infer TypeScript type from schema
export type IMuxRequest = z.infer<typeof muxRequestSchema>;
```

### ABSOLUTE PROHIBITION: `any` Type
Never use `any`. Use `unknown` with type guards:
```typescript
// ❌ FORBIDDEN
function process(data: any) { ... }

// ✅ Correct
function process(data: unknown): void {
  if (isMuxRequest(data)) {
    // data is now typed as IMuxRequest
  }
}
```

---

## Error Handling Standards

### RFC 7807 Problem Details Format
All error responses MUST use this format:
```typescript
interface IApiError {
  type: string;           // Error type URI
  title: string;          // Human-readable title
  status: number;         // HTTP status code
  detail: string;         // Specific error message
  instance?: string;      // Request path
  correlationId: string;  // For log tracing
}

// Example response
{
  "type": "https://api.example.com/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "videoUrl must be a valid URL",
  "instance": "/mux",
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

### Error Handler Middleware
```typescript
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'crypto';

app.onError((err, c) => {
  const correlationId = randomUUID();

  // Log with correlation ID for tracing
  console.error(`[${correlationId}] Error:`, err.message);

  if (err instanceof HTTPException) {
    return c.json({
      type: `https://api.example.com/errors/${err.status}`,
      title: getStatusTitle(err.status),
      status: err.status,
      detail: err.message,
      instance: c.req.path,
      correlationId,
    }, err.status);
  }

  // Never expose internal errors
  return c.json({
    type: 'https://api.example.com/errors/internal',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred',
    instance: c.req.path,
    correlationId,
  }, 500);
});
```

### Job Error Handling
```typescript
// Worker error handling with retries
worker.on('failed', async (job, err) => {
  const attempt = job?.attemptsMade ?? 0;
  const maxAttempts = 3;

  console.error(`[job:${job?.id}] Failed (attempt ${attempt}/${maxAttempts}):`, err.message);

  if (job?.data.webhookUrl && attempt >= maxAttempts) {
    await sendWebhook(job.data.webhookUrl, job.id!, 'failed', undefined, err.message);
  }
});
```

---

## Logging Standards

### Structured Logging Format
Use consistent log format with correlation IDs:
```typescript
// Log levels: debug, info, warn, error
function log(level: string, correlationId: string, message: string, data?: object) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId,
    message,
    ...data,
  }));
}

// Usage
log('info', correlationId, 'Job started', { jobId, type: 'mux' });
log('error', correlationId, 'FFmpeg failed', { jobId, exitCode: 1, stderr });
```

### Log Context Patterns
```typescript
// API request logging
app.use(async (c, next) => {
  const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
  c.set('correlationId', correlationId);

  const start = Date.now();
  await next();

  log('info', correlationId, 'Request completed', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

// Job processing logging
async function processJob(job: Job<IJobData>): Promise<IJobResult> {
  const correlationId = job.id!;

  log('info', correlationId, 'Processing started', { type: job.data.type });
  // ... processing
  log('info', correlationId, 'Processing completed', { durationMs });
}
```

---

## FFmpeg Command Patterns

### Mux Video + Audio
```bash
ffmpeg -y \
  -i video.mp4 \
  -i audio.mp3 \
  -c:v libx264 -preset fast -crf 23 \
  -c:a aac -ar 48000 -ac 2 \
  -shortest \
  -movflags +faststart \
  output.mp4
```

### Concatenate Videos
```bash
# Create concat list file
echo "file 'video1.mp4'" > list.txt
echo "file 'video2.mp4'" >> list.txt

# Concatenate
ffmpeg -y \
  -f concat -safe 0 \
  -i list.txt \
  -c copy \
  output.mp4
```

### Progress Tracking
Parse FFmpeg stderr for progress:
```typescript
// FFmpeg outputs progress to stderr
proc.stderr.on('data', (data: Buffer) => {
  const line = data.toString();
  const match = line.match(/time=(\d+):(\d+):(\d+)/);
  if (match) {
    const [, h, m, s] = match;
    const currentSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s);
    const progress = Math.min(99, Math.round((currentSeconds / expectedDuration) * 100));
    job.updateProgress(progress);
  }
});
```

---

## Security Requirements

### API Key Authentication
```typescript
import { createMiddleware } from 'hono/factory';

export const authMiddleware = createMiddleware(async (c, next) => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    throw new HTTPException(500, { message: 'API_KEY not configured' });
  }

  const authHeader = c.req.header('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(Buffer.from(token), Buffer.from(apiKey))) {
    throw new HTTPException(403, { message: 'Invalid API key' });
  }

  await next();
});
```

### Input Validation (OWASP API3)
Always validate with Zod before processing:
```typescript
import { zValidator } from '@hono/zod-validator';

app.post('/mux',
  authMiddleware,
  zValidator('json', muxRequestSchema),
  async (c) => {
    const data = c.req.valid('json'); // Type-safe, validated
    // ...
  }
);
```

### URL Validation (OWASP API7 - SSRF Prevention)
Validate URLs before downloading:
```typescript
function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow HTTPS
    if (parsed.protocol !== 'https:') return false;

    // Block private/internal IPs
    const host = parsed.hostname;
    if (host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        host.startsWith('172.')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
```

### Rate Limiting (OWASP API4)
```typescript
// Per-endpoint rate limits
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimiter.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimiter.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}
```

---

## BullMQ Job Queue Patterns

### Job Definition
```typescript
// Job types with discriminated union
type IJobData =
  | { type: 'mux'; videoUrl: string; audioUrl: string; duration?: number; webhookUrl?: string }
  | { type: 'concatenate'; videoUrls: string[]; webhookUrl?: string };

interface IJobResult {
  resultUrl: string;
  fileSizeBytes: number;
  processingTimeMs: number;
}
```

### Queue Configuration
```typescript
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

export const jobQueue = new Queue<IJobData>('ffmpeg-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});
```

### Worker Setup
```typescript
const worker = new Worker<IJobData, IJobResult>(
  'ffmpeg-jobs',
  async (job) => {
    switch (job.data.type) {
      case 'mux':
        return processMuxJob(job);
      case 'concatenate':
        return processConcatenateJob(job);
      default:
        throw new Error(`Unknown job type`);
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '2'),
  }
);
```

---

## Testing Standards

### TDD Approach
Write tests before implementation. Use Vitest (already in template).

```typescript
// tests/mux.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/index';

describe('POST /mux', () => {
  it('returns 401 without auth header', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ videoUrl: 'https://example.com/v.mp4', audioUrl: 'https://example.com/a.mp3' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(401);
  });

  it('returns 422 for invalid URL', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({ videoUrl: 'not-a-url', audioUrl: 'https://example.com/a.mp3' }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_KEY}`,
      },
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.type).toContain('validation');
  });

  it('returns 202 with jobId for valid request', async () => {
    const res = await app.request('/mux', {
      method: 'POST',
      body: JSON.stringify({
        videoUrl: 'https://example.com/video.mp4',
        audioUrl: 'https://example.com/audio.mp3'
      }),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_KEY}`,
      },
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.jobId).toBeDefined();
    expect(body.status).toBe('queued');
  });
});
```

### Run Tests
```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

---

## Railway Deployment

### Environment Variables
Set in Railway Dashboard for both API and Worker services:

```bash
# Required
API_KEY=your-secure-api-key-here
REDIS_URL=${{Redis.REDIS_URL}}  # Railway reference

# Storage (Cloudflare R2)
STORAGE_MODE=s3
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=your-r2-access-key
S3_SECRET_KEY=your-r2-secret-key
S3_BUCKET=ffmpeg-output
S3_PUBLIC_URL=https://your-public-bucket-url.com

# Worker config
WORKER_CONCURRENCY=2

# Optional deduplication (from template)
S3_DEDUP_ENABLED=true
S3_DEDUP_TTL_DAYS=90
```

### Services Setup
1. **ffmpeg-api** - Main API service (Dockerfile.server)
2. **ffmpeg-worker** - Job processor (Dockerfile.worker)
3. **Redis** - Add from Railway's database templates

### Deployment Commands
```bash
# Using Railway MCP
railway:deploy         # Deploy current directory
railway:logs           # View logs
railway:domain         # Generate public domain
railway:environment    # View/set env vars
```

---

## File Structure (After Fork)

```
ffmpeg-rest/
├── src/
│   ├── index.ts              # Hono app setup, routes
│   ├── worker.ts             # BullMQ worker entry
│   ├── routes/
│   │   ├── mux.ts            # POST /mux (NEW)
│   │   ├── concatenate.ts    # POST /concatenate (NEW)
│   │   ├── jobs.ts           # GET /jobs/:id
│   │   └── health.ts         # GET /health
│   ├── services/
│   │   ├── queue.ts          # BullMQ setup
│   │   ├── ffmpeg.ts         # FFmpeg command execution
│   │   ├── storage.ts        # S3 upload/download
│   │   └── webhook.ts        # Webhook notifications
│   ├── middleware/
│   │   ├── auth.ts           # API key validation (NEW)
│   │   ├── logging.ts        # Request logging (NEW)
│   │   └── error.ts          # Error handler
│   ├── schemas/
│   │   ├── mux.ts            # Zod schema for /mux (NEW)
│   │   ├── concatenate.ts    # Zod schema for /concatenate (NEW)
│   │   └── common.ts         # Shared schemas
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── tests/
│   ├── mux.test.ts           # /mux endpoint tests (NEW)
│   ├── concatenate.test.ts   # /concatenate tests (NEW)
│   └── integration/          # E2E tests
├── Dockerfile.server
├── Dockerfile.worker
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Quick Reference Commands

```bash
# Development
npm run dev           # Start API server
npm run dev:worker    # Start worker

# Testing
npm test              # Run tests
npm run lint          # Lint code

# Build
npm run build         # TypeScript compile

# Docker
docker-compose up -d  # Start Redis locally

# Git
git checkout -b feature/mux-endpoint
git add . && git commit -m "feat: add /mux endpoint"
```

---

## Implementation Checklist

### Phase 1: Fork & Setup
- [ ] Fork crisog/ffmpeg-rest repository
- [ ] Clone to local development
- [ ] Run existing template locally
- [ ] Verify health endpoint works

### Phase 2: Add Authentication
- [ ] Create auth middleware
- [ ] Add API_KEY environment variable
- [ ] Write auth tests
- [ ] Apply to all endpoints except /health

### Phase 3: Implement /mux Endpoint
- [ ] Create Zod schema (schemas/mux.ts)
- [ ] Write failing tests (TDD)
- [ ] Implement route handler
- [ ] Implement FFmpeg mux function
- [ ] Add job processor in worker
- [ ] Test with real files

### Phase 4: Implement /concatenate Endpoint
- [ ] Create Zod schema
- [ ] Write failing tests
- [ ] Implement route handler
- [ ] Implement FFmpeg concat function
- [ ] Add job processor
- [ ] Test with real files

### Phase 5: Add Webhook Support
- [ ] Implement webhook service
- [ ] Add webhookUrl to job data
- [ ] Call webhook on job completion/failure
- [ ] Test webhook delivery

### Phase 6: Deploy to Railway
- [ ] Push to GitHub
- [ ] Create Railway project
- [ ] Add Redis service
- [ ] Deploy API service
- [ ] Deploy Worker service
- [ ] Set environment variables
- [ ] Generate public domain
- [ ] Test production endpoints

### Phase 7: Integrate with Client App
- [ ] Add Convex actions
- [ ] Update existing video generation
- [ ] Test end-to-end flow
