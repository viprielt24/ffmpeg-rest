# RunPod Serverless Dockerfile for LTX-2 Image-to-Video
# Uses base image's PyTorch to avoid disk space issues
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/runpod-volume/cache \
    TRANSFORMERS_CACHE=/runpod-volume/cache \
    LTX2_MODEL_PATH=Lightricks/LTX-Video

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install only additional Python dependencies (not torch - use base image)
# Use diffusers 0.32.2 which has LTXImageToVideoPipeline
RUN pip install --no-cache-dir \
    runpod>=1.6.0 \
    diffusers==0.32.2 \
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
