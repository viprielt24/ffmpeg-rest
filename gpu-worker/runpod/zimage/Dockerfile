# RunPod Serverless Dockerfile for Z-Image Text-to-Image
# Uses base image's PyTorch to avoid disk space issues
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/runpod-volume/cache \
    TRANSFORMERS_CACHE=/runpod-volume/cache \
    ZIMAGE_MODEL_PATH=Tongyi-MAI/Z-Image-Turbo

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install only additional Python dependencies (not torch - use base image)
# Install diffusers from source for Z-Image support
RUN pip install --no-cache-dir \
    runpod>=1.6.0 \
    transformers>=4.40.0 \
    accelerate>=0.30.0 \
    safetensors>=0.4.0 \
    huggingface_hub>=0.23.0 \
    boto3>=1.34.0 \
    Pillow>=10.0.0 \
    git+https://github.com/huggingface/diffusers

# Copy handler
COPY handler.py /workspace/handler.py

# Model will be downloaded on first run (cached in /runpod-volume)
CMD ["python", "-u", "/workspace/handler.py"]
