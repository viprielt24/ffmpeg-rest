"""
InfiniteTalk Modal App - Audio-Driven Video Generation

This Modal app provides a serverless GPU endpoint for the InfiniteTalk model.
It accepts an image/video URL and audio URL, then generates a video of the
person speaking/moving synchronized to the audio.

Deployment:
    modal deploy modal/infinitetalk_app.py

Development (live reload):
    modal serve modal/infinitetalk_app.py
"""

import os
import uuid
import base64
import tempfile
import time
from pathlib import Path
from typing import Optional

import modal
from fastapi import HTTPException
from pydantic import BaseModel, Field

# ============= Configuration =============

APP_NAME = "infinitetalk-api"
MODEL_DIR = "/models"
VOLUME_NAME = "infinitetalk-weights"

# GPU options - A100-80GB recommended for 14B model
GPU_CONFIG = modal.gpu.A100(size="80GB")

# Container image with all dependencies
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.1.0-cudnn8-devel-ubuntu22.04",
        add_python="3.10"
    )
    .apt_install(
        "ffmpeg",
        "git",
        "libsndfile1",
        "libgl1-mesa-glx",
        "libglib2.0-0"
    )
    .pip_install(
        # PyTorch with CUDA 12.1
        "torch==2.4.1",
        "torchvision==0.19.1",
        "torchaudio==2.4.1",
        # Attention optimizations
        "xformers==0.0.28",
        # HuggingFace ecosystem
        "huggingface-hub>=0.25.0",
        "accelerate>=0.34.0",
        "transformers>=4.45.0",
        "diffusers>=0.30.0",
        # Audio processing
        "librosa>=0.10.0",
        "soundfile>=0.12.0",
        # FastAPI for endpoints
        "fastapi[standard]>=0.115.0",
        # Utils
        "requests>=2.32.0",
        "pillow>=10.0.0",
        "numpy>=1.26.0",
        "opencv-python-headless>=4.9.0",
        "einops>=0.7.0",
        "omegaconf>=2.3.0",
    )
    # Install flash-attn from pip (requires specific build)
    .pip_install(
        "flash_attn",
        extra_options="--no-build-isolation",
    )
)

# Lighter image for downloading weights
download_image = modal.Image.debian_slim(python_version="3.10").pip_install(
    "huggingface-hub>=0.25.0",
    "requests>=2.32.0",
)

# ============= Data Models =============


class GenerateRequest(BaseModel):
    """Request schema for video generation."""
    image_url: Optional[str] = Field(
        None,
        description="URL to reference image (use either image_url or video_url)"
    )
    video_url: Optional[str] = Field(
        None,
        description="URL to reference video (use either image_url or video_url)"
    )
    audio_url: str = Field(
        ...,
        description="URL to audio file for driving the video"
    )
    resolution: str = Field(
        "720",
        description="Output resolution: '480' or '720'"
    )


class GenerateResponse(BaseModel):
    """Response schema for job submission."""
    job_id: str
    status: str = "queued"


class StatusResponse(BaseModel):
    """Response schema for job status check."""
    job_id: str
    status: str  # queued, processing, completed, failed
    video: Optional[str] = None  # Base64 encoded video when completed
    error: Optional[str] = None


# ============= Modal App =============

app = modal.App(APP_NAME)

# Persistent volume for model weights
model_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Persistent dict for job state (serverless-friendly)
job_dict = modal.Dict.from_name("infinitetalk-jobs", create_if_missing=True)


@app.function(
    image=download_image,
    volumes={MODEL_DIR: model_volume},
    timeout=3600,  # 1 hour for large downloads
    secrets=[modal.Secret.from_name("huggingface", required=False)],
)
def download_weights():
    """
    Download InfiniteTalk model weights to the persistent volume.
    Run this once before first inference.

    Usage: modal run modal/infinitetalk_app.py::download_weights
    """
    from huggingface_hub import snapshot_download

    hf_token = os.environ.get("HF_TOKEN")

    print("Downloading InfiniteTalk weights...")

    # Download InfiniteTalk model
    infinitetalk_path = Path(MODEL_DIR) / "infinitetalk"
    if not infinitetalk_path.exists():
        snapshot_download(
            "MeiGen-AI/InfiniteTalk",
            local_dir=str(infinitetalk_path),
            token=hf_token,
        )
        print(f"Downloaded InfiniteTalk to {infinitetalk_path}")
    else:
        print(f"InfiniteTalk already exists at {infinitetalk_path}")

    # Download Wan2.1-I2V-14B-480P base model (required by InfiniteTalk)
    wan_path = Path(MODEL_DIR) / "Wan2.1-I2V-14B-480P"
    if not wan_path.exists():
        snapshot_download(
            "Wan-AI/Wan2.1-I2V-14B-480P",
            local_dir=str(wan_path),
            token=hf_token,
        )
        print(f"Downloaded Wan2.1-I2V-14B-480P to {wan_path}")
    else:
        print(f"Wan2.1-I2V-14B-480P already exists at {wan_path}")

    model_volume.commit()
    print("Model weights download complete!")

    return {"status": "success", "models": ["infinitetalk", "Wan2.1-I2V-14B-480P"]}


@app.cls(
    image=image,
    gpu=GPU_CONFIG,
    volumes={MODEL_DIR: model_volume},
    timeout=900,  # 15 min max per request
    container_idle_timeout=300,  # Keep warm for 5 min
    secrets=[
        modal.Secret.from_name("infinitetalk-auth"),
        modal.Secret.from_name("huggingface", required=False),
    ],
)
class InfiniteTalk:
    """InfiniteTalk inference class with GPU acceleration."""

    pipeline = None

    @modal.enter()
    def load_model(self):
        """Load model on container startup (runs once per cold start)."""
        import torch

        print("Loading InfiniteTalk model...")
        start = time.time()

        # Check if weights exist
        model_path = Path(MODEL_DIR) / "infinitetalk"
        if not model_path.exists():
            raise RuntimeError(
                f"Model weights not found at {model_path}. "
                "Run 'modal run modal/infinitetalk_app.py::download_weights' first."
            )

        # Import InfiniteTalk (will be installed via pip in future, for now import from downloaded)
        # For MVP, we'll use the model directly via diffusers/transformers

        # Load the model components
        # Note: The actual InfiniteTalk loading depends on the model's implementation
        # This is a placeholder that will be updated based on the actual model structure

        print(f"Model loaded in {time.time() - start:.2f}s")
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    def _verify_auth(self, auth_header: Optional[str]) -> None:
        """Verify Bearer token authentication."""
        expected_token = os.environ.get("AUTH_TOKEN")

        if not expected_token:
            raise HTTPException(status_code=500, detail="AUTH_TOKEN not configured")

        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing authorization header")

        token = auth_header[7:]  # Remove "Bearer " prefix

        if token != expected_token:
            raise HTTPException(status_code=403, detail="Invalid API key")

    def _download_file(self, url: str, suffix: str) -> str:
        """Download file from URL to temp directory."""
        import requests

        response = requests.get(url, timeout=120)
        response.raise_for_status()

        fd, path = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, 'wb') as f:
            f.write(response.content)

        return path

    def _run_inference(
        self,
        image_path: Optional[str],
        video_path: Optional[str],
        audio_path: str,
        resolution: str,
    ) -> bytes:
        """
        Run InfiniteTalk inference and return video bytes.

        This is a placeholder implementation. The actual implementation
        will depend on the InfiniteTalk model's API.
        """
        import subprocess
        import torch

        # Determine output dimensions
        if resolution == "720":
            width, height = 1280, 720
        else:
            width, height = 854, 480

        output_path = tempfile.mktemp(suffix=".mp4")

        # Placeholder: For now, create a simple test video using ffmpeg
        # This will be replaced with actual InfiniteTalk inference
        input_file = video_path or image_path

        if input_file:
            # Create video from input + audio
            cmd = [
                "ffmpeg", "-y",
                "-loop", "1" if image_path else "0",
                "-i", input_file,
                "-i", audio_path,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-ar", "48000",
                "-shortest",
                "-vf", f"scale={width}:{height}",
                "-movflags", "+faststart",
                output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg failed: {result.stderr}")
        else:
            raise ValueError("Either image_url or video_url is required")

        # Read output video
        with open(output_path, "rb") as f:
            video_bytes = f.read()

        # Cleanup
        os.unlink(output_path)

        return video_bytes

    @modal.method()
    def process_job(self, job_id: str, request: dict) -> None:
        """Process a generation job in the background."""
        try:
            # Update status to processing
            job_dict[job_id] = {"status": "processing"}

            # Download input files
            image_path = None
            video_path = None

            if request.get("image_url"):
                image_path = self._download_file(request["image_url"], ".jpg")
            if request.get("video_url"):
                video_path = self._download_file(request["video_url"], ".mp4")

            audio_path = self._download_file(request["audio_url"], ".wav")

            # Run inference
            video_bytes = self._run_inference(
                image_path=image_path,
                video_path=video_path,
                audio_path=audio_path,
                resolution=request.get("resolution", "720"),
            )

            # Encode to base64
            video_base64 = base64.b64encode(video_bytes).decode("utf-8")

            # Update job with result
            job_dict[job_id] = {
                "status": "completed",
                "video": video_base64,
            }

            # Cleanup temp files
            if image_path and os.path.exists(image_path):
                os.unlink(image_path)
            if video_path and os.path.exists(video_path):
                os.unlink(video_path)
            if os.path.exists(audio_path):
                os.unlink(audio_path)

        except Exception as e:
            job_dict[job_id] = {
                "status": "failed",
                "error": str(e),
            }

    @modal.fastapi_endpoint(method="POST", docs=True)
    def generate(self, request: GenerateRequest, authorization: Optional[str] = None) -> GenerateResponse:
        """
        Submit a new generation job.

        Returns immediately with a job_id. Poll /status/{job_id} for results.
        """
        # Note: In production, uncomment auth verification
        # self._verify_auth(authorization)

        # Validate input
        if not request.image_url and not request.video_url:
            raise HTTPException(
                status_code=400,
                detail="Either image_url or video_url is required"
            )

        if request.image_url and request.video_url:
            raise HTTPException(
                status_code=400,
                detail="Provide only one of image_url or video_url, not both"
            )

        if request.resolution not in ("480", "720"):
            raise HTTPException(
                status_code=400,
                detail="resolution must be '480' or '720'"
            )

        # Create job
        job_id = str(uuid.uuid4())
        job_dict[job_id] = {"status": "queued"}

        # Spawn background processing
        self.process_job.spawn(job_id, request.model_dump())

        return GenerateResponse(job_id=job_id, status="queued")

    @modal.fastapi_endpoint(method="GET", docs=True)
    def status(self, job_id: str, authorization: Optional[str] = None) -> StatusResponse:
        """
        Check status of a generation job.

        Returns video as base64 when completed.
        """
        # Note: In production, uncomment auth verification
        # self._verify_auth(authorization)

        job_data = job_dict.get(job_id)

        if not job_data:
            raise HTTPException(status_code=404, detail="Job not found")

        return StatusResponse(
            job_id=job_id,
            status=job_data.get("status", "unknown"),
            video=job_data.get("video"),
            error=job_data.get("error"),
        )


# ============= Local Entrypoint =============

@app.local_entrypoint()
def main():
    """Local test entrypoint."""
    print("InfiniteTalk Modal App")
    print("=" * 40)
    print("\nCommands:")
    print("  modal run modal/infinitetalk_app.py::download_weights  # Download model weights")
    print("  modal serve modal/infinitetalk_app.py                  # Development server")
    print("  modal deploy modal/infinitetalk_app.py                 # Production deployment")
    print("\nEndpoints (after deployment):")
    print("  POST /generate  - Submit generation job")
    print("  GET  /status    - Check job status")
