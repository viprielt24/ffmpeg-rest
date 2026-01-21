"""BullMQ-compatible Redis queue client for Python workers."""
import json
import time
import logging
from typing import Any

import redis

logger = logging.getLogger(__name__)


class BullMQClient:
    """Python client compatible with BullMQ job structure.

    BullMQ stores jobs in Redis with specific key patterns:
    - bull:{queue}:wait - List of waiting job IDs
    - bull:{queue}:active - List of active job IDs
    - bull:{queue}:completed - Sorted set of completed job IDs
    - bull:{queue}:failed - Sorted set of failed job IDs
    - bull:{queue}:{id} - Hash containing job data
    """

    def __init__(self, redis_url: str, queue_name: str):
        """Initialize the BullMQ client.

        Args:
            redis_url: Redis connection URL
            queue_name: Name of the BullMQ queue (e.g., "generate:ltx2")
        """
        self.redis = redis.from_url(redis_url)
        self.queue_name = queue_name
        # BullMQ uses "ffmpeg-jobs" as the base queue name
        self.prefix = "bull:ffmpeg-jobs"
        logger.info(f"Connected to queue: {queue_name} (prefix: {self.prefix})")

    def get_next_job(self, timeout: int = 5) -> dict[str, Any] | None:
        """Pop the next job from the waiting queue.

        Jobs are filtered by type matching the queue_name.

        Args:
            timeout: Seconds to wait for a job (0 for no wait)

        Returns:
            Job dictionary with id and data, or None if no job available
        """
        try:
            # Use BRPOPLPUSH to atomically move job from wait to active
            result = self.redis.brpoplpush(
                f"{self.prefix}:wait",
                f"{self.prefix}:active",
                timeout=timeout,
            )

            if not result:
                return None

            job_id = result.decode() if isinstance(result, bytes) else result
            job_hash = self.redis.hgetall(f"{self.prefix}:{job_id}")

            if not job_hash:
                # Job data not found, remove from active
                self.redis.lrem(f"{self.prefix}:active", 1, job_id)
                return None

            # Parse job data
            data_raw = job_hash.get(b"data", b"{}")
            data = json.loads(data_raw.decode() if isinstance(data_raw, bytes) else data_raw)

            # Check if this job matches our queue type
            job_type = data.get("type", "")
            if job_type != self.queue_name:
                # Put job back in wait queue (at the front)
                self.redis.lrem(f"{self.prefix}:active", 1, job_id)
                self.redis.lpush(f"{self.prefix}:wait", job_id)
                return None

            logger.info(f"Got job {job_id} of type {job_type}")
            return {"id": job_id, **data}

        except redis.RedisError as e:
            logger.error(f"Redis error getting job: {e}")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}")
            return None

    def mark_completed(self, job_id: str, result: dict[str, Any]) -> None:
        """Move job to completed state with result.

        Args:
            job_id: The job ID
            result: Result dictionary to store
        """
        try:
            now = int(time.time() * 1000)

            # Update job hash with result
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={
                    "returnvalue": json.dumps(result),
                    "finishedOn": str(now),
                    "processedOn": str(now),
                },
            )

            # Remove from active, add to completed
            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:completed", {job_id: time.time()})

            logger.info(f"Job {job_id} marked as completed")

        except redis.RedisError as e:
            logger.error(f"Error completing job {job_id}: {e}")

    def mark_failed(self, job_id: str, error: str) -> None:
        """Move job to failed state with error message.

        Args:
            job_id: The job ID
            error: Error message
        """
        try:
            now = int(time.time() * 1000)

            # Update job hash with error
            self.redis.hset(
                f"{self.prefix}:{job_id}",
                mapping={
                    "failedReason": error,
                    "finishedOn": str(now),
                },
            )

            # Remove from active, add to failed
            self.redis.lrem(f"{self.prefix}:active", 1, job_id)
            self.redis.zadd(f"{self.prefix}:failed", {job_id: time.time()})

            logger.info(f"Job {job_id} marked as failed: {error}")

        except redis.RedisError as e:
            logger.error(f"Error failing job {job_id}: {e}")

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update job progress (0-100).

        Args:
            job_id: The job ID
            progress: Progress percentage (0-100)
        """
        try:
            self.redis.hset(f"{self.prefix}:{job_id}", "progress", str(progress))
        except redis.RedisError as e:
            logger.error(f"Error updating progress for job {job_id}: {e}")

    def close(self) -> None:
        """Close the Redis connection."""
        self.redis.close()
