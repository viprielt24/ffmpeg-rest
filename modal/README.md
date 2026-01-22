# InfiniteTalk Modal Deployment

Deploy the [InfiniteTalk](https://huggingface.co/MeiGen-AI/InfiniteTalk) audio-driven video generation model to Modal.com as a serverless GPU endpoint.

## Prerequisites

1. **Modal Account**: Sign up at [modal.com](https://modal.com)
2. **Modal CLI**: Install with `pip install modal`
3. **HuggingFace Token** (optional): Required if model is gated

## Quick Start

### 1. Install Modal CLI

```bash
pip install modal
```

### 2. Authenticate with Modal

```bash
modal setup
```

This opens a browser to authenticate with your Modal account.

### 3. Create Required Secrets

Create the authentication secret for API access:

```bash
modal secret create infinitetalk-auth AUTH_TOKEN=your-secure-token-here
```

(Optional) Create HuggingFace secret if model access requires it:

```bash
modal secret create huggingface HF_TOKEN=your-hf-token
```

### 4. Download Model Weights

This downloads ~50GB of model weights to a persistent volume:

```bash
modal run modal/infinitetalk_app.py::download_weights
```

### 5. Deploy to Production

```bash
modal deploy modal/infinitetalk_app.py
```

After deployment, Modal will output your endpoint URLs:

```
✓ Created InfiniteTalk.generate => https://your-workspace--infinitetalk-api-infinitetalk-generate.modal.run
✓ Created InfiniteTalk.status => https://your-workspace--infinitetalk-api-infinitetalk-status.modal.run
```

## Development

For local development with live reload:

```bash
modal serve modal/infinitetalk_app.py
```

## API Reference

### POST /generate

Submit a new generation job.

**Request:**
```json
{
  "image_url": "https://example.com/portrait.jpg",
  "audio_url": "https://example.com/speech.wav",
  "resolution": "720"
}
```

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued"
}
```

### GET /status?job_id={job_id}

Check job status and retrieve result.

**Response (processing):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

**Response (completed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "video": "base64-encoded-video-data..."
}
```

**Response (failed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "error": "Error message"
}
```

## Testing

Test the endpoint with curl:

```bash
# Submit a job
curl -X POST "https://your-workspace--infinitetalk-api-infinitetalk-generate.modal.run" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/portrait.jpg",
    "audio_url": "https://example.com/speech.wav",
    "resolution": "720"
  }'

# Check status
curl "https://your-workspace--infinitetalk-api-infinitetalk-status.modal.run?job_id=YOUR_JOB_ID"
```

## Configuration

### GPU Selection

The default GPU is A100-80GB, optimal for the 14B parameter model. You can change this in `infinitetalk_app.py`:

```python
# A100 80GB (recommended for 14B model)
GPU_CONFIG = modal.gpu.A100(size="80GB")

# A100 40GB (lower VRAM mode)
GPU_CONFIG = modal.gpu.A100(size="40GB")

# H100 (if available)
GPU_CONFIG = modal.gpu.H100()
```

### Timeouts

- **Container idle timeout**: 5 minutes (containers stay warm)
- **Request timeout**: 15 minutes (max per request)
- **Download timeout**: 1 hour (for initial weight download)

## Cost Estimation

Modal pricing (as of 2024):
- A100-80GB: ~$3.50/hour
- Container warm-up time: ~60 seconds
- Typical generation time: 2-5 minutes

With container keep-alive (5 min), expect:
- First request: ~60s warm-up + generation time
- Subsequent requests: generation time only

## Troubleshooting

### "Model weights not found"

Run the download function first:
```bash
modal run modal/infinitetalk_app.py::download_weights
```

### "AUTH_TOKEN not configured"

Create the auth secret:
```bash
modal secret create infinitetalk-auth AUTH_TOKEN=your-token
```

### Container timeout

Increase timeout in the `@app.cls` decorator if generation takes longer.

### Out of memory

Switch to low VRAM mode or use A100-80GB instead of A100-40GB.

## Integration with ffmpeg-backend

Set these environment variables in your ffmpeg-backend deployment:

```bash
MODAL_INFINITETALK_ENDPOINT=https://your-workspace--infinitetalk-api-infinitetalk-generate.modal.run
MODAL_INFINITETALK_STATUS_ENDPOINT=https://your-workspace--infinitetalk-api-infinitetalk-status.modal.run
MODAL_AUTH_TOKEN=your-secure-token-here
```

The generate controller will automatically use Modal when these are configured.
