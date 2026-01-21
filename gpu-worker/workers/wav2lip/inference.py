"""Wav2Lip lip-sync inference."""
import logging
import os
import re
import subprocess
import uuid
from typing import Callable

logger = logging.getLogger(__name__)


class Wav2LipGenerator:
    """Wav2Lip lip-sync video generator."""

    def __init__(self, model_path: str = "/workspace/models/wav2lip"):
        """Initialize the Wav2Lip generator.

        Args:
            model_path: Path to Wav2Lip repository with checkpoints
        """
        self.model_path = model_path
        self.checkpoint = os.path.join(model_path, "checkpoints", "wav2lip_gan.pth")

        if not os.path.exists(self.checkpoint):
            raise FileNotFoundError(f"Wav2Lip checkpoint not found: {self.checkpoint}")

        logger.info(f"Wav2Lip initialized with checkpoint: {self.checkpoint}")

    def generate(
        self,
        video_path: str,
        audio_path: str,
        pad_top: int = 0,
        pad_bottom: int = 10,
        pad_left: int = 0,
        pad_right: int = 0,
        progress_callback: Callable[[int], None] | None = None,
    ) -> str:
        """Generate lip-synced video.

        Args:
            video_path: Path to source video with face
            audio_path: Path to audio file for lip-sync
            pad_top: Padding above mouth region
            pad_bottom: Padding below mouth region
            pad_left: Padding left of mouth region
            pad_right: Padding right of mouth region
            progress_callback: Optional callback for progress updates (0-100)

        Returns:
            Path to generated video file
        """
        logger.info(f"Lip-syncing: video={video_path}, audio={audio_path}")

        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"

        # Build Wav2Lip inference command
        cmd = [
            "python",
            os.path.join(self.model_path, "inference.py"),
            "--checkpoint_path",
            self.checkpoint,
            "--face",
            video_path,
            "--audio",
            audio_path,
            "--outfile",
            output_path,
            "--resize_factor",
            "1",
            "--pads",
            str(pad_top),
            str(pad_bottom),
            str(pad_left),
            str(pad_right),
        ]

        logger.info(f"Running: {' '.join(cmd)}")

        # Run Wav2Lip inference
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=self.model_path,
        )

        # Stream output and track progress
        for line in process.stdout:
            logger.debug(line.strip())
            # Try to extract progress from output
            if "%" in line and progress_callback:
                match = re.search(r"(\d+)%", line)
                if match:
                    progress_callback(int(match.group(1)))

        process.wait()

        if process.returncode != 0:
            raise RuntimeError(f"Wav2Lip failed with exit code {process.returncode}")

        if not os.path.exists(output_path):
            raise RuntimeError("Wav2Lip did not produce output file")

        logger.info(f"Lip-sync complete: {output_path}")
        return output_path

    def get_video_info(self, video_path: str) -> dict:
        """Get video metadata using ffprobe.

        Args:
            video_path: Path to video file

        Returns:
            Dictionary with width, height, duration_ms
        """
        try:
            cmd = [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,duration",
                "-of",
                "csv=p=0",
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
        except (subprocess.SubprocessError, ValueError, IndexError) as e:
            logger.warning(f"Could not get video info: {e}")
            return {"width": 0, "height": 0, "duration_ms": 0}
