#!/bin/bash
set -e
echo "=== Setting up LTX-2 Worker ==="

# Install system dependencies
apt-get update && apt-get install -y git ffmpeg

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
pip install -r requirements-ltx2.txt

# Download and cache model
echo "Downloading LTX-2 model (this may take a while)..."
python -c "
from huggingface_hub import snapshot_download
snapshot_download(
    'Lightricks/LTX-Video',
    local_dir='/workspace/models/ltx-video',
    ignore_patterns=['*.md', '*.txt']
)
print('Model downloaded successfully!')
"

echo "=== LTX-2 Setup Complete ==="
echo ""
echo "To start the worker:"
echo "  bash scripts/start-ltx2.sh"
