"""RunPod Serverless Handler for LongCat-Video-Avatar Generation."""
import json
import logging
import os
import subprocess
import tempfile
import time
import uuid

import boto3
import requests
import runpod
from botocore.config import Config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Model paths
LONGCAT_DIR = os.environ.get("LONGCAT_DIR", "/workspace/LongCat-Video")
CHECKPOINT_DIR = os.environ.get("CHECKPOINT_DIR", "/runpod-volume/weights/LongCat-Video-Avatar")
BASE_WEIGHTS_DIR = os.environ.get("BASE_WEIGHTS_DIR", "/runpod-volume/weights/LongCat-Video")

# Flag to track if models are loaded
_models_ready = False


def ensure_models_downloaded():
    """Download models from HuggingFace if not already present."""
    global _models_ready
    if _models_ready:
        return

    from huggingface_hub import snapshot_download

    # Download base LongCat-Video weights
    if not os.path.exists(BASE_WEIGHTS_DIR) or not os.listdir(BASE_WEIGHTS_DIR):
        logger.info("Downloading LongCat-Video base weights...")
        os.makedirs(BASE_WEIGHTS_DIR, exist_ok=True)
        snapshot_download(
            "meituan-longcat/LongCat-Video",
            local_dir=BASE_WEIGHTS_DIR,
            cache_dir=os.environ.get("HF_HOME", "/runpod-volume/cache"),
        )
        logger.info("Base weights downloaded.")

    # Download LongCat-Video-Avatar weights
    if not os.path.exists(CHECKPOINT_DIR) or not os.listdir(CHECKPOINT_DIR):
        logger.info("Downloading LongCat-Video-Avatar weights...")
        os.makedirs(CHECKPOINT_DIR, exist_ok=True)
        snapshot_download(
            "meituan-longcat/LongCat-Video-Avatar",
            local_dir=CHECKPOINT_DIR,
            cache_dir=os.environ.get("HF_HOME", "/runpod-volume/cache"),
        )
        logger.info("Avatar weights downloaded.")

    _models_ready = True
    logger.info("All models ready.")


def download_file(url: str, local_path: str) -> str:
    """Download file from URL to local path."""
    logger.info(f"Downloading {url}")
    response = requests.get(url, stream=True, timeout=600)
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

    ext_map = {"video/mp4": "mp4", "image/png": "png", "image/jpeg": "jpg"}
    ext = ext_map.get(content_type, "mp4")
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


def get_video_info(video_path: str) -> dict:
    """Get video metadata using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration",
            "-of", "csv=p=0",
            video_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        parts = result.stdout.strip().split(",")

        width = int(parts[0]) if len(parts) > 0 else 0
        height = int(parts[1]) if len(parts) > 1 else 0
        duration = float(parts[2]) if len(parts) > 2 else 0

        return {
            "width": width,
            "height": height,
            "duration_ms": int(duration * 1000),
        }
    except Exception as e:
        logger.warning(f"Could not get video info: {e}")
        return {"width": 0, "height": 0, "duration_ms": 0}


def handler(event: dict) -> dict:
    """
    RunPod serverless handler for LongCat-Video-Avatar generation.

    Input:
        audioUrl: str - URL to audio file (WAV/MP3)
        imageUrl: str - URL to reference image (optional for at2v mode)
        prompt: str - Text prompt describing the avatar/scene
        mode: str - Generation mode: 'at2v' (audio+text) or 'ai2v' (audio+image)
        resolution: str - Output resolution: '480P' or '720P' (default: '480P')
        audioCfg: float - Audio guidance scale (default: 4.0)
        numSegments: int - Number of video segments for longer videos (default: 1)
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

    # Ensure models are downloaded
    ensure_models_downloaded()

    # Extract parameters
    audio_url = job_input.get("audioUrl", "")
    image_url = job_input.get("imageUrl", "")
    prompt = job_input.get("prompt", "A person talking naturally")
    mode = job_input.get("mode", "ai2v")  # ai2v requires image, at2v doesn't
    resolution = job_input.get("resolution", "480P")
    audio_cfg = job_input.get("audioCfg", 4.0)
    num_segments = job_input.get("numSegments", 1)
    job_id = job_input.get("jobId", str(uuid.uuid4()))

    logger.info(f"Processing job {job_id}: mode={mode}, resolution={resolution}")

    if not audio_url:
        return {"error": "Missing required field: audioUrl"}

    if mode == "ai2v" and not image_url:
        return {"error": "Missing required field: imageUrl for ai2v mode"}

    # Create temp directory for this job
    work_dir = tempfile.mkdtemp(prefix=f"longcat_{job_id}_")
    local_audio = os.path.join(work_dir, "input_audio.wav")
    local_image = os.path.join(work_dir, "input_image.jpg") if image_url else None
    local_video = os.path.join(work_dir, "output.mp4")
    config_path = os.path.join(work_dir, "config.json")

    try:
        # Download input files
        download_file(audio_url, local_audio)
        if image_url:
            download_file(image_url, local_image)

        # Create input config JSON
        config = {
            "prompt": prompt,
            "audio_path": local_audio,
            "output_path": local_video,
        }
        if local_image:
            config["image_path"] = local_image

        with open(config_path, "w") as f:
            json.dump(config, f)

        # Determine GPU count (use all available)
        import torch
        gpu_count = torch.cuda.device_count()
        if gpu_count == 0:
            return {"error": "No GPU available"}

        logger.info(f"Using {gpu_count} GPU(s) for inference")

        # Build inference command
        script = "run_demo_avatar_single_audio_to_video.py"
        cmd = [
            "torchrun",
            f"--nproc_per_node={gpu_count}",
            os.path.join(LONGCAT_DIR, script),
            f"--context_parallel_size={gpu_count}",
            f"--checkpoint_dir={CHECKPOINT_DIR}",
            f"--stage_1={mode}",
            f"--input_json={config_path}",
            f"--resolution={resolution}",
            f"--audio_cfg={audio_cfg}",
        ]

        if num_segments > 1:
            cmd.extend([
                f"--num_segments={num_segments}",
                "--ref_img_index=10",
                "--mask_frame_range=3",
            ])

        logger.info(f"Running: {' '.join(cmd)}")

        # Run inference
        process = subprocess.run(
            cmd,
            cwd=LONGCAT_DIR,
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min timeout
        )

        if process.returncode != 0:
            logger.error(f"Inference failed: {process.stderr}")
            return {"error": f"Inference failed: {process.stderr[:500]}"}

        if not os.path.exists(local_video):
            return {"error": "No output video generated"}

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

    except subprocess.TimeoutExpired:
        return {"error": "Inference timed out after 30 minutes"}
    except Exception as e:
        logger.error(f"Job {job_id} failed: {str(e)}")
        return {"error": str(e)}

    finally:
        # Cleanup temp directory
        import shutil
        if os.path.exists(work_dir):
            try:
                shutil.rmtree(work_dir)
            except OSError:
                pass


# Start the serverless handler
runpod.serverless.start({"handler": handler})
