/**
 * RunPod Serverless API Client
 */
import { env } from '~/config/env';
import { logger } from '~/config/logger';

// LTX-2 Image-to-Video input
interface ILtx2JobInput {
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

// Z-Image Text-to-Image input
interface IZImageJobInput {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidanceScale?: number;
  seed?: number;
  jobId?: string;
}

// LongCat Avatar input
interface ILongCatJobInput {
  audioUrl: string;
  imageUrl?: string;
  prompt?: string;
  mode?: 'at2v' | 'ai2v';
  resolution?: '480P' | '720P';
  audioCfg?: number;
  numSegments?: number;
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
    durationMs?: number;
    width: number;
    height: number;
    processingTimeMs: number;
  };
  error?: string;
}

type EndpointType = 'ltx2' | 'zimage' | 'longcat';

export interface IRunPodClient {
  submitLtx2Job(input: ILtx2JobInput): Promise<IRunPodRunResponse>;
  submitZImageJob(input: IZImageJobInput): Promise<IRunPodRunResponse>;
  submitLongCatJob(input: ILongCatJobInput): Promise<IRunPodRunResponse>;
  getJobStatus(endpointType: EndpointType, jobId: string): Promise<IRunPodStatusResponse>;
  isConfigured(endpointType?: EndpointType): boolean;
}

class RunPodClient implements IRunPodClient {
  private apiKey: string;
  private ltx2EndpointId: string;
  private zimageEndpointId: string;
  private longcatEndpointId: string;
  private baseUrl = 'https://api.runpod.ai/v2';

  constructor() {
    this.apiKey = env.RUNPOD_API_KEY ?? '';
    this.ltx2EndpointId = env.RUNPOD_LTX2_ENDPOINT_ID ?? '';
    this.zimageEndpointId = env.RUNPOD_ZIMAGE_ENDPOINT_ID ?? '';
    this.longcatEndpointId = env.RUNPOD_LONGCAT_ENDPOINT_ID ?? '';
  }

  private getEndpointId(type: EndpointType): string {
    switch (type) {
      case 'ltx2':
        return this.ltx2EndpointId;
      case 'zimage':
        return this.zimageEndpointId;
      case 'longcat':
        return this.longcatEndpointId;
    }
  }

  isConfigured(endpointType?: EndpointType): boolean {
    if (!this.apiKey) return false;
    if (!endpointType) {
      return Boolean(this.ltx2EndpointId || this.zimageEndpointId || this.longcatEndpointId);
    }
    return Boolean(this.getEndpointId(endpointType));
  }

  private async submitJob<T>(endpointType: EndpointType, input: T, jobId?: string): Promise<IRunPodRunResponse> {
    const endpointId = this.getEndpointId(endpointType);
    if (!this.apiKey || !endpointId) {
      throw new Error(
        `RunPod is not configured for ${endpointType}. Set RUNPOD_API_KEY and RUNPOD_${endpointType.toUpperCase()}_ENDPOINT_ID.`
      );
    }

    const url = `${this.baseUrl}/${endpointId}/run`;

    logger.info({ endpointType, endpointId, jobId }, `Submitting ${endpointType} job to RunPod`);

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

  async submitLtx2Job(input: ILtx2JobInput): Promise<IRunPodRunResponse> {
    return this.submitJob('ltx2', input, input.jobId);
  }

  async submitZImageJob(input: IZImageJobInput): Promise<IRunPodRunResponse> {
    return this.submitJob('zimage', input, input.jobId);
  }

  async submitLongCatJob(input: ILongCatJobInput): Promise<IRunPodRunResponse> {
    return this.submitJob('longcat', input, input.jobId);
  }

  async getJobStatus(endpointType: EndpointType, jobId: string): Promise<IRunPodStatusResponse> {
    const endpointId = this.getEndpointId(endpointType);
    if (!this.apiKey || !endpointId) {
      throw new Error(
        `RunPod is not configured for ${endpointType}. Set RUNPOD_API_KEY and RUNPOD_${endpointType.toUpperCase()}_ENDPOINT_ID.`
      );
    }

    const url = `${this.baseUrl}/${endpointId}/status/${jobId}`;

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
