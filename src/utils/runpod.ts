/**
 * RunPod Serverless API Client
 */
import { env } from '~/config/env';
import { logger } from '~/config/logger';

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

// InfiniteTalk Audio-Driven Video input (internal interface)
interface IInfiniteTalkJobInput {
  image_url?: string;
  video_url?: string;
  audio_url: string;
  resolution?: '480' | '720';
  jobId?: string;
}

// InfiniteTalk RunPod API format (what the endpoint expects)
// Based on https://github.com/wlsdml1114/Infinitetalk_Runpod_hub
interface IInfiniteTalkRunPodInput {
  input_type: 'image' | 'video';
  person_count: 'single' | 'multi';
  wav_url: string;
  image_url?: string;
  video_url?: string;
  width?: number;
  height?: number;
  prompt?: string;
}

interface IRunPodRunResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

interface IRunPodStatusResponse {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  executionTime?: number;
  output?: {
    url?: string;
    video?: string; // Base64 encoded video (used by InfiniteTalk)
    contentType?: string;
    fileSizeBytes?: number;
    durationMs?: number;
    width?: number;
    height?: number;
    processingTimeMs?: number;
  };
  error?: string;
}

type EndpointType = 'zimage' | 'infinitetalk';

export interface IRunPodClient {
  submitZImageJob(input: IZImageJobInput): Promise<IRunPodRunResponse>;
  submitInfiniteTalkJob(input: IInfiniteTalkJobInput): Promise<IRunPodRunResponse>;
  getJobStatus(endpointType: EndpointType, jobId: string): Promise<IRunPodStatusResponse>;
  isConfigured(endpointType?: EndpointType): boolean;
}

class RunPodClient implements IRunPodClient {
  private apiKey: string;
  private zimageEndpointId: string;
  private infinitetalkEndpointId: string;
  private baseUrl = 'https://api.runpod.ai/v2';

  constructor() {
    this.apiKey = env.RUNPOD_API_KEY ?? '';
    this.zimageEndpointId = env.RUNPOD_ZIMAGE_ENDPOINT_ID ?? '';
    this.infinitetalkEndpointId = env.RUNPOD_INFINITETALK_ENDPOINT_ID ?? '';
  }

  private getEndpointId(type: EndpointType): string {
    switch (type) {
      case 'zimage':
        return this.zimageEndpointId;
      case 'infinitetalk':
        return this.infinitetalkEndpointId;
    }
  }

  isConfigured(endpointType?: EndpointType): boolean {
    if (!this.apiKey) return false;
    if (!endpointType) {
      return Boolean(this.zimageEndpointId || this.infinitetalkEndpointId);
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

  async submitZImageJob(input: IZImageJobInput): Promise<IRunPodRunResponse> {
    return this.submitJob('zimage', input, input.jobId);
  }

  async submitInfiniteTalkJob(input: IInfiniteTalkJobInput): Promise<IRunPodRunResponse> {
    // Transform to RunPod API format based on Infinitetalk_Runpod_hub
    // Parameters: wav_url, image_url/video_url, input_type, person_count
    const runpodInput: IInfiniteTalkRunPodInput = {
      wav_url: input.audio_url,
      input_type: input.video_url ? 'video' : 'image',
      person_count: 'single'
    };

    // Set dimensions based on resolution
    if (input.resolution === '720') {
      runpodInput.width = 1280;
      runpodInput.height = 720;
    } else {
      runpodInput.width = 854;
      runpodInput.height = 480;
    }

    if (input.image_url) {
      runpodInput.image_url = input.image_url;
    }
    if (input.video_url) {
      runpodInput.video_url = input.video_url;
    }

    logger.info({ input: runpodInput }, 'Submitting InfiniteTalk job with transformed parameters');
    return this.submitJob('infinitetalk', runpodInput, input.jobId);
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
