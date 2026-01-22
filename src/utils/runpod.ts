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

// InfiniteTalk Audio-Driven Video input (internal interface)
interface IInfiniteTalkJobInput {
  image_url?: string;
  video_url?: string;
  audio_url: string;
  resolution?: '480' | '720';
  jobId?: string;
}

// Wan2.2 Image-to-Video input
interface IWan22LoRAPair {
  high: string;
  low: string;
  high_weight?: number;
  low_weight?: number;
}

interface IWan22JobInput {
  imageUrl: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  length?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
  contextOverlap?: number;
  loraPairs?: IWan22LoRAPair[];
  jobId?: string;
}

// Wan2.2 RunPod API format
interface IWan22RunPodInput {
  image_url: string;
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  length: number;
  steps: number;
  cfg: number;
  seed?: number;
  context_overlap: number;
  lora_pairs?: {
    high: string;
    low: string;
    high_weight: number;
    low_weight: number;
  }[];
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

type EndpointType = 'ltx2' | 'zimage' | 'longcat' | 'infinitetalk' | 'wan22';

export interface IRunPodClient {
  submitLtx2Job(input: ILtx2JobInput): Promise<IRunPodRunResponse>;
  submitZImageJob(input: IZImageJobInput): Promise<IRunPodRunResponse>;
  submitLongCatJob(input: ILongCatJobInput): Promise<IRunPodRunResponse>;
  submitInfiniteTalkJob(input: IInfiniteTalkJobInput): Promise<IRunPodRunResponse>;
  submitWan22Job(input: IWan22JobInput): Promise<IRunPodRunResponse>;
  getJobStatus(endpointType: EndpointType, jobId: string): Promise<IRunPodStatusResponse>;
  isConfigured(endpointType?: EndpointType): boolean;
}

class RunPodClient implements IRunPodClient {
  private apiKey: string;
  private ltx2EndpointId: string;
  private zimageEndpointId: string;
  private longcatEndpointId: string;
  private infinitetalkEndpointId: string;
  private wan22EndpointId: string;
  private baseUrl = 'https://api.runpod.ai/v2';

  constructor() {
    this.apiKey = env.RUNPOD_API_KEY ?? '';
    this.ltx2EndpointId = env.RUNPOD_LTX2_ENDPOINT_ID ?? '';
    this.zimageEndpointId = env.RUNPOD_ZIMAGE_ENDPOINT_ID ?? '';
    this.longcatEndpointId = env.RUNPOD_LONGCAT_ENDPOINT_ID ?? '';
    this.infinitetalkEndpointId = env.RUNPOD_INFINITETALK_ENDPOINT_ID ?? '';
    this.wan22EndpointId = env.RUNPOD_WAN22_ENDPOINT_ID ?? '';
  }

  private getEndpointId(type: EndpointType): string {
    switch (type) {
      case 'ltx2':
        return this.ltx2EndpointId;
      case 'zimage':
        return this.zimageEndpointId;
      case 'longcat':
        return this.longcatEndpointId;
      case 'infinitetalk':
        return this.infinitetalkEndpointId;
      case 'wan22':
        return this.wan22EndpointId;
    }
  }

  isConfigured(endpointType?: EndpointType): boolean {
    if (!this.apiKey) return false;
    if (!endpointType) {
      return Boolean(
        this.ltx2EndpointId ||
          this.zimageEndpointId ||
          this.longcatEndpointId ||
          this.infinitetalkEndpointId ||
          this.wan22EndpointId
      );
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

  async submitWan22Job(input: IWan22JobInput): Promise<IRunPodRunResponse> {
    // Transform to RunPod API format
    // Default: 1920x1080 (1080p HD 16:9), 81 frames, 30 steps, cfg 3.0
    const runpodInput: IWan22RunPodInput = {
      image_url: input.imageUrl,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      width: input.width ?? 1920,
      height: input.height ?? 1080,
      length: input.length ?? 81,
      steps: input.steps ?? 30,
      cfg: input.cfg ?? 3.0,
      seed: input.seed,
      context_overlap: input.contextOverlap ?? 48
    };

    // Transform LoRA pairs if provided
    if (input.loraPairs && input.loraPairs.length > 0) {
      runpodInput.lora_pairs = input.loraPairs.map((pair) => ({
        high: pair.high,
        low: pair.low,
        high_weight: pair.high_weight ?? 1.0,
        low_weight: pair.low_weight ?? 1.0
      }));
    }

    logger.info(
      { prompt: input.prompt, width: runpodInput.width, height: runpodInput.height, steps: runpodInput.steps },
      'Submitting Wan2.2 job with parameters'
    );
    return this.submitJob('wan22', runpodInput, input.jobId);
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
