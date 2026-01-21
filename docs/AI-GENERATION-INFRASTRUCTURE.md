# AI Generation Infrastructure Documentation

## Overview

The FFmpeg API Service now includes AI-powered media generation capabilities using RunPod Serverless GPUs. This document covers the available endpoints, infrastructure, and usage patterns.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Client Application                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Railway (ffmpeg-rest API)                             │
│  • Hono API Server                                                       │
│  • BullMQ Job Queue                                                      │
│  • Job status tracking                                                   │
│  • Webhook callbacks                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │   RunPod     │  │   RunPod     │  │   RunPod     │
         │   LTX-2      │  │   Z-Image    │  │   LongCat    │
         │  (L40S GPU)  │  │ (RTX A5000)  │  │ (L40S x2)    │
         └──────────────┘  └──────────────┘  └──────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                    ┌─────────────────────────────────┐
                    │     Cloudflare R2 Storage       │
                    │  (outputs uploaded here)        │
                    └─────────────────────────────────┘
```

## API Endpoints

### Base URL
```
https://ffmpeg-rest-production-850b.up.railway.app
```

### Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <API_KEY>
```

---

## AI Generation Endpoints

### POST /api/v1/generate

Create an AI generation job. Returns immediately with a `jobId` to poll for status.

#### Request Body

The request uses a discriminated union based on the `model` field:

##### LTX-2 (Image-to-Video)
```json
{
  "model": "ltx2",
  "imageUrl": "https://example.com/image.jpg",
  "prompt": "A cinematic video of the scene",
  "duration": 5,
  "width": 1024,
  "height": 576,
  "numInferenceSteps": 30,
  "guidanceScale": 7.5,
  "fps": 24,
  "webhookUrl": "https://your-app.com/webhook"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `"ltx2"` | required | Model identifier |
| `imageUrl` | string | required | URL to source image |
| `prompt` | string | optional | Text prompt for generation |
| `duration` | number | 5 | Video duration in seconds (3-10) |
| `width` | number | 1024 | Output width (512-1920) |
| `height` | number | 576 | Output height (512-1080) |
| `numInferenceSteps` | number | 30 | Diffusion steps (10-50) |
| `guidanceScale` | number | 7.5 | Prompt adherence (1-15) |
| `fps` | number | 24 | Frames per second (12-30) |
| `webhookUrl` | string | optional | Callback URL on completion |

##### Z-Image (Text-to-Image)
```json
{
  "model": "zimage",
  "prompt": "A photorealistic portrait of a businesswoman",
  "negativePrompt": "blurry, low quality",
  "width": 1024,
  "height": 1024,
  "steps": 9,
  "guidanceScale": 0,
  "seed": 42,
  "webhookUrl": "https://your-app.com/webhook"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `"zimage"` | required | Model identifier |
| `prompt` | string | required | Text prompt (English or Chinese) |
| `negativePrompt` | string | optional | Features to avoid |
| `width` | number | 1024 | Output width (512-2048) |
| `height` | number | 1024 | Output height (512-2048) |
| `steps` | number | 9 | Inference steps (8-100, use 8-9 for Turbo) |
| `guidanceScale` | number | 0 | Guidance (0 for Turbo, 1-20 for Base) |
| `seed` | number | optional | Random seed for reproducibility |
| `webhookUrl` | string | optional | Callback URL on completion |

##### LongCat (Audio-Driven Avatar)
```json
{
  "model": "longcat",
  "audioUrl": "https://example.com/speech.wav",
  "imageUrl": "https://example.com/avatar.jpg",
  "prompt": "A person speaking naturally",
  "mode": "ai2v",
  "resolution": "480P",
  "audioCfg": 4.0,
  "numSegments": 1,
  "webhookUrl": "https://your-app.com/webhook"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `"longcat"` | required | Model identifier |
| `audioUrl` | string | required | URL to audio file (WAV recommended) |
| `imageUrl` | string | optional* | Reference image URL (*required for ai2v mode) |
| `prompt` | string | optional | Character description |
| `mode` | `"at2v"` \| `"ai2v"` | `"ai2v"` | at2v=audio+text, ai2v=audio+image |
| `resolution` | `"480P"` \| `"720P"` | `"480P"` | Output resolution |
| `audioCfg` | number | 4.0 | Audio guidance scale (1-10) |
| `numSegments` | number | 1 | Segments for longer videos (1-10) |
| `webhookUrl` | string | optional | Callback URL on completion |

##### Wav2Lip (Legacy Lip-Sync)
```json
{
  "model": "wav2lip",
  "videoUrl": "https://example.com/face-video.mp4",
  "audioUrl": "https://example.com/speech.wav",
  "padTop": 0,
  "padBottom": 10,
  "padLeft": 0,
  "padRight": 0,
  "webhookUrl": "https://your-app.com/webhook"
}
```

#### Response (202 Accepted)
```json
{
  "success": true,
  "jobId": "gen_abc123",
  "model": "ltx2",
  "status": "queued",
  "message": "Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status."
}
```

---

### GET /api/v1/generate/{jobId}

Poll for job status.

#### Response Examples

**Queued:**
```json
{
  "status": "queued",
  "jobId": "gen_abc123",
  "model": "ltx2",
  "createdAt": "2026-01-21T21:00:00.000Z"
}
```

**Processing:**
```json
{
  "status": "processing",
  "jobId": "gen_abc123",
  "model": "ltx2",
  "progress": 50,
  "startedAt": "2026-01-21T21:00:05.000Z",
  "createdAt": "2026-01-21T21:00:00.000Z"
}
```

**Completed:**
```json
{
  "status": "completed",
  "jobId": "gen_abc123",
  "model": "ltx2",
  "result": {
    "url": "https://pub-xxx.r2.dev/outputs/gen_abc123/output.mp4",
    "contentType": "video/mp4",
    "fileSizeBytes": 12345678,
    "durationMs": 5000,
    "width": 1024,
    "height": 576
  },
  "processingTimeMs": 45000,
  "createdAt": "2026-01-21T21:00:00.000Z",
  "completedAt": "2026-01-21T21:00:45.000Z"
}
```

**Failed:**
```json
{
  "status": "failed",
  "jobId": "gen_abc123",
  "model": "ltx2",
  "error": "Inference failed: GPU out of memory",
  "createdAt": "2026-01-21T21:00:00.000Z",
  "failedAt": "2026-01-21T21:00:30.000Z"
}
```

---

## RunPod Infrastructure

### Endpoints

| Model | Endpoint ID | GPU Type | Max Workers | Cost/hr |
|-------|-------------|----------|-------------|---------|
| LTX-2 | `ka5cebaso9ui3x` | L40S | 2 | ~$0.86 |
| Z-Image | `d66z2s5t14ca9j` | RTX A5000/4090 | 2 | ~$0.44 |
| LongCat | `1whmb31pt9ds3s` | L40S/A100 80GB (2 GPUs) | 1 | ~$1.72 |

### Templates

| Model | Template ID | Container Disk | Volume Path |
|-------|-------------|----------------|-------------|
| LTX-2 | `haay8all8m` | 50 GB | /runpod-volume |
| Z-Image | `n5jr6vvw9b` | 30 GB | /runpod-volume |
| LongCat | `i9hqs4fjud` | 100 GB | /runpod-volume |

### Docker Images

- LTX-2: `viprielt24/ltx2-runpod:latest`
- Z-Image: `viprielt24/zimage-runpod:latest`
- LongCat: `viprielt24/longcat-avatar-runpod:latest`

### Model Loading

All models are downloaded on first cold start and cached in `/runpod-volume/cache`. This means:
- **Cold start**: 2-5 minutes (model download + load)
- **Warm start**: 10-30 seconds (model already cached)

RunPod Flashboot is enabled for faster container restarts.

---

## Storage (Cloudflare R2)

### Configuration

| Setting | Value |
|---------|-------|
| Endpoint | `https://be0982077400487f16d24690efe80293.r2.cloudflarestorage.com` |
| Bucket | `ffmpeg-output` |
| Public URL | `https://pub-c890861a94df454f9643e18e01c86fa0.r2.dev` |
| Region | `auto` |

### Output Structure
```
ffmpeg-output/
├── outputs/
│   ├── {jobId}/
│   │   └── output.{mp4|png}
│   └── ...
└── test-inputs/
    └── (test files)
```

---

## Environment Variables

### Railway (ffmpeg-rest service)

```bash
# RunPod Configuration
RUNPOD_API_KEY=rpa_xxx...
RUNPOD_LTX2_ENDPOINT_ID=ka5cebaso9ui3x
RUNPOD_ZIMAGE_ENDPOINT_ID=d66z2s5t14ca9j
RUNPOD_LONGCAT_ENDPOINT_ID=1whmb31pt9ds3s

# Storage (R2)
STORAGE_MODE=s3
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=ffmpeg-output
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
S3_PUBLIC_URL=https://pub-xxx.r2.dev

# Authentication
AUTH_TOKEN=your-api-key

# Redis
REDIS_URL=${{Redis.REDIS_URL}}
```

### RunPod Templates

Each template has these environment variables:
```bash
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=xxx
R2_BUCKET=ffmpeg-output
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

---

## Usage Examples

### cURL

```bash
# Create LTX-2 job
curl -X POST "https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ltx2",
    "imageUrl": "https://example.com/image.jpg",
    "prompt": "A cinematic scene",
    "duration": 5
  }'

# Poll for status
curl "https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate/gen_abc123" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### JavaScript/TypeScript

```typescript
const API_URL = 'https://ffmpeg-rest-production-850b.up.railway.app';
const API_KEY = 'your-api-key';

// Create job
const response = await fetch(`${API_URL}/api/v1/generate`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'zimage',
    prompt: 'A beautiful sunset over mountains',
    width: 1024,
    height: 1024,
  }),
});

const { jobId } = await response.json();

// Poll for completion
const pollForResult = async (jobId: string): Promise<string> => {
  while (true) {
    const status = await fetch(`${API_URL}/api/v1/generate/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    }).then(r => r.json());

    if (status.status === 'completed') {
      return status.result.url;
    }
    if (status.status === 'failed') {
      throw new Error(status.error);
    }

    await new Promise(r => setTimeout(r, 2000)); // Poll every 2s
  }
};

const resultUrl = await pollForResult(jobId);
console.log('Generated image:', resultUrl);
```

---

## Webhook Callbacks

If `webhookUrl` is provided, the API will POST to it when the job completes:

```json
{
  "jobId": "gen_abc123",
  "status": "completed",
  "result": {
    "url": "https://pub-xxx.r2.dev/outputs/gen_abc123/output.mp4",
    "fileSizeBytes": 12345678,
    "processingTimeMs": 45000
  }
}
```

Or on failure:
```json
{
  "jobId": "gen_abc123",
  "status": "failed",
  "error": "Inference failed: GPU out of memory"
}
```

---

## Model Capabilities

### LTX-2 (Lightricks LTX-Video)
- **Task**: Image-to-Video generation
- **Input**: Single image + text prompt
- **Output**: MP4 video (3-10 seconds)
- **Quality**: High-quality cinematic video
- **VRAM**: ~20GB recommended

### Z-Image (Z-Image-Turbo)
- **Task**: Text-to-Image generation
- **Input**: Text prompt (English or Chinese)
- **Output**: PNG image
- **Speed**: Sub-second inference (8-9 steps)
- **Quality**: Photorealistic, supports text rendering
- **VRAM**: ~16GB

### LongCat (LongCat-Video-Avatar)
- **Task**: Audio-driven avatar animation
- **Input**: Audio + reference image (or just audio + text)
- **Output**: MP4 video with lip-sync
- **Modes**:
  - `ai2v`: Audio + Image → Video (recommended)
  - `at2v`: Audio + Text → Video (generates character)
- **VRAM**: ~40GB (uses 2 GPUs)

---

## Cost Optimization

1. **Use appropriate models**: Z-Image is cheapest (~$0.44/hr), LongCat is most expensive (~$1.72/hr)
2. **Scale to zero**: All endpoints have `workersMin: 0`, so you only pay when processing
3. **Batch jobs**: Cold starts take time, so batch related jobs together
4. **Choose resolution wisely**: Lower resolution = faster = cheaper

---

## Troubleshooting

### Job stuck in "queued"
- Check if RunPod endpoint is active
- Verify RunPod account has sufficient balance
- Cold start can take 2-5 minutes for model download

### Job failed with "GPU out of memory"
- Reduce resolution or batch size
- Try a different GPU type

### Images/videos not accessible
- Check R2 bucket permissions
- Verify public URL is correct
- Check if file was actually uploaded (look at fileSizeBytes)

### Webhook not received
- Verify webhookUrl is publicly accessible
- Check for HTTPS certificate issues
- Review Railway logs for webhook errors
