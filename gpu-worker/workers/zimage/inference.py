"""Z-Image text-to-image inference."""
import logging
import uuid
from typing import Callable

import torch

logger = logging.getLogger(__name__)


class ZImageGenerator:
    """Z-Image Text-to-Image generator using Diffusers pipeline."""

    def __init__(self, model_path: str = "Tongyi-MAI/Z-Image-Turbo"):
        """Initialize the Z-Image generator.

        Args:
            model_path: HuggingFace model ID or local path
        """
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Device: {self.device}")

        # Import diffusers (needs to be installed from source for Z-Image)
        from diffusers import DiffusionPipeline

        logger.info(f"Loading Z-Image from {model_path}...")

        # Load Z-Image pipeline
        self.pipeline = DiffusionPipeline.from_pretrained(
            model_path,
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        )
        self.pipeline.to(self.device)

        # Enable memory optimizations
        if hasattr(self.pipeline, "enable_attention_slicing"):
            self.pipeline.enable_attention_slicing()

        vram = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0
        logger.info(f"Model loaded. VRAM: {vram:.1f}GB")

    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        num_inference_steps: int = 9,
        guidance_scale: float = 0.0,
        seed: int | None = None,
        progress_callback: Callable[[int], None] | None = None,
    ) -> str:
        """Generate image from text prompt.

        Args:
            prompt: Text prompt (supports English and Chinese)
            negative_prompt: Negative prompt to avoid certain features
            width: Output width (512-2048)
            height: Output height (512-2048)
            num_inference_steps: Number of diffusion steps (8-9 for Turbo, more for Base)
            guidance_scale: Guidance scale (0 for Turbo variant)
            seed: Random seed for reproducibility
            progress_callback: Optional callback for progress updates (0-100)

        Returns:
            Path to generated image file
        """
        logger.info(f"Generating image: prompt='{prompt[:50]}...', size={width}x{height}")

        # Set seed for reproducibility
        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        # Progress callback wrapper for diffusers
        def callback_fn(pipe, step, timestep, callback_kwargs):
            if progress_callback:
                progress = int((step / num_inference_steps) * 100)
                progress_callback(progress)
            return callback_kwargs

        # Generate image
        result = self.pipeline(
            prompt=prompt,
            negative_prompt=negative_prompt or "blurry, low quality, distorted, artifact",
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            generator=generator,
            callback_on_step_end=callback_fn,
        )

        # Save image
        output_path = f"/tmp/output_{uuid.uuid4()}.png"
        image = result.images[0]
        image.save(output_path, "PNG")

        logger.info(f"Image generated: {output_path}")
        return output_path

    def get_image_info(self, image_path: str) -> dict:
        """Get image metadata.

        Args:
            image_path: Path to image file

        Returns:
            Dictionary with width, height
        """
        from PIL import Image

        with Image.open(image_path) as img:
            return {
                "width": img.width,
                "height": img.height,
            }
