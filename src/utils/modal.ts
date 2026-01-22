/**
 * Modal Serverless API Client
 *
 * Client for interacting with Modal.com deployed endpoints.
 * Follows the same pattern as the RunPod client for consistency.
 */
import { env } from '~/config/env';
import { logger } from '~/config/logger';

// InfiniteTalk job input
interface IModalInfiniteTalkJobInput {
  image_url?: string;
  video_url?: string;
  audio_url: string;
  resolution?: '480' | '720';
}

// Modal API response for job submission
interface IModalGenerateResponse {
  job_id: string;
  status: 'queued';
}

// Modal API response for status check
interface IModalStatusResponse {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  video?: string; // Base64 encoded video when completed
  error?: string;
}

export interface IModalClient {
  submitInfiniteTalkJob(input: IModalInfiniteTalkJobInput): Promise<IModalGenerateResponse>;
  getJobStatus(jobId: string): Promise<IModalStatusResponse>;
  isConfigured(): boolean;
}

class ModalClient implements IModalClient {
  private generateEndpoint: string;
  private statusEndpoint: string;
  private authToken: string;

  constructor() {
    this.generateEndpoint = env.MODAL_INFINITETALK_ENDPOINT ?? '';
    this.statusEndpoint = env.MODAL_INFINITETALK_STATUS_ENDPOINT ?? '';
    this.authToken = env.MODAL_AUTH_TOKEN ?? '';
  }

  isConfigured(): boolean {
    return Boolean(this.generateEndpoint && this.statusEndpoint);
  }

  async submitInfiniteTalkJob(input: IModalInfiniteTalkJobInput): Promise<IModalGenerateResponse> {
    if (!this.isConfigured()) {
      throw new Error(
        'Modal is not configured. Set MODAL_INFINITETALK_ENDPOINT, MODAL_INFINITETALK_STATUS_ENDPOINT, and MODAL_AUTH_TOKEN.'
      );
    }

    logger.info({ endpoint: this.generateEndpoint }, 'Submitting InfiniteTalk job to Modal');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add auth header if token is configured
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(this.generateEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Modal API error');
      throw new Error(`Modal API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as IModalGenerateResponse;
    logger.info({ modalJobId: result.job_id, status: result.status }, 'Modal job submitted');

    return result;
  }

  async getJobStatus(jobId: string): Promise<IModalStatusResponse> {
    if (!this.isConfigured()) {
      throw new Error(
        'Modal is not configured. Set MODAL_INFINITETALK_ENDPOINT and MODAL_INFINITETALK_STATUS_ENDPOINT.'
      );
    }

    const headers: Record<string, string> = {};

    // Add auth header if token is configured
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    // Modal uses query params for GET endpoints
    const url = `${this.statusEndpoint}?job_id=${encodeURIComponent(jobId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Modal API error: ${response.status} - ${errorText}`);
    }

    return (await response.json()) as IModalStatusResponse;
  }
}

// Singleton instance
export const modalClient: IModalClient = new ModalClient();
