import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processAudioToMp3, processAudioToWav } from './processor';
import type { Job } from 'bullmq';
import type { AudioToMp3JobData, AudioToWavJobData } from './schemas';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TEST_DIR = path.join(process.cwd(), 'test-outputs', 'audio');
const FIXTURES_DIR = path.join(process.cwd(), 'test-fixtures', 'audio');

describe('processAudioToMp3', () => {
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

  it('should convert WAV to MP3 successfully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-audio.wav');
    const outputPath = path.join(TEST_DIR, 'output.mp3');

    createTestWavFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<AudioToMp3JobData>;

    const result = await processAudioToMp3(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_format -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.format.format_name).toContain('mp3');
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.wav');
    const outputPath = path.join(TEST_DIR, 'output.mp3');

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<AudioToMp3JobData>;

    const result = await processAudioToMp3(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid audio files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid.wav');
    const outputPath = path.join(TEST_DIR, 'output.mp3');

    writeFileSync(inputPath, 'This is not a valid audio file');

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 2
      }
    } as Job<AudioToMp3JobData>;

    const result = await processAudioToMp3(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should convert WAV to MP3 with custom quality', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-audio-quality.wav');
    const outputPath = path.join(TEST_DIR, 'output-quality7.mp3');

    createTestWavFile(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath,
        quality: 7
      }
    } as Job<AudioToMp3JobData>;

    const result = await processAudioToMp3(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_format -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.format.format_name).toContain('mp3');
  });
});

function createTestWavFile(outputPath: string): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -ar 44100 -ac 2 -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

function createTestMp3File(outputPath: string, channels = 2): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -ac ${channels} -codec:a libmp3lame -qscale:a 2 -y "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

describe('processAudioToWav', () => {
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

  it('should convert MP3 to WAV successfully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-audio.mp3');
    const outputPath = path.join(TEST_DIR, 'output.wav');

    createTestMp3File(inputPath);

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<AudioToWavJobData>;

    const result = await processAudioToWav(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_format -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.format.format_name).toBe('wav');
  });

  it('should return error when input file does not exist', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'non-existent.mp3');
    const outputPath = path.join(TEST_DIR, 'output.wav');

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<AudioToWavJobData>;

    const result = await processAudioToWav(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('does not exist');
  });

  it('should handle invalid audio files gracefully', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'invalid.mp3');
    const outputPath = path.join(TEST_DIR, 'output.wav');

    writeFileSync(inputPath, 'This is not a valid audio file');

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<AudioToWavJobData>;

    const result = await processAudioToWav(job);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should preserve mono channel when converting mono MP3 to WAV', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-audio-mono.mp3');
    const outputPath = path.join(TEST_DIR, 'output-mono.wav');

    createTestMp3File(inputPath, 1);

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<AudioToWavJobData>;

    const result = await processAudioToWav(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_streams -select_streams a -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.streams[0].channels).toBe(1);
    expect(metadata.streams[0].codec_name).toBe('pcm_s16le');
  });

  it('should preserve stereo channels when converting stereo MP3 to WAV', async () => {
    const inputPath = path.join(FIXTURES_DIR, 'test-audio-stereo.mp3');
    const outputPath = path.join(TEST_DIR, 'output-stereo.wav');

    createTestMp3File(inputPath, 2);

    const job = {
      data: {
        inputPath,
        outputPath
      }
    } as Job<AudioToWavJobData>;

    const result = await processAudioToWav(job);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileInfo = execSync(`ffprobe -v error -show_streams -select_streams a -of json "${outputPath}"`).toString();
    const metadata = JSON.parse(fileInfo);
    expect(metadata.streams[0].channels).toBe(2);
    expect(metadata.streams[0].codec_name).toBe('pcm_s16le');
  });
});
