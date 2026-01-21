"""LTX-2 video generation inference."""
import logging
import uuid
from typing import Callable

import torch
from PIL import Image

logger = logging.getLogger(__name__)


class LTX2Generator:
    """LTX-2 Image-to-Video generator using Diffusers pipeline."""

    def __init__(self, model_path: str = "Lightricks/LTX-Video"):
        """Initialize the LTX-2 generator.

        Args:
            model_path: HuggingFace model ID or local path
        """
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Device: {self.device}")

        # Import here to avoid loading model until needed
        from diffusers import LTXImageToVideoPipeline

        logger.info(f"Loading LTX-2 from {model_path}...")
        self.pipeline = LTXImageToVideoPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16,
        )
        self.pipeline.to(self.device)

        # Enable memory optimization
        if hasattr(self.pipeline, "enable_attention_slicing"):
            self.pipeline.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded. VRAM: {vram:.1f}GB")

    def generate(
        self,
        image_path: str,
        prompt: str = "",
        duration: int = 5,
        fps: int = 24,
        width: int = 1024,
        height: int = 576,
        num_inference_steps: int = 30,
        progress_callback: Callable[[int], None] | None = None,
    ) -> str:
        """Generate video from image.

        Args:
            image_path: Path to source image
            prompt: Text prompt for video generation
            duration: Video duration in seconds
            fps: Frames per second
            width: Output width
            height: Output height
            num_inference_steps: Number of diffusion steps
            progress_callback: Optional callback for progress updates (0-100)

        Returns:
            Path to generated video file
        """
        logger.info(f"Generating video: image={image_path}, duration={duration}s")

        # Load and prepare image
        image = Image.open(image_path).convert("RGB")

        # Calculate frame count (must be divisible by 8 + 1 for LTX)
        num_frames = (duration * fps // 8) * 8 + 1

        # Progress callback wrapper for diffusers
        def callback_fn(pipe, step, timestep, callback_kwargs):
            if progress_callback:
                progress = int((step / num_inference_steps) * 100)
                progress_callback(progress)
            return callback_kwargs

        # Generate video
        result = self.pipeline(
            image=image,
            prompt=prompt or "A smooth cinematic video",
            negative_prompt="blurry, low quality, distorted, artifact",
            num_frames=num_frames,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=7.5,
            callback_on_step_end=callback_fn,
        )

        # Export to video file
        output_path = f"/tmp/output_{uuid.uuid4()}.mp4"
        self._export_video(result.frames[0], output_path, fps)

        logger.info(f"Video generated: {output_path}")
        return output_path

    def _export_video(self, frames: list, output_path: str, fps: int) -> None:
        """Export frames to video file.

        Args:
            frames: List of frame arrays
            output_path: Output video path
            fps: Frames per second
        """
        import imageio

        writer = imageio.get_writer(output_path, fps=fps, codec="libx264")
        for frame in frames:
            writer.append_data(frame)
        writer.close()

    def get_video_info(self, video_path: str) -> dict:
        """Get video metadata.

        Args:
            video_path: Path to video file

        Returns:
            Dictionary with width, height, duration_ms
        """
        import imageio

        reader = imageio.get_reader(video_path)
        meta = reader.get_meta_data()
        reader.close()

        return {
            "width": meta.get("size", [0, 0])[0],
            "height": meta.get("size", [0, 0])[1],
            "duration_ms": int(meta.get("duration", 0) * 1000),
        }
