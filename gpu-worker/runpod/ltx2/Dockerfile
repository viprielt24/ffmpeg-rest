# RunPod Serverless Dockerfile for LTX-2 Image-to-Video
FROM runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/workspace/cache \
    TRANSFORMERS_CACHE=/workspace/cache \
    LTX2_MODEL_PATH=/workspace/models/ltx-video

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt /workspace/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Download and cache the model during build
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('Lightricks/LTX-Video', local_dir='/workspace/models/ltx-video', ignore_patterns=['*.md', '*.txt']); \
print('Model downloaded!')"

# Copy handler
COPY handler.py /workspace/handler.py

# Start the serverless handler
CMD ["python", "-u", "/workspace/handler.py"]
