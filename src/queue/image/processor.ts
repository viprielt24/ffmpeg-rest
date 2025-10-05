import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { ImageToJpgJobData } from './schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname, basename } from 'path';
import { env } from '~/config/env';
import { logger } from '~/config/logger';
import { uploadToS3 } from '~/utils/storage';

const execFileAsync = promisify(execFile);

const PROCESSING_TIMEOUT = 600000;

export async function processImageToJpg(job: Job<ImageToJpgJobData>): Promise<JobResult> {
  const { inputPath, outputPath, quality } = job.data;
  logger.info({ jobId: job.id, inputPath, outputPath }, 'Starting image conversion');

  if (!existsSync(inputPath)) {
    logger.error({ jobId: job.id, inputPath }, 'Input file does not exist');
    return {
      success: false,
      error: `Input file does not exist: ${inputPath}`
    };
  }

  try {
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    const ffmpegStart = Date.now();
    await execFileAsync('ffmpeg', [
      '-i',
      inputPath,
      '-q:v',
      quality.toString(),
      '-y',
      outputPath
    ], { timeout: PROCESSING_TIMEOUT });
    const ffmpegDuration = Date.now() - ffmpegStart;
    logger.info({ jobId: job.id, duration: ffmpegDuration }, 'FFmpeg conversion completed');

    if (env.STORAGE_MODE === 's3') {
      const uploadStart = Date.now();
      const { url } = await uploadToS3(outputPath, 'image/jpeg', basename(outputPath));
      const uploadDuration = Date.now() - uploadStart;
      logger.info({ jobId: job.id, duration: uploadDuration, url }, 'S3 upload completed');
      await rm(outputPath, { force: true });
      return {
        success: true,
        outputUrl: url
      };
    }

    logger.info({ jobId: job.id }, 'Conversion successful');
    return {
      success: true,
      outputPath
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ jobId: job.id, error: errorMessage }, 'Conversion failed');
    return {
      success: false,
      error: `Failed to convert image to JPG: ${errorMessage}`
    };
  }
}
