"""LTX-2 Worker main loop."""
import logging
import os
import sys
import time

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from worker.config import settings
from worker.queue_client import BullMQClient
from worker.storage import R2Storage
from worker.webhook import notify_complete, notify_failed
from .inference import LTX2Generator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Main worker loop for LTX-2 video generation."""
    logger.info("=== Starting LTX-2 Worker ===")

    # Initialize components
    generator = LTX2Generator(settings.LTX2_MODEL_PATH)
    queue = BullMQClient(settings.REDIS_URL, "generate:ltx2")
    storage = R2Storage()

    logger.info("Worker ready, polling for jobs...")
    idle_seconds = 0

    while True:
        # Get next job
        job = queue.get_next_job(timeout=5)

        if job is None:
            idle_seconds += 5
            if idle_seconds >= settings.MAX_IDLE_SECONDS:
                logger.info(f"Idle timeout ({settings.MAX_IDLE_SECONDS}s), shutting down...")
                break
            continue

        # Reset idle counter
        idle_seconds = 0
        job_id = job["id"]
        start_time = time.time()

        logger.info(f"Processing job {job_id}")

        # Temp file paths
        local_image = f"/tmp/{job_id}_input.jpg"
        local_video = None

        try:
            queue.update_progress(job_id, 0)

            # Download input image
            image_url = job.get("imageUrl", "")
            if not image_url:
                raise ValueError("Missing imageUrl in job data")

            storage.download_from_url(image_url, local_image)
            queue.update_progress(job_id, 10)

            # Generate video
            def on_progress(p: int):
                # Scale progress from 10-90
                queue.update_progress(job_id, 10 + int(p * 0.8))

            local_video = generator.generate(
                image_path=local_image,
                prompt=job.get("prompt", ""),
                duration=job.get("duration", 5),
                width=job.get("width", 1024),
                height=job.get("height", 576),
                progress_callback=on_progress,
            )
            queue.update_progress(job_id, 90)

            # Upload result
            video_url = storage.upload_output(job_id, local_video, "video/mp4")
            file_size = storage.get_file_size(local_video)
            video_info = generator.get_video_info(local_video)

            queue.update_progress(job_id, 100)

            # Calculate processing time
            processing_time_ms = int((time.time() - start_time) * 1000)

            # Build result
            result = {
                "url": video_url,
                "contentType": "video/mp4",
                "fileSizeBytes": file_size,
                "durationMs": video_info["duration_ms"],
                "width": video_info["width"],
                "height": video_info["height"],
                "processingTimeMs": processing_time_ms,
            }

            # Mark completed in queue
            queue.mark_completed(job_id, result)

            # Send webhook notifications
            notify_complete(job_id, "ltx2", result, job.get("webhookUrl"))

            logger.info(f"Job {job_id} completed in {processing_time_ms}ms")

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Job {job_id} failed: {error_msg}")

            # Mark failed in queue
            queue.mark_failed(job_id, error_msg)

            # Send failure notification
            notify_failed(job_id, "ltx2", error_msg, job.get("webhookUrl"))

        finally:
            # Clean up temp files
            for f in [local_image, local_video]:
                if f and os.path.exists(f):
                    try:
                        os.remove(f)
                    except OSError:
                        pass

    # Clean up
    queue.close()
    logger.info("=== LTX-2 Worker shutdown ===")


if __name__ == "__main__":
    main()
