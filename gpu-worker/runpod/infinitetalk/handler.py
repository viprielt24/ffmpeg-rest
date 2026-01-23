"""RunPod Serverless Handler for InfiniteTalk Audio-Driven Video Generation."""
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
INFINITETALK_DIR = os.environ.get("INFINITETALK_DIR", "/workspace/InfiniteTalk")
WAN_WEIGHTS_DIR = os.environ.get("WAN_WEIGHTS_DIR", "/runpod-volume/weights/Wan2.1-I2V-14B-480P")
WAV2VEC_DIR = os.environ.get("WAV2VEC_DIR", "/runpod-volume/weights/chinese-wav2vec2-base")
INFINITETALK_WEIGHTS_DIR = os.environ.get("INFINITETALK_WEIGHTS_DIR", "/runpod-volume/weights/InfiniteTalk")

# Flag to track if models are loaded
_models_ready = False


def ensure_models_downloaded():
    """Download models from HuggingFace if not already present."""
    global _models_ready
    if _models_ready:
        return

    from huggingface_hub import snapshot_download, hf_hub_download

    hf_token = os.environ.get("HF_TOKEN")
    cache_dir = os.environ.get("HF_HOME", "/runpod-volume/cache")

    # Download Wan2.1-I2V-14B-480P base model
    if not os.path.exists(WAN_WEIGHTS_DIR) or not os.listdir(WAN_WEIGHTS_DIR):
        logger.info("Downloading Wan2.1-I2V-14B-480P weights...")
        os.makedirs(WAN_WEIGHTS_DIR, exist_ok=True)
        snapshot_download(
            "Wan-AI/Wan2.1-I2V-14B-480P",
            local_dir=WAN_WEIGHTS_DIR,
            cache_dir=cache_dir,
            token=hf_token,
        )
        logger.info("Wan2.1 weights downloaded.")

    # Download chinese-wav2vec2-base
    if not os.path.exists(WAV2VEC_DIR) or not os.listdir(WAV2VEC_DIR):
        logger.info("Downloading chinese-wav2vec2-base weights...")
        os.makedirs(WAV2VEC_DIR, exist_ok=True)
        snapshot_download(
            "TencentGameMate/chinese-wav2vec2-base",
            local_dir=WAV2VEC_DIR,
            cache_dir=cache_dir,
            token=hf_token,
        )
        # Also download safetensors from PR
        hf_hub_download(
            "TencentGameMate/chinese-wav2vec2-base",
            filename="model.safetensors",
            revision="refs/pr/1",
            local_dir=WAV2VEC_DIR,
            token=hf_token,
        )
        logger.info("Wav2vec weights downloaded.")

    # Download InfiniteTalk model
    if not os.path.exists(INFINITETALK_WEIGHTS_DIR) or not os.listdir(INFINITETALK_WEIGHTS_DIR):
        logger.info("Downloading InfiniteTalk weights...")
        os.makedirs(INFINITETALK_WEIGHTS_DIR, exist_ok=True)
        snapshot_download(
            "MeiGen-AI/InfiniteTalk",
            local_dir=INFINITETALK_WEIGHTS_DIR,
            cache_dir=cache_dir,
            token=hf_token,
        )
        logger.info("InfiniteTalk weights downloaded.")

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


def get_audio_duration(audio_path: str) -> float:
    """Get audio duration in seconds using librosa."""
    import librosa

    y, sr = librosa.load(audio_path, sr=None)
    return librosa.get_duration(y=y, sr=sr)


def calculate_frames(audio_duration: float, fps: int = 25) -> int:
    """Calculate frame count based on audio duration.

    Frames must follow the pattern 4n+1 for InfiniteTalk compatibility.
    """
    raw_frames = int(audio_duration * fps) - 10  # Buffer
    # Round to nearest 4n+1 pattern
    n = (raw_frames - 1) // 4
    return max(4 * n + 1, 81)  # Minimum 81 frames


def get_size_string(resolution: str, aspect_ratio: str) -> str:
    """Get size string for InfiniteTalk based on resolution and aspect ratio.

    Wan2.1 supports:
    - 720P: 1280x720 (16:9) or 720x1280 (9:16)
    - 480P: 832x480 (16:9) or 480x832 (9:16)
    """
    if resolution == "720":
        return "720*1280" if aspect_ratio == "9:16" else "1280*720"
    else:
        return "480*832" if aspect_ratio == "9:16" else "832*480"


def handler(event: dict) -> dict:
    """
    RunPod serverless handler for InfiniteTalk generation.

    Input:
        audioUrl: str - URL to audio file (WAV/MP3)
        imageUrl: str - URL to reference image (required if no videoUrl)
        videoUrl: str - URL to reference video (required if no imageUrl)
        resolution: str - Output resolution: '480' or '720' (default: '720')
        aspectRatio: str - Aspect ratio: '16:9' or '9:16' (default: '16:9')
        sampleSteps: int - Sampling steps (default: 8, higher = better quality but slower)
        audioGuideScale: float - Audio guidance scale (default: 6.0)
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
    video_url = job_input.get("videoUrl", "")
    resolution = job_input.get("resolution", "720")
    aspect_ratio = job_input.get("aspectRatio", "16:9")
    sample_steps = job_input.get("sampleSteps", 8)
    audio_guide_scale = job_input.get("audioGuideScale", 6.0)
    job_id = job_input.get("jobId", str(uuid.uuid4()))

    logger.info(f"Processing job {job_id}: resolution={resolution}, aspect_ratio={aspect_ratio}")

    # Validation
    if not audio_url:
        return {"error": "Missing required field: audioUrl"}

    if not image_url and not video_url:
        return {"error": "Either imageUrl or videoUrl is required"}

    if image_url and video_url:
        return {"error": "Provide only one of imageUrl or videoUrl"}

    if resolution not in ("480", "720"):
        return {"error": "resolution must be '480' or '720'"}

    if aspect_ratio not in ("16:9", "9:16"):
        return {"error": "aspectRatio must be '16:9' or '9:16'"}

    # Create temp directory for this job
    work_dir = tempfile.mkdtemp(prefix=f"infinitetalk_{job_id}_")
    local_audio = os.path.join(work_dir, "input_audio.wav")
    local_image = os.path.join(work_dir, "input_image.jpg") if image_url else None
    local_video = os.path.join(work_dir, "input_video.mp4") if video_url else None
    output_dir = os.path.join(work_dir, "output")
    input_json_path = os.path.join(work_dir, "input.json")

    os.makedirs(output_dir, exist_ok=True)

    try:
        # Download input files
        download_file(audio_url, local_audio)
        if image_url:
            download_file(image_url, local_image)
        if video_url:
            download_file(video_url, local_video)

        # Calculate frame count from audio duration
        audio_duration = get_audio_duration(local_audio)
        frame_num = calculate_frames(audio_duration)
        mode = "clip" if frame_num <= 81 else "streaming"

        logger.info(f"Audio duration: {audio_duration:.2f}s, frames: {frame_num}, mode: {mode}")

        # Get size string
        size = get_size_string(resolution, aspect_ratio)
        logger.info(f"Size: {size}")

        # Create input JSON for InfiniteTalk
        input_data = {
            "prompt": "A person speaking naturally",
            "cond_video": local_image if local_image else local_video,
            "cond_audio": {"person1": local_audio},
            "audio_type": "para"
        }

        with open(input_json_path, "w") as f:
            json.dump(input_data, f)

        # Build inference command
        infinitetalk_ckpt = os.path.join(INFINITETALK_WEIGHTS_DIR, "single", "infinitetalk.safetensors")

        cmd = [
            "python", os.path.join(INFINITETALK_DIR, "generate_infinitetalk.py"),
            "--ckpt_dir", WAN_WEIGHTS_DIR,
            "--wav2vec_dir", WAV2VEC_DIR,
            "--infinitetalk_dir", infinitetalk_ckpt,
            "--input_json", input_json_path,
            "--size", size,
            "--sample_steps", str(sample_steps),
            "--mode", mode,
            "--frame_num", str(frame_num),
            "--motion_frame", "9",
            "--sample_audio_guide_scale", str(audio_guide_scale),
            "--save_file", output_dir,
            # Speed optimizations
            "--offload_model", "False",
            "--use_teacache", "True",
            "--teacache_thresh", "0.3",
            "--num_persistent_param_in_dit", "500000000",
        ]

        logger.info(f"Running: {' '.join(cmd)}")

        # Run inference
        env = {**os.environ, "PYTHONPATH": INFINITETALK_DIR}
        process = subprocess.run(
            cmd,
            cwd=INFINITETALK_DIR,
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min timeout
            env=env,
        )

        logger.info(f"STDOUT: {process.stdout}")
        if process.stderr:
            logger.info(f"STDERR: {process.stderr}")

        if process.returncode != 0:
            logger.error(f"Inference failed: {process.stderr}")
            return {"error": f"Inference failed: {process.stderr[:500]}"}

        # Find output video
        from pathlib import Path
        output_files = list(Path(output_dir).rglob("*.mp4"))
        if not output_files:
            return {"error": "No output video generated"}

        local_output = str(output_files[0])
        logger.info(f"Found output: {local_output}")

        # Upload to R2
        video_url_result = upload_to_r2(local_output, job_id, "video/mp4")

        # Get metadata
        file_size = os.path.getsize(local_output)
        video_info = get_video_info(local_output)

        processing_time_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Job {job_id} completed in {processing_time_ms}ms")

        return {
            "url": video_url_result,
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
        import traceback
        traceback.print_exc()
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
