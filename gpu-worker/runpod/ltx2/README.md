# LTX-2 RunPod Serverless Deployment

## Prerequisites

1. RunPod account with funds (minimum $0.01 to create endpoint)
2. Docker Hub account (username: `ffmpegapi`)
3. R2 storage credentials

## Build and Push Docker Image

```bash
cd gpu-worker/runpod/ltx2

# Build the image
docker build -t ffmpegapi/ltx2-runpod:latest .

# Push to Docker Hub
docker login
docker push ffmpegapi/ltx2-runpod:latest
```

## Create RunPod Endpoint

Once the image is pushed and you have funds in your RunPod account:

**Template ID:** `haay8all8m`

```bash
# Via RunPod CLI or Dashboard, create endpoint with:
# - Template: LTX-2 Image-to-Video (haay8all8m)
# - GPU: NVIDIA L40S
# - Min Workers: 0 (scale to zero)
# - Max Workers: 3
```

Or use the RunPod dashboard:
1. Go to Serverless > Endpoints
2. Click "New Endpoint"
3. Select template "LTX-2 Image-to-Video"
4. Choose GPU type: L40S
5. Set scaling: Min 0, Max 3
6. Click Create

## Environment Variables

Set these in the RunPod endpoint settings:

| Variable | Description |
|----------|-------------|
| `R2_ENDPOINT` | Cloudflare R2 endpoint URL |
| `R2_ACCESS_KEY` | R2 access key |
| `R2_SECRET_KEY` | R2 secret key |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL prefix for R2 bucket |

## API Usage

Once deployed, the endpoint accepts POST requests:

```bash
curl -X POST "https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/run" \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "imageUrl": "https://example.com/image.jpg",
      "prompt": "A cinematic video",
      "duration": 5,
      "numInferenceSteps": 30,
      "guidanceScale": 7.5
    }
  }'
```

Response (async job):
```json
{
  "id": "job-id",
  "status": "IN_QUEUE"
}
```

Check status:
```bash
curl "https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/status/JOB_ID" \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY"
```
