import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processImageToJpg } from './processor';
import type { Job } from 'bullmq';
import type { ImageToJpgJobData } from './schemas';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'image');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'image');

describe('processImageToJpg', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should convert PNG to JPG successfully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-image.png');
    const outputPath = path.join(TEST_DIR, 'output.jpg');

    createTestPngFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<ImageToJpgJobData>;

    const result = await processImageToJpg(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_format -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.format.format_name).toContain('image2');
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.png');
    const outputPath = path.join(TEST_DIR, 'output.jpg');

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<ImageToJpgJobData>;

    const result = await processImageToJpg(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid image files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid.png');
    const outputPath = path.join(TEST_DIR, 'output.jpg');

    writeFileSync(inputPath, 'This is not a valid image file');

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<ImageToJpgJobData>;

    const result = await processImageToJpg(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should convert PNG to JPG with custom quality', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-image-quality.png');
    const outputPath = path.join(TEST_DIR, 'output-quality10.jpg');

    createTestPngFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 10
      }
    } as Job<ImageToJpgJobData>;

    const result = await processImageToJpg(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });
});

function createTestPngFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -frames:v 1 -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
