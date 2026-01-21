#!/bin/bash
set -e
echo "=== Setting up Wav2Lip Worker ==="

# Install system dependencies
apt-get update && apt-get install -y git ffmpeg libsndfile1

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements-wav2lip.txt

# Clone Wav2Lip repository if not exists
if [ ! -d "/workspace/models/wav2lip" ]; then
    echo "Cloning Wav2Lip repository..."
    git clone https://github.com/Rudrabha/Wav2Lip.git /workspace/models/wav2lip
fi

cd /workspace/models/wav2lip

# Create directories for models
mkdir -p checkpoints face_detection/detection/sfd

# Download face detection model
if [ ! -f "face_detection/detection/sfd/s3fd.pth" ]; then
    echo "Downloading face detection model..."
    wget -O face_detection/detection/sfd/s3fd.pth \
        "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth"
fi

# Check for Wav2Lip GAN model
if [ ! -f "checkpoints/wav2lip_gan.pth" ]; then
    echo ""
    echo "WARNING: Wav2Lip GAN model not found!"
    echo "Please download wav2lip_gan.pth from:"
    echo "  https://github.com/Rudrabha/Wav2Lip#getting-the-weights"
    echo ""
    echo "Then place it in:"
    echo "  /workspace/models/wav2lip/checkpoints/wav2lip_gan.pth"
    echo ""
fi

echo "=== Wav2Lip Setup Complete ==="
echo ""
echo "To start the worker:"
echo "  bash scripts/start-wav2lip.sh"
