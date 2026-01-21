#!/bin/bash
set -e
echo "=== Setting up Z-Image Worker ==="

# Install system dependencies
apt-get update && apt-get install -y git

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements-zimage.txt

# Install diffusers from source for Z-Image support (if needed)
# pip install git+https://github.com/huggingface/diffusers

# Download and cache model
echo "Downloading Z-Image-Turbo model (this may take a while)..."
python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Tongyi-MAI/Z-Image-Turbo',
    local_dir='/workspace/models/z-image-turbo',
    ignore_patterns=['*.md', '*.txt']
)
print('Model downloaded successfully!')
"

echo "=== Z-Image Setup Complete ==="
echo ""
echo "To start the worker:"
echo "  bash scripts/start-zimage.sh"
