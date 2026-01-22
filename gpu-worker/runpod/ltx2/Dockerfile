# RunPod Serverless Dockerfile for LTX-Video Image-to-Video (13B Model)
# Uses base image's PyTorch to avoid disk space issues
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
# LTX_MODEL_ID: Use 13B model for higher quality (requires ~30GB VRAM)
# Options: Lightricks/LTX-Video-0.9.7-dev (13B), Lightricks/LTX-Video-0.9.7-distilled (13B faster)
#          Lightricks/LTX-Video (2B, lower quality but fits on smaller GPUs)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/runpod-volume/cache \
    TRANSFORMERS_CACHE=/runpod-volume/cache \
    LTX_MODEL_ID=Lightricks/LTX-Video-0.9.7-dev

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install only additional Python dependencies (not torch - use base image)
# Use latest diffusers from source for LTXConditionPipeline support
RUN pip install --no-cache-dir \
    runpod>=1.6.0 \
    git+https://github.com/huggingface/diffusers.git \
    transformers>=4.40.0 \
    accelerate>=0.30.0 \
    safetensors>=0.4.0 \
    huggingface_hub>=0.23.0 \
    imageio>=2.34.0 \
    imageio-ffmpeg>=0.4.9 \
    boto3>=1.34.0 \
    requests>=2.31.0 \
    Pillow>=10.0.0 \
    sentencepiece

# Copy handler
COPY handler.py /workspace/handler.py

# Model will be downloaded on first run (cached in /runpod-volume)
# This avoids disk space issues during build

# Start the serverless handler
CMD ["python", "-u", "/workspace/handler.py"]
