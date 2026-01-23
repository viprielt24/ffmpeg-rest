# RunPod Serverless Dockerfile for InfiniteTalk
# Audio-driven talking head video generation
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/runpod-volume/cache \
    TRANSFORMERS_CACHE=/runpod-volume/cache \
    INFINITETALK_DIR=/workspace/InfiniteTalk \
    WAN_WEIGHTS_DIR=/runpod-volume/weights/Wan2.1-I2V-14B-480P \
    WAV2VEC_DIR=/runpod-volume/weights/chinese-wav2vec2-base \
    INFINITETALK_WEIGHTS_DIR=/runpod-volume/weights/InfiniteTalk \
    ATTN_IMPLEMENTATION=eager

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    git-lfs \
    ffmpeg \
    libsndfile1 \
    libmagic1 \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Clone InfiniteTalk repository
RUN git lfs install && \
    git clone --single-branch --branch main https://github.com/MeiGen-AI/InfiniteTalk.git /workspace/InfiniteTalk

WORKDIR /workspace/InfiniteTalk

# Install FlashAttention-2 and xformers
RUN pip install --no-cache-dir ninja psutil packaging && \
    pip install --no-cache-dir flash_attn==2.7.4.post1 --no-build-isolation && \
    pip install --no-cache-dir xformers==0.0.28 --no-build-isolation

# Install InfiniteTalk requirements (excluding xfuser which requires PyTorch 2.5+)
RUN grep -v '^xfuser' requirements.txt > requirements_filtered.txt && \
    pip install --no-cache-dir -r requirements_filtered.txt || true

# Uninstall xfuser if installed as transitive dependency
RUN pip uninstall -y xfuser || true

# Patch xfuser imports for single-GPU inference
# xfuser is only needed for multi-GPU distributed inference
COPY patch_xfuser.py /workspace/patch_xfuser.py
RUN python /workspace/patch_xfuser.py

# Install additional dependencies
RUN pip install --no-cache-dir \
    runpod>=1.6.0 \
    boto3>=1.34.0 \
    huggingface_hub>=0.25.0 \
    librosa>=0.10.0 \
    soundfile>=0.12.0 \
    misaki[en]>=0.7.0

WORKDIR /workspace

# Copy handler
COPY handler.py /workspace/handler.py

# Models will be downloaded on first run (cached in /runpod-volume)
# This avoids disk space issues during build

# Start the serverless handler
CMD ["python", "-u", "/workspace/handler.py"]
