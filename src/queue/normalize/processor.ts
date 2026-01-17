import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { INormalizeVideoJobData } from './schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, writeFile } from 'fs/promises';
import { statSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { env } from '~/config/env';
import { uploadToS3 } from '~/utils/storage';
import { logger } from '~/config/logger';

const execFileAsync = promisify(execFile);

const PROCESSING_TIMEOUT = 600000; // 10 minutes
const DOWNLOAD_TIMEOUT = 300000; // 5 minutes

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(outputPath, buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function processNormalizeVideo(job: Job<INormalizeVideoJobData>): Promise<JobResult> {
  const {
    videoUrl,
    width,
    height,
    fps,
    videoBitrate,
    crf,
    preset,
    audioBitrate,
    audioSampleRate,
    audioChannels,
    duration
  } = job.data;
  const jobId = job.id ?? randomUUID();

  const jobDir = join(env.TEMP_DIR, `normalize-${jobId}`);
  const inputPath = join(jobDir, 'input.mp4');
  const outputPath = join(jobDir, 'output.mp4');

  const startTime = Date.now();

  try {
    await mkdir(jobDir, { recursive: true });

    // Download input
    logger.info({ jobId, videoUrl }, 'Downloading input video');
    await job.updateProgress(5);
    await downloadFile(videoUrl, inputPath);
    await job.updateProgress(20);

    logger.info({ jobId, width, height, fps, preset }, 'Starting FFmpeg normalize');

    // Build FFmpeg args
    const ffmpegArgs = [
      '-y',
      '-i',
      inputPath,
      // Video filter: scale + pad (letterbox/pillarbox) + fps
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      // Video codec
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-pix_fmt',
      'yuv420p'
    ];

    // Video quality: bitrate OR crf (bitrate takes priority)
    if (videoBitrate) {
      ffmpegArgs.push('-b:v', videoBitrate);
    } else {
      ffmpegArgs.push('-crf', crf.toString());
    }

    // Audio codec
    ffmpegArgs.push('-c:a', 'aac', '-ar', audioSampleRate.toString(), '-ac', audioChannels.toString());

    // Audio bitrate (optional)
    if (audioBitrate) {
      ffmpegArgs.push('-b:a', audioBitrate);
    }

    // Duration trim (optional)
    if (duration !== undefined) {
      ffmpegArgs.push('-t', duration.toString());
    }

    // Output optimizations
    ffmpegArgs.push('-movflags', '+faststart', outputPath);

    // Run FFmpeg
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: PROCESSING_TIMEOUT });

    await job.updateProgress(90);
    logger.info({ jobId }, 'FFmpeg normalize completed, uploading to S3');

    // Get file size
    const stats = statSync(outputPath);
    const fileSizeBytes = stats.size;

    // Upload to S3
    const { url: outputUrl } = await uploadToS3(outputPath, 'video/mp4', `normalized-${jobId}.mp4`);

    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    logger.info({ jobId, outputUrl, fileSizeBytes, processingTimeMs }, 'Normalize job completed');

    return {
      success: true,
      outputUrl,
      metadata: {
        fileSizeBytes,
        processingTimeMs
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ jobId, error: errorMessage }, 'Normalize job failed');
    return {
      success: false,
      error: `Normalize failed: ${errorMessage}`
    };
  } finally {
    // Cleanup temp files
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
