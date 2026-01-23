# InfiniteTalk RunPod Serverless Worker

Audio-driven talking head video generation using [InfiniteTalk](https://github.com/MeiGen-AI/InfiniteTalk).

## Features

- Generate talking head videos from a single image + audio
- Support for 9:16 vertical (portrait) and 16:9 horizontal (landscape) aspect ratios
- 480P and 720P resolution options
- Automatic model downloading on first run (cached to volume)

## Build & Deploy

### 1. Build Docker Image

```bash
docker build -t infinitetalk-runpod .
```

### 2. Push to Docker Hub

```bash
docker tag infinitetalk-runpod your-dockerhub/infinitetalk-runpod:latest
docker push your-dockerhub/infinitetalk-runpod:latest
```

### 3. Create RunPod Serverless Endpoint

1. Go to [RunPod Serverless](https://www.runpod.io/console/serverless)
2. Create new endpoint with:
   - Docker Image: `your-dockerhub/infinitetalk-runpod:latest`
   - GPU: H100 (recommended) or A100 80GB
   - Volume: Mount a network volume at `/runpod-volume` for model caching

### 4. Environment Variables

Set these in your RunPod endpoint:

```
HF_TOKEN=your_huggingface_token  # Optional, for gated models
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=your_access_key
R2_SECRET_KEY=your_secret_key
R2_BUCKET=your_bucket
R2_PUBLIC_URL=https://your-public-url.com  # Optional
```

## API Usage

### Request

```json
{
  "input": {
    "audioUrl": "https://example.com/speech.wav",
    "imageUrl": "https://example.com/face.jpg",
    "resolution": "720",
    "aspectRatio": "9:16",
    "sampleSteps": 8,
    "audioGuideScale": 6.0,
    "jobId": "optional-custom-id"
  }
}
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `audioUrl` | string | required | URL to audio file (WAV/MP3) |
| `imageUrl` | string | * | URL to reference face image |
| `videoUrl` | string | * | URL to reference video (alternative to imageUrl) |
| `resolution` | string | "720" | Output resolution: "480" or "720" |
| `aspectRatio` | string | "16:9" | Aspect ratio: "16:9" or "9:16" |
| `sampleSteps` | int | 8 | Sampling steps (higher = better quality, slower) |
| `audioGuideScale` | float | 6.0 | Audio guidance scale for lip sync |
| `jobId` | string | auto | Custom job ID for output naming |

\* Either `imageUrl` or `videoUrl` is required, but not both.

### Output Resolutions

| Resolution | Aspect Ratio | Dimensions |
|------------|--------------|------------|
| 720 | 16:9 | 1280x720 |
| 720 | 9:16 | 720x1280 |
| 480 | 16:9 | 832x480 |
| 480 | 9:16 | 480x832 |

### Response

```json
{
  "url": "https://your-bucket.com/outputs/job-id/output.mp4",
  "contentType": "video/mp4",
  "fileSizeBytes": 12345678,
  "durationMs": 5000,
  "width": 720,
  "height": 1280,
  "processingTimeMs": 45000
}
```

## Model Weights

On first run, the worker downloads:

1. **Wan2.1-I2V-14B-480P** (~28GB) - Base video generation model
2. **chinese-wav2vec2-base** (~380MB) - Audio feature extraction
3. **InfiniteTalk** (~500MB) - Talking head adapter

These are cached to `/runpod-volume/weights/` for subsequent runs.

## GPU Requirements

- **Minimum**: A100 40GB
- **Recommended**: H100 80GB (faster inference)

The model uses ~30GB VRAM during inference.
