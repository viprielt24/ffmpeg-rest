# RunPod Serverless Dockerfile for LongCat-Video-Avatar
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/workspace/cache \
    TRANSFORMERS_CACHE=/workspace/cache \
    LONGCAT_DIR=/workspace/LongCat-Video \
    CHECKPOINT_DIR=/workspace/weights/LongCat-Video-Avatar

WORKDIR /workspace

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Install conda dependencies
RUN conda install -c conda-forge librosa -y

# Clone LongCat-Video repository
RUN git clone --single-branch --branch main https://github.com/meituan-longcat/LongCat-Video.git /workspace/LongCat-Video

WORKDIR /workspace/LongCat-Video

# Install FlashAttention-2
RUN pip install --no-cache-dir ninja psutil packaging && \
    pip install --no-cache-dir flash_attn==2.7.4.post1

# Install LongCat requirements
RUN pip install --no-cache-dir -r requirements.txt

# Install avatar-specific requirements
RUN pip install --no-cache-dir -r requirements_avatar.txt

# Copy additional requirements and install
COPY requirements.txt /workspace/extra_requirements.txt
RUN pip install --no-cache-dir -r /workspace/extra_requirements.txt

# Download models
RUN pip install "huggingface_hub[cli]" && \
    huggingface-cli download meituan-longcat/LongCat-Video --local-dir /workspace/weights/LongCat-Video && \
    huggingface-cli download meituan-longcat/LongCat-Video-Avatar --local-dir /workspace/weights/LongCat-Video-Avatar

WORKDIR /workspace

# Copy handler
COPY handler.py /workspace/handler.py

# Start the serverless handler
CMD ["python", "-u", "/workspace/handler.py"]
