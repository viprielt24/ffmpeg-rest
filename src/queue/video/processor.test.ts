import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processVideoToMp4, processVideoExtractAudio, processVideoExtractFrames } from './processor';
import type { Job } from 'bullmq';
import type { VideoToMp4JobData, VideoExtractAudioJobData, VideoExtractFramesJobData } from './schemas';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'video');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'video');

describe('processVideoToMp4', () => {
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

  it('should convert AVI to MP4 successfully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video.avi');
    const outputPath = path.join(TEST_DIR, 'output.mp4');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<VideoToMp4JobData>;

    const result = await processVideoToMp4(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_format -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.format.format_name).toContain('mp4');
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.avi');
    const outputPath = path.join(TEST_DIR, 'output.mp4');

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<VideoToMp4JobData>;

    const result = await processVideoToMp4(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid video files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid.avi');
    const outputPath = path.join(TEST_DIR, 'output.mp4');

    writeFileSync(inputPath, 'This is not a valid video file');

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<VideoToMp4JobData>;

    const result = await processVideoToMp4(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

function createTestAviFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -f lavfi -i sine=frequency=1000:duration=2 -pix_fmt yuv420p -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

describe('processVideoExtractFrames', () => {
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

  it('should extract frames at specified fps', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video-frames.avi');
    const outputDir = path.join(TEST_DIR, 'frames');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputDir,
        fps: 1
      }
    } as Job<VideoExtractFramesJobData>;

    const result = await processVideoExtractFrames(job);

    expect(result.success).toBe(true);
    expect(result.outputPaths).toBeDefined();
    expect(result.outputPaths!.length).toBeGreaterThan(0);
    expect(existsSync(outputDir)).toBe(true);

    const files = readdirSync(outputDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every(f => f.endsWith('.png'))).toBe(true);
  });

  it('should create compressed zip archive when compress is zip', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video-zip.avi');
    const outputDir = path.join(TEST_DIR, 'frames-zip');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputDir,
        fps: 1,
        compress: 'zip' as const
      }
    } as Job<VideoExtractFramesJobData>;

    const result = await processVideoExtractFrames(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(result.outputPath).toContain('.zip');
    expect(existsSync(result.outputPath!)).toBe(true);
  });

  it('should create compressed gzip archive when compress is gzip', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video-gzip.avi');
    const outputDir = path.join(TEST_DIR, 'frames-gzip');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputDir,
        fps: 1,
        compress: 'gzip' as const
      }
    } as Job<VideoExtractFramesJobData>;

    const result = await processVideoExtractFrames(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBeDefined();
    expect(result.outputPath).toContain('.tar.gz');
    expect(existsSync(result.outputPath!)).toBe(true);
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.avi');
    const outputDir = path.join(TEST_DIR, 'frames');

    const job = {
      data: {
        inputPath,
        outputDir,
        fps: 1
      }
    } as Job<VideoExtractFramesJobData>;

    const result = await processVideoExtractFrames(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid video files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid-frames.avi');
    const outputDir = path.join(TEST_DIR, 'frames');

    writeFileSync(inputPath, 'This is not a valid video file');

    const job = {
      data: {
        inputPath,
        outputDir,
        fps: 1
      }
    } as Job<VideoExtractFramesJobData>;

    const result = await processVideoExtractFrames(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('processVideoExtractAudio', () => {
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

  it('should extract audio as mono by default', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video-audio.avi');
    const outputPath = path.join(TEST_DIR, 'audio.mp3');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        mono: true
      }
    } as Job<VideoExtractAudioJobData>;

    const result = await processVideoExtractAudio(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_streams -select_streams a -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.streams[0].channels).toBe(1);
  });

  it('should extract audio as stereo when mono is false', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-video-stereo.avi');
    const outputPath = path.join(TEST_DIR, 'audio-stereo.mp3');

    createTestAviFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        mono: false
      }
    } as Job<VideoExtractAudioJobData>;

    const result = await processVideoExtractAudio(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_streams -select_streams a -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.streams[0].channels).toBe(2);
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.avi');
    const outputPath = path.join(TEST_DIR, 'audio.mp3');

    const job = {
      data: {
        inputPath,
        outputPath,
        mono: true
      }
    } as Job<VideoExtractAudioJobData>;

    const result = await processVideoExtractAudio(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid video files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid-video.avi');
    const outputPath = path.join(TEST_DIR, 'audio.mp3');

    writeFileSync(inputPath, 'This is not a valid video file');

    const job = {
      data: {
        inputPath,
        outputPath,
        mono: true
      }
    } as Job<VideoExtractAudioJobData>;

    const result = await processVideoExtractAudio(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
