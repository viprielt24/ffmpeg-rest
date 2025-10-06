# FFmpeg REST API

A REST API that wraps FFmpeg for media processing operations. Built with Node.js, Hono, and BullMQ for reliable async job processing.

<p align="center">
  <img src="docs-preview.png" alt="API Documentation Preview" width="800">
</p>

<p align="center">
  <a href="https://railway.com/deploy/cS-8cr?referralCode=crisog">
    <img src="https://railway.app/button.svg" alt="Deploy on Railway">
  </a>
</p>

## Features

Convert and process media files through simple HTTP endpoints:

- **Video**: Convert any video to MP4, extract audio tracks (mono/stereo), extract frames at custom FPS (compressed as ZIP/GZIP)
- **Audio**: Convert any audio to MP3 or WAV
- **Image**: Convert any image format to JPG
- **Media Info**: Probe any media file for metadata and stream information

## Documentation

This API is built with documentation-first approach using **Hono Zod OpenAPI** and **Scalar**:

- **Type-Safe Schemas**: All endpoints use Zod schemas for validation, ensuring type safety and automatic OpenAPI spec generation
- **Interactive API Reference**: Beautiful, interactive documentation powered by Scalar at `/reference`
- **OpenAPI 3.1 Spec**: Complete machine-readable API specification at `/doc`
- **LLM-Friendly Docs**: Markdown documentation optimized for AI assistants at `/llms.txt` (following [llmstxt.org](https://llmstxt.org/) standard)

Every endpoint is fully documented with request/response schemas, validation rules, and example payloads. No manual documentation maintenance required.

## Storage Modes

The API supports two storage modes to fit different deployment scenarios:

### Stateless Mode (Default)

Files are processed and returned directly in the HTTP response. Simple and straightforward for immediate consumption.

### S3 Mode

Processed files are uploaded to S3-compatible storage and a URL is returned. This mode significantly reduces egress bandwidth costs since users download the processed files directly from S3 rather than through your API server. Ideal for production deployments where bandwidth costs matter.

Configure S3 mode by setting `STORAGE_MODE=s3` and providing S3 credentials in your environment variables.

## Quick Start

### Prerequisites

- **Node.js** 20+ and npm
- **FFmpeg** installed and available in PATH
- **Redis** server running

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/crisog/ffmpeg-rest
   cd ffmpeg-rest
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start Redis** (using Docker)

   ```bash
   docker-compose up -d
   ```

4. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Run the API**

   Development mode (with auto-reload):

   ```bash
   # Terminal 1 - Start the API server
   npm run dev

   # Terminal 2 - Start the worker
   npm run dev:worker
   ```

   Production mode:

   ```bash
   npm run build
   npm start
   ```
