"""RunPod Serverless Handler for LTX-Video Image-to-Video Generation (13B Model)."""
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

# Global model instances (loaded once on cold start)
_pipeline = None
_upscaler = None

# Default negative prompt for high quality output
DEFAULT_NEGATIVE_PROMPT = "worst quality, inconsistent motion, blurry, jittery, distorted, low resolution, pixelated, artifacts, noise, overexposed, underexposed"


def get_pipeline():
    """Lazy load the LTX-Video pipeline (13B model)."""
    global _pipeline
    if _pipeline is None:
        logger.info("Loading LTX-Video 13B model...")
        import torch
        from diffusers import LTXConditionPipeline

        # Use 13B model for higher quality - can be overridden via env var
        model_id = os.environ.get("LTX_MODEL_ID", "Lightricks/LTX-Video-0.9.7-dev")
        cache_dir = os.environ.get("HF_HOME", "/runpod-volume/cache")

        logger.info(f"Loading model: {model_id}")
        _pipeline = LTXConditionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            cache_dir=cache_dir,
        )
        _pipeline.to("cuda")

        # Enable VAE tiling for memory efficiency at higher resolutions
        if hasattr(_pipeline, "vae") and hasattr(_pipeline.vae, "enable_tiling"):
            _pipeline.vae.enable_tiling()
            logger.info("VAE tiling enabled")

        vram = torch.cuda.memory_allocated() / 1e9
        logger.info(f"Pipeline loaded. VRAM usage: {vram:.1f}GB")

    return _pipeline


def get_upscaler():
    """Lazy load the spatial upscaler (optional, for 2x upscaling)."""
    global _upscaler
    if _upscaler is None:
        # Only load if explicitly enabled
        if os.environ.get("ENABLE_UPSCALER", "false").lower() != "true":
            return None

        logger.info("Loading LTX spatial upscaler...")
        from diffusers import LTXLatentUpsamplePipeline

        pipeline = get_pipeline()
        upscaler_id = os.environ.get("LTX_UPSCALER_ID", "Lightricks/ltxv-spatial-upscaler-0.9.7")
        cache_dir = os.environ.get("HF_HOME", "/runpod-volume/cache")

        _upscaler = LTXLatentUpsamplePipeline.from_pretrained(
            upscaler_id,
            vae=pipeline.vae,
            torch_dtype=torch.bfloat16,
            cache_dir=cache_dir,
        )
        _upscaler.to("cuda")
        logger.info("Upscaler loaded")

    return _upscaler


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
    from diffusers.utils import export_to_video
    export_to_video(frames, output_path, fps=fps)


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


def round_to_nearest_acceptable(height: int, width: int, divisor: int = 32) -> tuple:
    """Round dimensions to nearest value acceptable by VAE."""
    height = height - (height % divisor)
    width = width - (width % divisor)
    return height, width


def handler(event: dict) -> dict:
    """
    RunPod serverless handler for LTX-Video image-to-video generation (13B model).

    Input:
        imageUrl: str - URL of the source image (required)
        prompt: str - Text prompt for video generation
        negativePrompt: str - Negative prompt (default: comprehensive quality penalties)
        duration: int - Video duration in seconds (default: 5)
        fps: int - Frames per second (default: 24)
        width: int - Output width (default: 768, must be divisible by 32)
        height: int - Output height (default: 512, must be divisible by 32)
        numInferenceSteps: int - Number of diffusion steps (default: 30)
        guidanceScale: float - Guidance scale (default: 5.0)
        guidanceRescale: float - Guidance rescale (default: 0.7)
        decodeTimestep: float - Decode timestep (default: 0.05)
        imageCondNoiseScale: float - Image conditioning noise (default: 0.025)
        seed: int - Random seed for reproducibility (optional)
        useUpscaler: bool - Enable 2x upscaling (default: false, requires ENABLE_UPSCALER=true)
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

    # Extract parameters with improved defaults
    image_url = job_input.get("imageUrl", "")
    prompt = job_input.get("prompt", "A smooth cinematic video with natural motion")
    negative_prompt = job_input.get("negativePrompt", DEFAULT_NEGATIVE_PROMPT)
    duration = job_input.get("duration", 5)
    fps = job_input.get("fps", 24)
    width = job_input.get("width", 768)
    height = job_input.get("height", 512)
    num_inference_steps = job_input.get("numInferenceSteps", 30)
    guidance_scale = job_input.get("guidanceScale", 5.0)
    guidance_rescale = job_input.get("guidanceRescale", 0.7)
    decode_timestep = job_input.get("decodeTimestep", 0.05)
    image_cond_noise_scale = job_input.get("imageCondNoiseScale", 0.025)
    seed = job_input.get("seed")
    use_upscaler = job_input.get("useUpscaler", False)
    job_id = job_input.get("jobId", str(uuid.uuid4()))

    logger.info(
        f"Processing job {job_id}: {width}x{height}, duration={duration}s, "
        f"steps={num_inference_steps}, guidance={guidance_scale}"
    )

    if not image_url:
        return {"error": "Missing required field: imageUrl"}

    local_image = f"/tmp/{job_id}_input.jpg"
    local_video = None

    try:
        # Download input image
        download_image(image_url, local_image)

        # Load pipeline
        pipeline = get_pipeline()

        # Import condition class
        from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition
        from diffusers.utils import load_video, export_to_video as _export

        # Load and prepare image as video condition
        image = Image.open(local_image).convert("RGB")

        # Resize image to target dimensions
        image = image.resize((width, height), Image.Resampling.LANCZOS)

        # Save resized image temporarily for video loading
        temp_image_path = f"/tmp/{job_id}_resized.jpg"
        image.save(temp_image_path)

        # Export single frame as video for conditioning (required format)
        temp_video_path = f"/tmp/{job_id}_cond.mp4"
        _export([image], temp_video_path, fps=1)
        video_cond = load_video(temp_video_path)

        # Create condition from the image
        condition = LTXVideoCondition(video=video_cond, frame_index=0)

        # Round dimensions to acceptable values
        height, width = round_to_nearest_acceptable(height, width, 32)

        # Calculate frame count (must be divisible by 8 + 1 for LTX)
        num_frames = (duration * fps // 8) * 8 + 1

        # Setup generator for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device="cuda").manual_seed(seed)

        # Generate video
        logger.info(f"Generating {num_frames} frames at {width}x{height}...")

        if use_upscaler and get_upscaler() is not None:
            # Two-stage generation with upscaling
            upscaler = get_upscaler()

            # Stage 1: Generate at lower resolution
            downscale_factor = 0.5
            down_height = int(height * downscale_factor)
            down_width = int(width * downscale_factor)
            down_height, down_width = round_to_nearest_acceptable(down_height, down_width, 32)

            logger.info(f"Stage 1: Generating at {down_width}x{down_height}")
            latents = pipeline(
                conditions=[condition],
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=down_width,
                height=down_height,
                num_frames=num_frames,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                guidance_rescale=guidance_rescale,
                decode_timestep=decode_timestep,
                image_cond_noise_scale=image_cond_noise_scale,
                generator=generator,
                output_type="latent",
            ).frames

            # Stage 2: Upscale
            logger.info("Stage 2: Upscaling...")
            upscaled_latents = upscaler(
                latents=latents,
                output_type="latent",
            ).frames

            # Stage 3: Denoise upscaled
            logger.info("Stage 3: Denoising upscaled video...")
            result = pipeline(
                conditions=[condition],
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=down_width * 2,
                height=down_height * 2,
                num_frames=num_frames,
                denoise_strength=0.4,
                num_inference_steps=10,
                latents=upscaled_latents,
                guidance_scale=guidance_scale,
                guidance_rescale=guidance_rescale,
                decode_timestep=decode_timestep,
                image_cond_noise_scale=image_cond_noise_scale,
                generator=generator,
                output_type="pil",
            )
            frames = result.frames[0]

            # Resize to target if needed
            if down_width * 2 != width or down_height * 2 != height:
                frames = [frame.resize((width, height), Image.Resampling.LANCZOS) for frame in frames]
        else:
            # Standard single-stage generation
            result = pipeline(
                conditions=[condition],
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                num_frames=num_frames,
                num_inference_steps=num_inference_steps,
                guidance_scale=guidance_scale,
                guidance_rescale=guidance_rescale,
                decode_timestep=decode_timestep,
                image_cond_noise_scale=image_cond_noise_scale,
                generator=generator,
                output_type="pil",
            )
            frames = result.frames[0]

        # Export to video file
        local_video = f"/tmp/output_{job_id}.mp4"
        export_video(frames, local_video, fps)

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
        logger.error(f"Job {job_id} failed: {str(e)}", exc_info=True)
        return {"error": str(e)}

    finally:
        # Cleanup temp files
        temp_files = [
            local_image,
            local_video,
            f"/tmp/{job_id}_resized.jpg",
            f"/tmp/{job_id}_cond.mp4",
        ]
        for f in temp_files:
            if f and os.path.exists(f):
                try:
                    os.remove(f)
                except OSError:
                    pass


# Start the serverless handler
runpod.serverless.start({"handler": handler})
