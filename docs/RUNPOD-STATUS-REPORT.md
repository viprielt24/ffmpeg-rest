# RunPod AI Models Status Report

**Date:** 2026-01-22
**Last Updated:** 07:50 UTC

## Summary

| Model | Status | Endpoint ID | Issue |
|-------|--------|-------------|-------|
| **LTX-2** | WORKING | `jhhhu2n49qn80i` | None - Ready for production |
| **Z-Image** | BUILDING | `cvp33wd6nut976` | PyTorch 2.8.0 build in progress |
| **LongCat-Avatar** | BLOCKED | `1whmb31pt9ds3s` | Needs network volume for 50GB models |
| **InfiniteTalk** | WORKING | `1t1wj3wwtv03x7` | None - Ready for production |

---

## LTX-2 Image-to-Video

**Status:** WORKING

**Endpoint:** `jhhhu2n49qn80i`
**Template:** `haay8all8m`
**GPU:** NVIDIA L40S (48GB)
**Container Disk:** 50GB

### Test Results
- Video URL: https://pub-c890861a94df454f9643e18e01c86fa0.r2.dev/outputs/309a0d28-e9b5-415f-a22a-826382fcf079/output.mp4
- Processing time: 42.8 seconds
- Resolution: 768x512
- Duration: 5 seconds
- File size: 287KB

### Configuration
- Docker Image: `viprielt24/ltx2-runpod:latest`
- Base Image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`
- diffusers: 0.32.2
- Model: Lightricks/LTX-Video (downloaded at runtime)

---

## Z-Image Text-to-Image

**Status:** BUILD IN PROGRESS (~22 min)

**Endpoint:** `cvp33wd6nut976`
**Template:** `ed8tzougqf`
**GPU:** NVIDIA L40S (48GB)
**Container Disk:** 50GB

### Issues Encountered

1. **torch.xpu attribute error** - Fixed with MockXPU class
2. **enable_gqa requires PyTorch 2.5+** - Upgrading to PyTorch 2.8.0
3. **GitHub Actions disk space** - Added cleanup step to workflow

### Current Fix
- Upgraded base image to `runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04`
- Added disk cleanup step to CI workflow
- Build running (started 07:47 UTC)

### Configuration
- Docker Image: `viprielt24/zimage-runpod:latest`
- Base Image: `runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04`
- diffusers: from source (git+https://github.com/huggingface/diffusers)
- Model: Tongyi-MAI/Z-Image-Turbo (downloaded at runtime)

---

## LongCat Video Avatar

**Status:** BLOCKED - Needs Network Volume

**Endpoint:** `1whmb31pt9ds3s`
**Template:** `i9hqs4fjud`
**GPU:** 2x L40S/A100
**Container Disk:** 100GB (insufficient)

### Issue
Model files are ~50GB combined (LongCat-Video + LongCat-Video-Avatar). The 100GB container disk is not enough for:
- Base OS + PyTorch
- Model downloads (~50GB)
- Working space for inference

### Required Action
1. Create RunPod network volume (~100GB) for model persistence
2. Update template to attach network volume
3. Models will persist across cold starts, eliminating download time

### Error from test
```
RuntimeError: Data processing error: CAS service error : IO Error: No space left on device (os error 28)
```

---

## InfiniteTalk Audio-Driven Video

**Status:** WORKING

**Endpoint:** `1t1wj3wwtv03x7`
**GPUs:** ADA_24, ADA_32_PRO (24-32GB VRAM)

### Test Results
- Video generated successfully
- Processing time: ~71 seconds
- Queue time: ~15 seconds
- GPU availability: Good (24-32GB GPUs have better supply than 80GB)

### Configuration
- Model: InfiniteTalk v1.2.2
- Output: Base64 video (decoded and uploaded to R2)
- Input: Audio URL + Image URL or Video URL
- Resolution: 480p or 720p

### API Integration
- Added to Railway API with automatic base64-to-R2 conversion
- Returns public R2 URL instead of raw base64 data

---

## Railway Environment Variables

All endpoint IDs are set in Railway `ffmpeg-rest` service:

```bash
RUNPOD_API_KEY=<your-runpod-api-key>
RUNPOD_LTX2_ENDPOINT_ID=<ltx2-endpoint-id>
RUNPOD_ZIMAGE_ENDPOINT_ID=<zimage-endpoint-id>
RUNPOD_LONGCAT_ENDPOINT_ID=<longcat-endpoint-id>
RUNPOD_INFINITETALK_ENDPOINT_ID=<infinitetalk-endpoint-id>
```

---

## Next Steps

1. **Z-Image:** Wait for PyTorch 2.8.0 build to complete (~5-10 min remaining), then test
2. **LongCat:** Create 100GB network volume in RunPod datacenter, update template
3. **InfiniteTalk:** Set RUNPOD_INFINITETALK_ENDPOINT_ID in Railway (manual - API timeout)
4. **Documentation:** Update AI-GENERATION-INFRASTRUCTURE.md with final endpoint IDs

---

## Commits Made

| Commit | Description |
|--------|-------------|
| `92ed993` | Initial LTX-2 RunPod integration |
| `d2b8904` | Add Z-Image and LongCat handlers |
| `e626f9d` | Add comprehensive XPU mock |
| `a2d3b1c` | Use diffusers 0.32.2 for LTX-2 |
| `007f458` | Use PyTorch 2.5.1 for Z-Image (failed - not available) |
| `43e33fe` | Use PyTorch 2.8.0 for Z-Image |
| `bc0bae9` | Add disk cleanup to CI workflows |
