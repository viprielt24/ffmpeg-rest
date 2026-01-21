#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# Load environment variables
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# Set model-specific config
export MODEL_TYPE=zimage
export ZIMAGE_MODEL_PATH="${ZIMAGE_MODEL_PATH:-/workspace/models/z-image-turbo}"

echo "Starting Z-Image worker..."
echo "  Model path: $ZIMAGE_MODEL_PATH"
echo "  Redis URL: ${REDIS_URL:0:30}..."
echo ""

python -m workers.zimage.main
