"""RunPod Serverless Handler for LTX-2 Image-to-Video Generation."""
import logging
import os
import time
import uuid

# Fix for torch.xpu attribute error in some diffusers versions
# Diffusers checks for Intel XPU support which doesn't exist on NVIDIA GPUs
import torch
if not hasattr(torch, 'xpu'):
    class MockXPU:
        """Mock XPU module for environments without Intel XPU support."""
        @staticmethod
        def is_available():
            return False
        @staticmethod
        def empty_cache():
            pass
        @staticmethod
        def device_count():
            return 0
        @staticmethod
        def manual_seed(seed):
            pass
        @staticmethod
        def manual_seed_all(seed):
            pass
        @staticmethod
        def synchronize():
            pass
        @staticmethod
        def current_device():
            return 0
        @staticmethod
        def get_device_name(device=None):
            return "Mock XPU Device"
        @staticmethod
        def memory_allocated(device=None):
            return 0
        @staticmethod
        def max_memory_allocated(device=None):
            return 0
        @staticmethod
        def reset_peak_memory_stats(device=None):
            pass
    torch.xpu = MockXPU()

import boto3
import requests
import runpod
from botocore.config import Config
from PIL import Image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Global model instance (loaded once on cold start)
_generator = None


def get_generator():
    """Lazy load the LTX-2 generator."""
    global _generator
    if _generator is None:
        logger.info("Loading LTX-2 model...")
        import torch
        from diffusers import LTXImageToVideoPipeline

        # Use HuggingFace model ID - will download and cache automatically
        model_path = os.environ.get("LTX2_MODEL_PATH", "Lightricks/LTX-Video")
        device = "cuda" if torch.cuda.is_available() else "cpu"

        logger.info(f"Loading model from {model_path}...")
        _generator = LTXImageToVideoPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
            cache_dir=os.environ.get("HF_HOME", "/runpod-volume/cache"),
        )
        _generator.to(device)

        if hasattr(_generator, "enable_attention_slicing"):
            _generator.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded on {device}. VRAM: {vram:.1f}GB")

    return _generator


def download_image(url: str, local_path: str) -> str:
    """Download image from URL to local path."""
    logger.info(f"Downloading {url}")
    response = requests.get(url, stream=True, timeout=300)
    response.raise_for_status()

    with open(local_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)

    return local_path


def upload_to_r2(local_path: str, job_id: str, content_type: str = "video/mp4") -> str:
    """Upload file to R2 storage."""
    endpoint = os.environ.get("R2_ENDPOINT", "")
    access_key = os.environ.get("R2_ACCESS_KEY", "")
    secret_key = os.environ.get("R2_SECRET_KEY", "")
    bucket = os.environ.get("R2_BUCKET", "ffmpeg-rest")
    public_url = os.environ.get("R2_PUBLIC_URL", "")

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    ext_map = {"video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg"}
    ext = ext_map.get(content_type, "bin")
    key = f"outputs/{job_id}/output.{ext}"

    logger.info(f"Uploading to {key}")
    s3.upload_file(
        local_path,
        bucket,
        key,
        ExtraArgs={"ContentType": content_type},
    )

    if public_url:
        return f"{public_url}/{key}"

    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=86400 * 7,
    )


def export_video(frames: list, output_path: str, fps: int) -> None:
    """Export frames to video file."""
    import imageio
    import numpy as np

    writer = imageio.get_writer(output_path, fps=fps, codec="libx264")
    for frame in frames:
        if hasattr(frame, "convert"):
            frame = np.array(frame)
        writer.append_data(frame)
    writer.close()


def get_video_info(video_path: str) -> dict:
    """Get video metadata."""
    import imageio

    reader = imageio.get_reader(video_path)
    meta = reader.get_meta_data()
    reader.close()

    return {
        "width": meta.get("size", [0, 0])[0],
        "height": meta.get("size", [0, 0])[1],
        "duration_ms": int(meta.get("duration", 0) * 1000),
    }


def handler(event: dict) -> dict:
    """
    RunPod serverless handler for LTX-2 image-to-video generation.

    Input:
        imageUrl: str - URL of the source image
        prompt: str - Text prompt for video generation
        duration: int - Video duration in seconds (default: 5)
        fps: int - Frames per second (default: 24)
        width: int - Output width (default: 1024)
        height: int - Output height (default: 576)
        numInferenceSteps: int - Number of diffusion steps (default: 30)
        guidanceScale: float - Guidance scale (default: 7.5)
        jobId: str - Optional job ID for output naming

    Returns:
        url: str - URL to the generated video
        contentType: str - MIME type
        fileSizeBytes: int - File size
        durationMs: int - Video duration in milliseconds
        width: int - Video width
        height: int - Video height
        processingTimeMs: int - Processing time in milliseconds
    """
    start_time = time.time()
    job_input = event.get("input", {})

    # Extract parameters
    image_url = job_input.get("imageUrl", "")
    prompt = job_input.get("prompt", "")
    duration = job_input.get("duration", 5)
    fps = job_input.get("fps", 24)
    width = job_input.get("width", 1024)
    height = job_input.get("height", 576)
    num_inference_steps = job_input.get("numInferenceSteps", 30)
    guidance_scale = job_input.get("guidanceScale", 7.5)
    job_id = job_input.get("jobId", str(uuid.uuid4()))

    logger.info(
        f"Processing job {job_id}: duration={duration}s, steps={num_inference_steps}, guidance={guidance_scale}"
    )

    if not image_url:
        return {"error": "Missing required field: imageUrl"}

    local_image = f"/tmp/{job_id}_input.jpg"
    local_video = None

    try:
        # Download input image
        download_image(image_url, local_image)

        # Load generator
        pipeline = get_generator()

        # Load and prepare image
        image = Image.open(local_image).convert("RGB")

        # Calculate frame count (must be divisible by 8 + 1 for LTX)
        num_frames = (duration * fps // 8) * 8 + 1

        # Generate video
        result = pipeline(
            image=image,
            prompt=prompt or "A smooth cinematic video",
            negative_prompt="blurry, low quality, distorted, artifact",
            num_frames=num_frames,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
        )

        # Export to video file
        local_video = f"/tmp/output_{job_id}.mp4"
        export_video(result.frames[0], local_video, fps)

        # Upload to R2
        video_url = upload_to_r2(local_video, job_id, "video/mp4")

        # Get metadata
        file_size = os.path.getsize(local_video)
        video_info = get_video_info(local_video)

        processing_time_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Job {job_id} completed in {processing_time_ms}ms")

        return {
            "url": video_url,
            "contentType": "video/mp4",
            "fileSizeBytes": file_size,
            "durationMs": video_info["duration_ms"],
            "width": video_info["width"],
            "height": video_info["height"],
            "processingTimeMs": processing_time_ms,
        }

    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}")
        return {"error": str(e)}

    finally:
        # Cleanup temp files
        for f in [local_image, local_video]:
            if f and os.path.exists(f):
                try:
                    os.remove(f)
                except OSError:
                    pass


# Start the serverless handler
runpod.serverless.start({"handler": handler})
