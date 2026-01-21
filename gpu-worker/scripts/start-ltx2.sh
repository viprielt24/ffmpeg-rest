#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# Load environment variables
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# Set model-specific config
export MODEL_TYPE=ltx2
export LTX2_MODEL_PATH="${LTX2_MODEL_PATH:-/workspace/models/ltx-video}"

echo "Starting LTX-2 worker..."
echo "  Model path: $LTX2_MODEL_PATH"
echo "  Redis URL: ${REDIS_URL:0:30}..."
echo ""

python -m workers.ltx2.main
