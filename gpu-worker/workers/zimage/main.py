"""Z-Image Worker main loop."""
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
from .inference import ZImageGenerator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    """Main worker loop for Z-Image text-to-image generation."""
    logger.info("=== Starting Z-Image Worker ===")

    # Initialize components
    generator = ZImageGenerator(settings.ZIMAGE_MODEL_PATH)
    queue = BullMQClient(settings.REDIS_URL, "generate:zimage")
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

        # Temp file path for output
        local_image = None

        try:
            queue.update_progress(job_id, 0)

            # Get prompt
            prompt = job.get("prompt", "")
            if not prompt:
                raise ValueError("Missing prompt in job data")

            queue.update_progress(job_id, 5)

            # Generate image
            def on_progress(p: int):
                # Scale progress from 5-90
                queue.update_progress(job_id, 5 + int(p * 0.85))

            local_image = generator.generate(
                prompt=prompt,
                negative_prompt=job.get("negativePrompt", ""),
                width=job.get("width", 1024),
                height=job.get("height", 1024),
                num_inference_steps=job.get("steps", 9),
                guidance_scale=job.get("guidanceScale", 0.0),
                seed=job.get("seed"),
                progress_callback=on_progress,
            )
            queue.update_progress(job_id, 90)

            # Upload result
            image_url = storage.upload_output(job_id, local_image, "image/png")
            file_size = storage.get_file_size(local_image)
            image_info = generator.get_image_info(local_image)

            queue.update_progress(job_id, 100)

            # Calculate processing time
            processing_time_ms = int((time.time() - start_time) * 1000)

            # Build result
            result = {
                "url": image_url,
                "contentType": "image/png",
                "fileSizeBytes": file_size,
                "width": image_info["width"],
                "height": image_info["height"],
                "processingTimeMs": processing_time_ms,
            }

            # Mark completed in queue
            queue.mark_completed(job_id, result)

            # Send webhook notifications
            notify_complete(job_id, "zimage", result, job.get("webhookUrl"))

            logger.info(f"Job {job_id} completed in {processing_time_ms}ms")

        except Exception as e:
            error_msg = str(e)
            logger.error(f"Job {job_id} failed: {error_msg}")

            # Mark failed in queue
            queue.mark_failed(job_id, error_msg)

            # Send failure notification
            notify_failed(job_id, "zimage", error_msg, job.get("webhookUrl"))

        finally:
            # Clean up temp files
            if local_image and os.path.exists(local_image):
                try:
                    os.remove(local_image)
                except OSError:
                    pass

    # Clean up
    queue.close()
    logger.info("=== Z-Image Worker shutdown ===")


if __name__ == "__main__":
    main()
