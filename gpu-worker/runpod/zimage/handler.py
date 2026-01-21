"""RunPod Serverless Handler for Z-Image Text-to-Image Generation."""
import logging
import os
import time
import uuid

import boto3
import runpod
from botocore.config import Config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Global model instance (loaded once on cold start)
_generator = None


def get_generator():
    """Lazy load the Z-Image generator."""
    global _generator
    if _generator is None:
        logger.info("Loading Z-Image model...")
        import torch
        from diffusers import ZImagePipeline

        # Use HuggingFace model ID - will download and cache automatically
        model_path = os.environ.get("ZIMAGE_MODEL_PATH", "Tongyi-MAI/Z-Image-Turbo")
        device = "cuda" if torch.cuda.is_available() else "cpu"

        logger.info(f"Loading model from {model_path}...")
        _generator = ZImagePipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
            cache_dir=os.environ.get("HF_HOME", "/runpod-volume/cache"),
        )
        _generator.to(device)

        # Enable memory optimizations
        if hasattr(_generator, "enable_attention_slicing"):
            _generator.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded on {device}. VRAM: {vram:.1f}GB")

    return _generator


def upload_to_r2(local_path: str, job_id: str, content_type: str = "image/png") -> str:
    """Upload file to R2 storage."""
    endpoint = os.environ.get("R2_ENDPOINT", "")
    access_key = os.environ.get("R2_ACCESS_KEY", "")
    secret_key = os.environ.get("R2_SECRET_KEY", "")
    bucket = os.environ.get("R2_BUCKET", "ffmpeg-output")
    public_url = os.environ.get("R2_PUBLIC_URL", "")

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
    ext = ext_map.get(content_type, "png")
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


def handler(event: dict) -> dict:
    """
    RunPod serverless handler for Z-Image text-to-image generation.

    Input:
        prompt: str - Text prompt (supports English and Chinese)
        negativePrompt: str - Negative prompt (optional)
        width: int - Output width (default: 1024)
        height: int - Output height (default: 1024)
        steps: int - Inference steps (default: 9 for Turbo)
        guidanceScale: float - Guidance scale (default: 0 for Turbo)
        seed: int - Random seed (optional)
        jobId: str - Optional job ID for output naming

    Returns:
        url: str - URL to the generated image
        contentType: str - MIME type
        fileSizeBytes: int - File size
        width: int - Image width
        height: int - Image height
        processingTimeMs: int - Processing time in milliseconds
    """
    start_time = time.time()
    job_input = event.get("input", {})

    # Extract parameters
    prompt = job_input.get("prompt", "")
    negative_prompt = job_input.get("negativePrompt", "")
    width = job_input.get("width", 1024)
    height = job_input.get("height", 1024)
    steps = job_input.get("steps", 9)
    guidance_scale = job_input.get("guidanceScale", 0.0)
    seed = job_input.get("seed")
    job_id = job_input.get("jobId", str(uuid.uuid4()))

    logger.info(f"Processing job {job_id}: prompt='{prompt[:50]}...', size={width}x{height}")

    if not prompt:
        return {"error": "Missing required field: prompt"}

    local_image = None

    try:
        import torch

        # Load generator
        pipeline = get_generator()
        device = "cuda" if torch.cuda.is_available() else "cpu"

        # Set seed for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device=device).manual_seed(seed)

        # Generate image
        result = pipeline(
            prompt=prompt,
            negative_prompt=negative_prompt or "blurry, low quality, distorted, artifact",
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=guidance_scale,
            generator=generator,
        )

        # Save image
        local_image = f"/tmp/output_{job_id}.png"
        image = result.images[0]
        image.save(local_image, "PNG")

        # Upload to R2
        image_url = upload_to_r2(local_image, job_id, "image/png")

        # Get file size
        file_size = os.path.getsize(local_image)

        processing_time_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Job {job_id} completed in {processing_time_ms}ms")

        return {
            "url": image_url,
            "contentType": "image/png",
            "fileSizeBytes": file_size,
            "width": width,
            "height": height,
            "processingTimeMs": processing_time_ms,
        }

    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}")
        return {"error": str(e)}

    finally:
        # Cleanup temp files
        if local_image and os.path.exists(local_image):
            try:
                os.remove(local_image)
            except OSError:
                pass


# Start the serverless handler
runpod.serverless.start({"handler": handler})
