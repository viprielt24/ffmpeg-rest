# RunPod Serverless Dockerfile for LongCat-Video-Avatar
# Uses base image's PyTorch to avoid disk space issues
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/runpod-volume/cache \
    TRANSFORMERS_CACHE=/runpod-volume/cache \
    LONGCAT_DIR=/workspace/LongCat-Video \
    CHECKPOINT_DIR=/runpod-volume/weights/LongCat-Video-Avatar

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Clone LongCat-Video repository
RUN git clone --single-branch --branch main https://github.com/meituan-longcat/LongCat-Video.git /workspace/LongCat-Video

WORKDIR /workspace/LongCat-Video

# Install FlashAttention-2 (requires ninja)
RUN pip install --no-cache-dir ninja psutil packaging && \
    pip install --no-cache-dir flash_attn==2.7.4.post1

# Install LongCat requirements (includes librosa via pip)
RUN pip install --no-cache-dir -r requirements.txt || true

# Install avatar-specific requirements
RUN pip install --no-cache-dir -r requirements_avatar.txt || true

# Install additional dependencies including librosa via pip
RUN pip install --no-cache-dir \
    runpod>=1.6.0 \
    boto3>=1.34.0 \
    huggingface_hub>=0.23.0 \
    librosa>=0.10.0 \
    soundfile>=0.12.0 \
    einops>=0.7.0 \
    omegaconf>=2.3.0

WORKDIR /workspace

# Copy handler
COPY handler.py /workspace/handler.py

# Models will be downloaded on first run (cached in /runpod-volume)
# This avoids disk space issues during build

# Start the serverless handler
CMD ["python", "-u", "/workspace/handler.py"]
