#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# Load environment variables
[ -f .env ] && export $(grep -v '^#' .env | xargs)

# Set model-specific config
export MODEL_TYPE=wav2lip
export WAV2LIP_MODEL_PATH="${WAV2LIP_MODEL_PATH:-/workspace/models/wav2lip}"

echo "Starting Wav2Lip worker..."
echo "  Model path: $WAV2LIP_MODEL_PATH"
echo "  Redis URL: ${REDIS_URL:0:30}..."
echo ""

python -m workers.wav2lip.main
