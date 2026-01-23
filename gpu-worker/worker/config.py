"""Configuration for GPU worker."""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Worker settings loaded from environment variables."""

    # Model type this worker handles
    MODEL_TYPE: str = os.environ.get("MODEL_TYPE", "wav2lip")

    # Redis
    REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")

    # R2 Storage
    R2_ENDPOINT: str = os.environ.get("R2_ENDPOINT", "")
    R2_ACCESS_KEY: str = os.environ.get("R2_ACCESS_KEY", "")
    R2_SECRET_KEY: str = os.environ.get("R2_SECRET_KEY", "")
    R2_BUCKET: str = os.environ.get("R2_BUCKET", "ffmpeg-rest")
    R2_PUBLIC_URL: str = os.environ.get("R2_PUBLIC_URL", "")

    # Webhook
    API_WEBHOOK_URL: str = os.environ.get("API_WEBHOOK_URL", "")
    WEBHOOK_SECRET: str = os.environ.get("WEBHOOK_SECRET", "")

    # Model paths
    WAV2LIP_MODEL_PATH: str = os.environ.get("WAV2LIP_MODEL_PATH", "/workspace/models/wav2lip")
    ZIMAGE_MODEL_PATH: str = os.environ.get("ZIMAGE_MODEL_PATH", "Tongyi-MAI/Z-Image-Turbo")

    # Worker settings
    MAX_IDLE_SECONDS: int = int(os.environ.get("MAX_IDLE_SECONDS", "300"))

    @property
    def queue_name(self) -> str:
        """Return the queue name based on model type."""
        return f"generate:{self.MODEL_TYPE}"


settings = Settings()
