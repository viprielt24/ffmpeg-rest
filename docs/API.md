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

GPU-powered AI video generation. Jobs are processed on RunPod serverless infrastructure.

### POST /api/v1/generate

Create an AI generation job. Supports multiple models: LTX-2 (image-to-video), Wav2Lip (lip-sync), Z-Image (text-to-image), LongCat (audio-driven avatar), and InfiniteTalk (audio-driven video).

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
| `model` | string | Yes | - | Model to use: `ltx2`, `wav2lip`, `zimage`, `longcat`, `infinitetalk` |
| `audioUrl` | string | Yes* | - | URL to audio file (*required for infinitetalk, longcat, wav2lip) |
| `imageUrl` | string | No* | - | URL to source image (*required for some models) |
| `videoUrl` | string | No | - | URL to reference video (alternative to imageUrl for infinitetalk) |
| `resolution` | string | No | "720" | Output resolution: "480" or "720" |
| `webhookUrl` | string | No | - | Callback URL on completion |

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

**Response - Completed:**
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
