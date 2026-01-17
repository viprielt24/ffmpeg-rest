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

/**
 * Default values for normalize parameters
 */
const DEFAULTS = {
  width: 1080,
  height: 1920,
  fps: 30,
  crf: 23,
  preset: 'fast',
  audioSampleRate: 48000,
  audioChannels: 2
};

/**
 * Download a file from URL to local path
 */
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

    // Use arrayBuffer approach for better TypeScript compatibility
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(outputPath, buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Process normalize job - scale, fps, and encode video to standard format
 */
export async function processNormalizeVideo(job: Job<INormalizeVideoJobData>): Promise<JobResult> {
  const {
    videoUrl,
    width = DEFAULTS.width,
    height = DEFAULTS.height,
    fps = DEFAULTS.fps,
    videoBitrate,
    crf = DEFAULTS.crf,
    preset = DEFAULTS.preset,
    audioBitrate,
    audioSampleRate = DEFAULTS.audioSampleRate,
    audioChannels = DEFAULTS.audioChannels,
    duration
  } = job.data;

  const jobId = job.id ?? randomUUID();

  const jobDir = join(env.TEMP_DIR, `normalize-${jobId}`);
  const videoPath = join(jobDir, 'input-video.mp4');
  const outputPath = join(jobDir, 'output.mp4');

  const startTime = Date.now();

  try {
    await mkdir(jobDir, { recursive: true });

    // Download input video
    logger.info({ jobId, videoUrl }, 'Downloading input video');
    await job.updateProgress(5);

    await downloadFile(videoUrl, videoPath);

    await job.updateProgress(30);
    logger.info({ jobId }, 'Input video downloaded, starting FFmpeg normalize');

    // Build FFmpeg args
    const ffmpegArgs = [
      '-y',
      '-i',
      videoPath,
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-pix_fmt',
      'yuv420p'
    ];

    // Video quality: bitrate OR crf (not both)
    if (videoBitrate) {
      ffmpegArgs.push('-b:v', videoBitrate);
    } else {
      ffmpegArgs.push('-crf', String(crf));
    }

    // Audio encoding
    ffmpegArgs.push('-c:a', 'aac', '-ar', String(audioSampleRate), '-ac', String(audioChannels));
    if (audioBitrate) {
      ffmpegArgs.push('-b:a', audioBitrate);
    }

    // Sync and duration
    ffmpegArgs.push('-shortest', '-movflags', '+faststart');
    if (duration !== undefined) {
      ffmpegArgs.push('-t', String(duration));
    }

    ffmpegArgs.push(outputPath);

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
