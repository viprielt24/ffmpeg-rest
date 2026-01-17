import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { IMuxVideoAudioJobData, IConcatenateVideosJobData } from './schemas';
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
 * Process mux job - combine video and audio tracks
 */
export async function processMuxVideoAudio(job: Job<IMuxVideoAudioJobData>): Promise<JobResult> {
  const { videoUrl, audioUrl, duration } = job.data;
  const jobId = job.id ?? randomUUID();

  const jobDir = join(env.TEMP_DIR, `mux-${jobId}`);
  const videoPath = join(jobDir, 'input-video.mp4');
  const audioPath = join(jobDir, 'input-audio.mp3');
  const outputPath = join(jobDir, 'output.mp4');

  const startTime = Date.now();

  try {
    await mkdir(jobDir, { recursive: true });

    // Download inputs in parallel
    logger.info({ jobId, videoUrl, audioUrl }, 'Downloading input files');
    await job.updateProgress(5);

    await Promise.all([downloadFile(videoUrl, videoPath), downloadFile(audioUrl, audioPath)]);

    await job.updateProgress(30);
    logger.info({ jobId }, 'Input files downloaded, starting FFmpeg mux');

    // Build FFmpeg args
    const ffmpegArgs = [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-shortest',
      '-movflags',
      '+faststart'
    ];

    if (duration !== undefined) {
      ffmpegArgs.push('-t', duration.toString());
    }

    ffmpegArgs.push(outputPath);

    // Run FFmpeg
    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: PROCESSING_TIMEOUT });

    await job.updateProgress(90);
    logger.info({ jobId }, 'FFmpeg mux completed, uploading to S3');

    // Get file size
    const stats = statSync(outputPath);
    const fileSizeBytes = stats.size;

    // Upload to S3
    const { url: outputUrl } = await uploadToS3(outputPath, 'video/mp4', `muxed-${jobId}.mp4`);

    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    logger.info({ jobId, outputUrl, fileSizeBytes, processingTimeMs }, 'Mux job completed');

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
    logger.error({ jobId, error: errorMessage }, 'Mux job failed');
    return {
      success: false,
      error: `Mux failed: ${errorMessage}`
    };
  } finally {
    // Cleanup temp files
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Process concatenate job - join multiple videos
 */
export async function processConcatenateVideos(job: Job<IConcatenateVideosJobData>): Promise<JobResult> {
  const { videoUrls } = job.data;
  const jobId = job.id ?? randomUUID();

  const jobDir = join(env.TEMP_DIR, `concat-${jobId}`);
  const concatListPath = join(jobDir, 'concat.txt');
  const outputPath = join(jobDir, 'output.mp4');

  const startTime = Date.now();

  try {
    await mkdir(jobDir, { recursive: true });

    // Download all input videos
    logger.info({ jobId, videoCount: videoUrls.length }, 'Downloading input videos');
    await job.updateProgress(5);

    const inputPaths: string[] = [];
    const progressPerVideo = 25 / videoUrls.length;

    for (let i = 0; i < videoUrls.length; i++) {
      const videoUrl = videoUrls[i];
      if (!videoUrl) continue; // Type guard for strict mode
      const inputPath = join(jobDir, `input-${i}.mp4`);
      await downloadFile(videoUrl, inputPath);
      inputPaths.push(inputPath);
      await job.updateProgress(5 + Math.round((i + 1) * progressPerVideo));
    }

    await job.updateProgress(30);
    logger.info({ jobId }, 'Input videos downloaded, creating concat list');

    // Create concat list file
    const concatContent = inputPaths.map((p) => `file '${p}'`).join('\n');
    await writeFile(concatListPath, concatContent);

    logger.info({ jobId }, 'Starting FFmpeg concatenate');

    // Run FFmpeg concat
    const ffmpegArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      outputPath
    ];

    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: PROCESSING_TIMEOUT });

    await job.updateProgress(90);
    logger.info({ jobId }, 'FFmpeg concat completed, uploading to S3');

    // Get file size
    const stats = statSync(outputPath);
    const fileSizeBytes = stats.size;

    // Upload to S3
    const { url: outputUrl } = await uploadToS3(outputPath, 'video/mp4', `concatenated-${jobId}.mp4`);

    await job.updateProgress(100);

    const processingTimeMs = Date.now() - startTime;
    logger.info({ jobId, outputUrl, fileSizeBytes, processingTimeMs }, 'Concatenate job completed');

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
    logger.error({ jobId, error: errorMessage }, 'Concatenate job failed');
    return {
      success: false,
      error: `Concatenate failed: ${errorMessage}`
    };
  } finally {
    // Cleanup temp files
    await rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
