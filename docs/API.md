# FFmpeg REST API - Endpoint Documentation

**Base URL:** `https://ffmpeg-rest-production-850b.up.railway.app`

**Authentication:** All endpoints require Bearer token authentication.
```
Authorization: Bearer YOUR_AUTH_TOKEN
```

**Interactive Docs:** Available at `/reference` (Scalar UI) and `/doc` (OpenAPI JSON)

---

## Table of Contents

1. [AI Generation Endpoints](#ai-generation-endpoints) (GPU-powered video/image generation)
   - [POST /api/v1/generate](#post-apiv1generate) - AI generation job
   - [Model: InfiniteTalk](#model-infinitetalk-audio-driven-video) - Audio-driven talking head videos
   - [Model: Z-Image](#model-z-image-text-to-image) - Text-to-image generation
   - [Model: Wav2Lip](#model-wav2lip-lip-sync) - Video lip-sync
   - [POST /api/v1/generate/bulk/infinitetalk](#post-apiv1generatebulkinfinitetalk) - Bulk InfiniteTalk generation
   - [GET /api/v1/generate/:jobId](#get-apiv1generatejobid) - Poll generation job status
   - [GET /api/v1/generate/bulk/:batchId](#get-apiv1generatebulkbatchid) - Poll batch status

2. [Async Job Endpoints](#async-job-endpoints) (URL-based, queued processing)
   - [POST /mux](#post-mux) - Combine video + audio
   - [POST /concatenate](#post-concatenate) - Join multiple videos
   - [POST /normalize](#post-normalize) - Re-encode video to standard parameters
   - [GET /jobs/:jobId](#get-jobsjobid) - Poll job status

3. [Sync Endpoints](#sync-endpoints) (File upload, immediate response)
   - [Video](#video-endpoints)
   - [Audio](#audio-endpoints)
   - [Image](#image-endpoints)
   - [Media Info](#media-info-endpoints)

---

## AI Generation Endpoints

GPU-powered AI video and image generation. Jobs are processed on Modal.com or RunPod serverless infrastructure.

### Supported Models

| Model | Type | Description | Provider |
|-------|------|-------------|----------|
| `infinitetalk` | Audio-to-Video | Generate talking head videos from audio + portrait | Modal (default) or RunPod |
| `zimage` | Text-to-Image | Generate images from text prompts (Kolors Turbo) | RunPod |
| `wav2lip` | Lip-Sync | Sync existing video lips to new audio | RunPod |

---

### POST /api/v1/generate

Create an AI generation job. The `model` field determines which AI model to use and what parameters are required.

**Request (InfiniteTalk example):**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "infinitetalk",
    "audioUrl": "https://example.com/speech.wav",
    "imageUrl": "https://example.com/portrait.jpg",
    "resolution": "720",
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Model to use: `wav2lip`, `zimage`, `infinitetalk` |
| `audioUrl` | string | Model-specific | - | URL to audio file (required for infinitetalk, wav2lip) |
| `imageUrl` | string | Model-specific | - | URL to source image (see model-specific params below) |
| `videoUrl` | string | Model-specific | - | URL to reference video (see model-specific params below) |
| `webhookUrl` | string | No | - | Callback URL on completion |

See model-specific parameters below for each model's requirements.

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "89",
  "model": "infinitetalk",
  "status": "queued",
  "message": "Job queued on RunPod. Poll GET /api/v1/generate/{jobId} for status."
}
```

---

### Model: InfiniteTalk (Audio-Driven Video)

Generate realistic talking head videos from a portrait image/video and audio file. The AI animates the face to match the audio lip movements.

**Use cases:** AI avatars, talking head videos, podcast visualizations, virtual presenters.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "infinitetalk",
    "audioUrl": "https://example.com/speech.wav",
    "imageUrl": "https://example.com/portrait.jpg",
    "resolution": "720",
    "provider": "modal",
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Must be `"infinitetalk"` |
| `audioUrl` | string | Yes | - | URL to audio file (WAV/MP3). Audio length determines video length. |
| `imageUrl` | string | One of* | - | URL to portrait image (JPG/PNG). Face should be clearly visible. |
| `videoUrl` | string | One of* | - | URL to reference video (MP4). Alternative to imageUrl. |
| `resolution` | string | No | `"720"` | Output resolution: `"480"` (854x480) or `"720"` (1280x720) |
| `provider` | string | No | `"modal"` | GPU provider: `"modal"` (recommended) or `"runpod"` |
| `webhookUrl` | string | No | - | Callback URL when job completes |

*\*Provide either `imageUrl` OR `videoUrl`, not both.*

**Best practices:**
- Use high-quality portrait images with clear, front-facing faces
- Audio should be clear speech (WAV format preferred)
- 720p resolution provides better quality but takes longer to process
- Modal provider is faster and recommended for most use cases

**Output:** MP4 video with the portrait animated to match the audio.

---

### Model: Z-Image (Text-to-Image)

Generate high-quality images from text prompts using the Kolors Turbo model. Supports both English and Chinese prompts.

**Use cases:** AI-generated portraits, product images, creative artwork, thumbnails.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "zimage",
    "prompt": "A photorealistic portrait of a professional businesswoman in a modern office, natural lighting, high detail",
    "negativePrompt": "blurry, low quality, distorted, deformed",
    "width": 1024,
    "height": 1024,
    "steps": 9,
    "guidanceScale": 0,
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Must be `"zimage"` |
| `prompt` | string | Yes | - | Text description of the image to generate (1-1000 chars). Supports English and Chinese. |
| `negativePrompt` | string | No | - | Features to avoid in the image (max 500 chars) |
| `width` | number | No | `1024` | Output width in pixels (512-2048) |
| `height` | number | No | `1024` | Output height in pixels (512-2048) |
| `steps` | number | No | `30` | Inference steps (8-100). Use 8-9 for Turbo variant (faster), 20-30 for higher quality. |
| `guidanceScale` | number | No | `0` | Guidance scale (0-20). Use 0 for Turbo variant, 7-15 for Base. |
| `seed` | number | No | random | Random seed for reproducibility. Same seed + prompt = same image. |
| `webhookUrl` | string | No | - | Callback URL when job completes |

**Best practices:**
- Be descriptive: "A photorealistic portrait of a woman, natural lighting" > "woman portrait"
- Use negative prompts to avoid common artifacts: "blurry, distorted, deformed, low quality"
- For Turbo mode (fastest): use `steps: 9` and `guidanceScale: 0`
- For higher quality: use `steps: 30` and `guidanceScale: 7`
- Square images (1024x1024) work best, but aspect ratios up to 2:1 are supported

**Output:** PNG/JPG image at the specified dimensions.

---

### Model: Wav2Lip (Lip-Sync)

Sync the lip movements in an existing video to match new audio. Useful for dubbing or audio replacement.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "model": "wav2lip",
    "videoUrl": "https://example.com/talking-head.mp4",
    "audioUrl": "https://example.com/new-speech.wav",
    "padTop": 0,
    "padBottom": 10,
    "padLeft": 0,
    "padRight": 0,
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | - | Must be `"wav2lip"` |
| `videoUrl` | string | Yes | - | URL to source video with visible face |
| `audioUrl` | string | Yes | - | URL to audio file to sync lips to |
| `padTop` | number | No | `0` | Padding above mouth region (0-50) |
| `padBottom` | number | No | `10` | Padding below mouth region (0-50) |
| `padLeft` | number | No | `0` | Padding left of mouth region (0-50) |
| `padRight` | number | No | `0` | Padding right of mouth region (0-50) |
| `webhookUrl` | string | No | - | Callback URL when job completes |

**Output:** MP4 video with lip-synced audio.

---

### POST /api/v1/generate/bulk/infinitetalk

Submit multiple InfiniteTalk jobs for parallel processing. Returns a batch ID to track all jobs.

**Use case:** Generate multiple talking head videos, process multiple audio files with same avatar.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate/bulk/infinitetalk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "jobs": [
      {
        "audioUrl": "https://example.com/audio1.wav",
        "imageUrl": "https://example.com/portrait.jpg"
      },
      {
        "audioUrl": "https://example.com/audio2.wav",
        "imageUrl": "https://example.com/portrait.jpg"
      },
      {
        "audioUrl": "https://example.com/audio3.wav",
        "imageUrl": "https://example.com/portrait.jpg"
      }
    ],
    "webhookUrl": "https://example.com/batch-webhook"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobs` | array | Yes | Array of job objects (1-50 jobs). Each job has same params as single endpoint (except webhookUrl) |
| `webhookUrl` | string | No | Callback URL when ALL jobs complete |

**Response (202 Accepted):**
```json
{
  "success": true,
  "batchId": "batch_abc123def456",
  "model": "infinitetalk",
  "totalJobs": 3,
  "jobs": [
    { "jobId": "91", "status": "queued" },
    { "jobId": "92", "status": "queued" },
    { "jobId": "93", "status": "queued" }
  ],
  "message": "Batch queued. Poll GET /api/v1/generate/bulk/batch_abc123def456 for status."
}
```

---

### GET /api/v1/generate/:jobId

Poll for AI generation job status.

**Request:**
```bash
curl https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate/89 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response - Queued:**
```json
{
  "status": "queued",
  "jobId": "89",
  "model": "infinitetalk",
  "createdAt": "2026-01-22T18:55:11.855Z"
}
```

**Response - Processing:**
```json
{
  "status": "processing",
  "jobId": "89",
  "model": "infinitetalk",
  "progress": 50,
  "startedAt": "2026-01-22T18:56:00.000Z",
  "createdAt": "2026-01-22T18:55:11.855Z"
}
```

**Response - Completed (InfiniteTalk/Wav2Lip video):**
```json
{
  "status": "completed",
  "jobId": "89",
  "model": "infinitetalk",
  "result": {
    "url": "https://pub-xxx.r2.dev/ffmpeg-rest/.../infinitetalk-89.mp4",
    "contentType": "video/mp4",
    "fileSizeBytes": 15234567,
    "width": 1280,
    "height": 720
  },
  "processingTimeMs": 425000,
  "createdAt": "2026-01-22T18:55:11.855Z",
  "completedAt": "2026-01-22T19:02:36.855Z"
}
```

**Response - Completed (Z-Image):**
```json
{
  "status": "completed",
  "jobId": "42",
  "model": "zimage",
  "result": {
    "url": "https://pub-xxx.r2.dev/ffmpeg-rest/.../zimage-42.png",
    "contentType": "image/png",
    "fileSizeBytes": 2345678,
    "width": 1024,
    "height": 1024
  },
  "processingTimeMs": 12000,
  "createdAt": "2026-01-22T18:55:11.855Z",
  "completedAt": "2026-01-22T18:55:23.855Z"
}
```

**Response - Failed:**
```json
{
  "status": "failed",
  "jobId": "89",
  "model": "infinitetalk",
  "error": "RunPod worker timeout",
  "createdAt": "2026-01-22T18:55:11.855Z",
  "failedAt": "2026-01-22T19:05:11.855Z"
}
```

---

### GET /api/v1/generate/bulk/:batchId

Poll for batch status. Returns status of all jobs in the batch.

**Request:**
```bash
curl https://ffmpeg-rest-production-850b.up.railway.app/api/v1/generate/bulk/batch_abc123def456 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response - Processing:**
```json
{
  "status": "processing",
  "batchId": "batch_abc123def456",
  "model": "infinitetalk",
  "totalJobs": 3,
  "completedJobs": 1,
  "failedJobs": 0,
  "results": [
    { "jobId": "91", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 15234567, "processingTimeMs": 420000 } },
    { "jobId": "92", "status": "processing" },
    { "jobId": "93", "status": "queued" }
  ],
  "createdAt": "2026-01-22T18:55:00.000Z"
}
```

**Response - Completed:**
```json
{
  "status": "completed",
  "batchId": "batch_abc123def456",
  "model": "infinitetalk",
  "totalJobs": 3,
  "completedJobs": 3,
  "failedJobs": 0,
  "results": [
    { "jobId": "91", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 15234567, "processingTimeMs": 420000 } },
    { "jobId": "92", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 14523456, "processingTimeMs": 435000 } },
    { "jobId": "93", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 16234567, "processingTimeMs": 410000 } }
  ],
  "createdAt": "2026-01-22T18:55:00.000Z",
  "completedAt": "2026-01-22T19:10:00.000Z"
}
```

**Batch webhook (sent when ALL jobs complete):**
```json
{
  "batchId": "batch_abc123def456",
  "status": "completed",
  "totalJobs": 3,
  "successfulJobs": 3,
  "failedJobs": 0,
  "results": [
    { "jobId": "91", "model": "infinitetalk", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 15234567, "processingTimeMs": 420000 } },
    { "jobId": "92", "model": "infinitetalk", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 14523456, "processingTimeMs": 435000 } },
    { "jobId": "93", "model": "infinitetalk", "status": "completed", "result": { "url": "https://...", "fileSizeBytes": 16234567, "processingTimeMs": 410000 } }
  ],
  "timestamp": "2026-01-22T19:10:00.000Z"
}
```

---

## Async Job Endpoints

These endpoints accept URLs, queue jobs for background processing, and return immediately with a job ID. Poll `/jobs/:jobId` for results.

### POST /mux

Combine a video file and audio file into a single MP4.

**Use case:** Add background music, voiceover, or replace audio track.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/mux \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "videoUrl": "https://example.com/video.mp4",
    "audioUrl": "https://example.com/audio.mp3",
    "duration": 30,
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `videoUrl` | string | Yes | URL to video file |
| `audioUrl` | string | Yes | URL to audio file |
| `duration` | number | No | Trim output to this duration (seconds) |
| `webhookUrl` | string | No | Callback URL on completion |

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "1",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}
```

**FFmpeg operation:** Muxes video (re-encoded to H.264) with audio (re-encoded to AAC), uses `-shortest` flag.

---

### POST /concatenate

Join multiple video files sequentially into one video.

**Use case:** Combine video clips, merge segments, create compilations.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/concatenate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "videoUrls": [
      "https://example.com/clip1.mp4",
      "https://example.com/clip2.mp4",
      "https://example.com/clip3.mp4"
    ],
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `videoUrls` | string[] | Yes | Array of video URLs (min 2) |
| `webhookUrl` | string | No | Callback URL on completion |

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "2",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}
```

**FFmpeg operation:** Uses concat demuxer with `-c copy` (no re-encoding, fast). Videos should have matching codecs/resolution for best results.

---

### POST /normalize

Re-encode video to standardized parameters (resolution, frame rate, codec settings).

**Use case:** Standardize user-uploaded videos, prepare for streaming, ensure compatibility.

**Request:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/normalize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "videoUrl": "https://example.com/video.mp4",
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "crf": 23,
    "preset": "fast",
    "duration": 60,
    "webhookUrl": "https://example.com/webhook"
  }'
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `videoUrl` | string | Yes | - | URL to video file |
| `webhookUrl` | string | No | - | Callback URL on completion |
| `width` | number | No | 1080 | Output width in pixels |
| `height` | number | No | 1920 | Output height in pixels |
| `fps` | number | No | 30 | Output frame rate |
| `videoBitrate` | string | No | - | Video bitrate (e.g., "5M"). Overrides CRF if set |
| `crf` | number | No | 23 | Constant Rate Factor (0-51, lower = better quality) |
| `preset` | string | No | "fast" | x264 preset: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow |
| `audioBitrate` | string | No | ~128k | Audio bitrate (e.g., "192k") |
| `audioSampleRate` | number | No | 48000 | Audio sample rate in Hz |
| `audioChannels` | number | No | 2 | Audio channels: 1 (mono) or 2 (stereo) |
| `duration` | number | No | - | Trim output to this duration (seconds) |

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "3",
  "status": "queued",
  "message": "Job queued successfully. Poll GET /jobs/:jobId for status."
}
```

**FFmpeg operation:**
- Video: scale + pad (letterbox/pillarbox to preserve aspect ratio) + fps filter
- Codec: H.264 (libx264) with specified preset and CRF/bitrate
- Audio: AAC with specified sample rate and channels
- Output: MP4 with faststart flag for web streaming

**Video filter chain:**
```
scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,fps=FPS
```

---

### GET /jobs/:jobId

Poll for job status. Returns progress while active, result URL when complete.

**Request:**
```bash
curl https://ffmpeg-rest-production-850b.up.railway.app/jobs/3 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response - Queued:**
```json
{
  "status": "queued",
  "jobId": "3",
  "progress": 0
}
```

**Response - Active:**
```json
{
  "status": "active",
  "jobId": "3",
  "progress": 45
}
```

**Response - Completed:**
```json
{
  "status": "completed",
  "jobId": "3",
  "result": {
    "url": "https://pub-xxx.r2.dev/ffmpeg-rest/.../output.mp4",
    "fileSizeBytes": 426037,
    "processingTimeMs": 6536
  }
}
```

**Response - Failed:**
```json
{
  "status": "failed",
  "jobId": "3",
  "error": "Download failed: 404 Not Found"
}
```

---

## Webhook Notifications

When `webhookUrl` is provided, the API sends a POST request on job completion:

**Success webhook:**
```json
{
  "jobId": "3",
  "status": "completed",
  "result": {
    "url": "https://pub-xxx.r2.dev/ffmpeg-rest/.../output.mp4",
    "fileSizeBytes": 426037,
    "processingTimeMs": 6536
  }
}
```

**Failure webhook:**
```json
{
  "jobId": "3",
  "status": "failed",
  "error": "FFmpeg process failed with exit code 1"
}
```

---

## Sync Endpoints

These endpoints accept file uploads via `multipart/form-data` and return results immediately (or upload to S3 with `/url` suffix).

### Video Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/video/mp4` | POST | Convert video to MP4 (returns file) |
| `/video/mp4/url` | POST | Convert video to MP4 (returns S3 URL) |
| `/video/audio` | POST | Extract audio as WAV (returns file) |
| `/video/audio/url` | POST | Extract audio as WAV (returns S3 URL) |
| `/video/frames` | POST | Extract frames as PNG archive |
| `/video/frames/url` | POST | Extract frames (returns S3 URL) |

**Example - Convert to MP4:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/video/mp4 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@input.avi" \
  -o output.mp4
```

**Example - Extract audio:**
```bash
curl -X POST "https://ffmpeg-rest-production-850b.up.railway.app/video/audio?mono=yes" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@video.mp4" \
  -o audio.wav
```

**Query parameters:**
- `mono=yes|no` (default: yes) - Extract as mono or preserve stereo
- `fps=N` (default: 1) - Frames per second for frame extraction
- `compress=zip|gzip` - Archive format for frames

---

### Audio Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/audio/mp3` | POST | Convert audio to MP3 (returns file) |
| `/audio/mp3/url` | POST | Convert audio to MP3 (returns S3 URL) |
| `/audio/wav` | POST | Convert audio to WAV (returns file) |
| `/audio/wav/url` | POST | Convert audio to WAV (returns S3 URL) |

**Example - Convert to MP3:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/audio/mp3 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@input.wav" \
  -o output.mp3
```

---

### Image Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/image/jpg` | POST | Convert image to JPG (returns file) |
| `/image/jpg/url` | POST | Convert image to JPG (returns S3 URL) |
| `/image/resize` | POST | Resize image (returns file) |
| `/image/resize/url` | POST | Resize image (returns S3 URL) |

**Example - Resize image:**
```bash
curl -X POST "https://ffmpeg-rest-production-850b.up.railway.app/image/resize?width=800&mode=fit" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@input.png" \
  -o resized.png
```

**Query parameters:**
- `width=N` - Target width in pixels
- `height=N` - Target height in pixels (optional)
- `mode=fit|fill|stretch` - Resize mode

---

### Media Info Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/media/info` | POST | Probe media file and return metadata |

**Example:**
```bash
curl -X POST https://ffmpeg-rest-production-850b.up.railway.app/media/info \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@video.mp4"
```

**Response:**
```json
{
  "format": {
    "filename": "video.mp4",
    "duration": "30.5",
    "size": "15234567",
    "bit_rate": "4000000"
  },
  "streams": [
    {
      "codec_type": "video",
      "codec_name": "h264",
      "width": 1920,
      "height": 1080,
      "r_frame_rate": "30/1"
    },
    {
      "codec_type": "audio",
      "codec_name": "aac",
      "sample_rate": "48000",
      "channels": 2
    }
  ]
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

| Status Code | Description |
|-------------|-------------|
| 400 | Invalid request (missing params, invalid URL, S3 mode required) |
| 401 | Missing or invalid authorization header |
| 404 | Job not found |
| 500 | Internal server error (FFmpeg failure, S3 upload error) |
| 501 | Not implemented (endpoint disabled) |

---

## Rate Limits & Timeouts

- **Download timeout:** 5 minutes per file
- **Processing timeout:** 10 minutes per job
- **Job retention:** Completed jobs kept for 1 hour, failed jobs for 24 hours
- **Retry policy:** 3 attempts with exponential backoff (1s, 2s, 4s)

---

## Output Storage

All async job outputs are stored in Cloudflare R2:
- **Public URL pattern:** `https://pub-xxx.r2.dev/ffmpeg-rest/YYYY-MM-DD-UUID/filename.mp4`
- **Retention:** 90 days (configurable via S3_DEDUP_TTL_DAYS)
- **Deduplication:** Enabled - identical inputs return cached results
