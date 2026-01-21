"""Cloudflare R2 storage client for GPU workers."""
import logging
import os
import requests

import boto3
from botocore.config import Config

from .config import settings

logger = logging.getLogger(__name__)


class R2Storage:
    """Cloudflare R2 storage client using S3-compatible API."""

    def __init__(self):
        """Initialize the R2 storage client."""
        self.s3 = boto3.client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT,
            aws_access_key_id=settings.R2_ACCESS_KEY,
            aws_secret_access_key=settings.R2_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        self.bucket = settings.R2_BUCKET
        self.public_url = settings.R2_PUBLIC_URL

    def download_file(self, key: str, local_path: str) -> str:
        """Download file from R2 to local path.

        Args:
            key: S3 key (path in bucket)
            local_path: Local file path to save to

        Returns:
            The local path where file was saved
        """
        logger.info(f"Downloading {key} to {local_path}")
        self.s3.download_file(self.bucket, key, local_path)
        return local_path

    def download_from_url(self, url: str, local_path: str) -> str:
        """Download file from URL to local path.

        Args:
            url: HTTP(S) URL to download from
            local_path: Local file path to save to

        Returns:
            The local path where file was saved
        """
        logger.info(f"Downloading {url} to {local_path}")
        response = requests.get(url, stream=True, timeout=300)
        response.raise_for_status()

        with open(local_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return local_path

    def upload_output(self, job_id: str, local_path: str, content_type: str = "video/mp4") -> str:
        """Upload output file to R2.

        Args:
            job_id: Job ID (used in output path)
            local_path: Local file path to upload
            content_type: MIME type of the file

        Returns:
            Public URL to the uploaded file
        """
        # Determine extension from content type
        ext_map = {
            "video/mp4": "mp4",
            "image/png": "png",
            "image/jpeg": "jpg",
        }
        ext = ext_map.get(content_type, "bin")
        key = f"outputs/{job_id}/output.{ext}"

        logger.info(f"Uploading {local_path} to {key}")
        self.s3.upload_file(
            local_path,
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )

        # Return public URL if available, otherwise presigned URL
        if self.public_url:
            return f"{self.public_url}/{key}"

        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=86400 * 7,  # 7 days
        )

    def get_file_size(self, local_path: str) -> int:
        """Get file size in bytes.

        Args:
            local_path: Local file path

        Returns:
            File size in bytes
        """
        return os.path.getsize(local_path)
