/**
 * WaveSpeed API Client
 *
 * Client for interacting with WaveSpeed.ai API endpoints.
 * Follows the same pattern as the RunPod client for consistency.
 */
import { env } from '~/config/env';
import { logger } from '~/config/logger';

// InfiniteTalk job input (WaveSpeed uses 'audio' and 'image', not URL suffix)
export interface IWaveSpeedInfiniteTalkInput {
  audio: string; // URL to audio file
  image: string; // URL to image file
  resolution?: '480p' | '720p';
}

// WaveSpeed API response for job submission
interface IWaveSpeedSubmitResponse {
  code: number;
  message: string;
  data: {
    id: string;
  };
}

// WaveSpeed API response for status check
export interface IWaveSpeedStatusResponse {
  code: number;
  message: string;
  data: {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    outputs?: string[]; // Array of output URLs when completed
    error?: string;
  };
}

export interface IWaveSpeedClient {
  submitInfiniteTalkJob(input: IWaveSpeedInfiniteTalkInput): Promise<{ job_id: string; status: 'queued' }>;
  getJobStatus(jobId: string): Promise<IWaveSpeedStatusResponse>;
  isConfigured(): boolean;
  submitBatchInfiniteTalkJobs(
    inputs: IWaveSpeedInfiniteTalkInput[],
    maxConcurrent?: number
  ): Promise<{ job_id: string; status: 'queued' }[]>;
}

// Helper to chunk array into smaller arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

class WaveSpeedClient implements IWaveSpeedClient {
  private apiKey: string;
  private submitEndpoint = 'https://api.wavespeed.ai/api/v3/wavespeed-ai/infinitetalk';
  private statusEndpointBase = 'https://api.wavespeed.ai/api/v3/predictions';

  constructor() {
    this.apiKey = env.WAVESPEED_API_KEY ?? '';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async submitInfiniteTalkJob(input: IWaveSpeedInfiniteTalkInput): Promise<{ job_id: string; status: 'queued' }> {
    if (!this.isConfigured()) {
      throw new Error('WaveSpeed is not configured. Set WAVESPEED_API_KEY.');
    }

    logger.info({ endpoint: this.submitEndpoint }, 'Submitting InfiniteTalk job to WaveSpeed');

    const response = await fetch(this.submitEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'WaveSpeed API error');
      throw new Error(`WaveSpeed API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as IWaveSpeedSubmitResponse;

    if (result.code !== 200) {
      logger.error({ code: result.code, message: result.message }, 'WaveSpeed API returned error code');
      throw new Error(`WaveSpeed API error: ${result.code} - ${result.message}`);
    }

    logger.info({ wavespeedJobId: result.data.id }, 'WaveSpeed job submitted');

    return {
      job_id: result.data.id,
      status: 'queued'
    };
  }

  async getJobStatus(jobId: string): Promise<IWaveSpeedStatusResponse> {
    if (!this.isConfigured()) {
      throw new Error('WaveSpeed is not configured. Set WAVESPEED_API_KEY.');
    }

    const url = `${this.statusEndpointBase}/${encodeURIComponent(jobId)}/result`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WaveSpeed API error: ${response.status} - ${errorText}`);
    }

    return (await response.json()) as IWaveSpeedStatusResponse;
  }

  async submitBatchInfiniteTalkJobs(
    inputs: IWaveSpeedInfiniteTalkInput[],
    maxConcurrent = 3
  ): Promise<{ job_id: string; status: 'queued' }[]> {
    if (!this.isConfigured()) {
      throw new Error('WaveSpeed is not configured. Set WAVESPEED_API_KEY.');
    }

    const results: { job_id: string; status: 'queued' }[] = [];
    const chunks = chunkArray(inputs, maxConcurrent);

    logger.info(
      { totalJobs: inputs.length, chunks: chunks.length, maxConcurrent },
      'Processing WaveSpeed batch in chunks'
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      logger.info({ chunkIndex: i, chunkSize: chunk.length }, 'Processing WaveSpeed batch chunk');

      // Process chunk in parallel
      const chunkResults = await Promise.all(chunk.map((input) => this.submitInfiniteTalkJob(input)));

      results.push(...chunkResults);
    }

    return results;
  }
}

// Singleton instance
export const wavespeedClient: IWaveSpeedClient = new WaveSpeedClient();
