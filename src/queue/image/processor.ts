import type { Job } from 'bullmq';
import type { JobResult } from '..';
import type { ImageToJpgJobData } from './schemas';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

const execFileAsync = promisify(execFile);

const PROCESSING_TIMEOUT = 600000;

export async function processImageToJpg(job: Job<ImageToJpgJobData>): Promise<JobResult> {
  const { inputPath, outputPath, quality } = job.data;

  if (!existsSync(inputPath)) {
    return {
      success: false,
      error: `Input file does not exist: ${inputPath}`
    };
  }

  try {
    const outputDir = dirname(outputPath);
    await mkdir(outputDir, { recursive: true });

    await execFileAsync('ffmpeg', [
      '-i',
      inputPath,
      '-q:v',
      quality.toString(),
      '-y',
      outputPath
    ], { timeout: PROCESSING_TIMEOUT });

    return {
      success: true,
      outputPath
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Failed to convert image to JPG: ${errorMessage}`
    };
  }
}
