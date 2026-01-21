/**
 * RunPod Serverless API Client
 */
import { env } from '~/config/env';
import { logger } from '~/config/logger';

interface IRunPodJobInput {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  numInferenceSteps?: number;
  guidanceScale?: number;
  jobId?: string;
}

interface IRunPodRunResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

interface IRunPodStatusResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  output?: {
    url: string;
    contentType: string;
    fileSizeBytes: number;
    durationMs: number;
    width: number;
    height: number;
    processingTimeMs: number;
  };
  error?: string;
}

export interface IRunPodClient {
  submitLtx2Job(input: IRunPodJobInput): Promise<IRunPodRunResponse>;
  getJobStatus(jobId: string): Promise<IRunPodStatusResponse>;
  isConfigured(): boolean;
}

class RunPodClient implements IRunPodClient {
  private apiKey: string;
  private ltx2EndpointId: string;
  private baseUrl = 'https://api.runpod.ai/v2';

  constructor() {
    this.apiKey = env.RUNPOD_API_KEY ?? '';
    this.ltx2EndpointId = env.RUNPOD_LTX2_ENDPOINT_ID ?? '';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.ltx2EndpointId);
  }

  async submitLtx2Job(input: IRunPodJobInput): Promise<IRunPodRunResponse> {
    if (!this.isConfigured()) {
      throw new Error('RunPod is not configured. Set RUNPOD_API_KEY and RUNPOD_LTX2_ENDPOINT_ID.');
    }

    const url = `${this.baseUrl}/${this.ltx2EndpointId}/run`;

    logger.info({ endpointId: this.ltx2EndpointId, jobId: input.jobId }, 'Submitting LTX-2 job to RunPod');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ input })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'RunPod API error');
      throw new Error(`RunPod API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as IRunPodRunResponse;
    logger.info({ runpodJobId: result.id, status: result.status }, 'RunPod job submitted');

    return result;
  }

  async getJobStatus(jobId: string): Promise<IRunPodStatusResponse> {
    if (!this.isConfigured()) {
      throw new Error('RunPod is not configured. Set RUNPOD_API_KEY and RUNPOD_LTX2_ENDPOINT_ID.');
    }

    const url = `${this.baseUrl}/${this.ltx2EndpointId}/status/${jobId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RunPod API error: ${response.status} - ${errorText}`);
    }

    return (await response.json()) as IRunPodStatusResponse;
  }
}

// Singleton instance
export const runpodClient: IRunPodClient = new RunPodClient();
