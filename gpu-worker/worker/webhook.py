"""Webhook notifications for GPU workers."""
import logging
from datetime import datetime, timezone
from typing import Any

import requests

from .config import settings

logger = logging.getLogger(__name__)


def _call_webhook(url: str, payload: dict[str, Any]) -> bool:
    """Send a webhook notification.

    Args:
        url: Webhook URL
        payload: JSON payload to send

    Returns:
        True if successful, False otherwise
    """
    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Secret": settings.WEBHOOK_SECRET,
            },
            timeout=10,
        )
        response.raise_for_status()
        logger.info(f"Webhook sent successfully to {url}")
        return True
    except requests.RequestException as e:
        logger.error(f"Webhook failed to {url}: {e}")
        return False


def notify_complete(
    job_id: str,
    model: str,
    result: dict[str, Any],
    webhook_url: str | None = None,
) -> None:
    """Notify API and optional external webhook of job completion.

    Args:
        job_id: The job ID
        model: Model type (wav2lip, zimage, infinitetalk)
        result: Result dictionary with url, contentType, etc.
        webhook_url: Optional external webhook URL
    """
    payload = {
        "jobId": job_id,
        "status": "completed",
        "result": result,
        "processingTimeMs": result.get("processingTimeMs"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Notify the API server
    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)

    # Notify external webhook if configured
    if webhook_url:
        _call_webhook(webhook_url, payload)


def notify_failed(
    job_id: str,
    model: str,
    error: str,
    webhook_url: str | None = None,
) -> None:
    """Notify API and optional external webhook of job failure.

    Args:
        job_id: The job ID
        model: Model type (wav2lip, zimage, infinitetalk)
        error: Error message
        webhook_url: Optional external webhook URL
    """
    payload = {
        "jobId": job_id,
        "status": "failed",
        "error": error,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Notify the API server
    if settings.API_WEBHOOK_URL:
        _call_webhook(settings.API_WEBHOOK_URL, payload)

    # Notify external webhook if configured
    if webhook_url:
        _call_webhook(webhook_url, payload)
