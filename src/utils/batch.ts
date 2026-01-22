/**
 * Batch Job Tracking Utility
 *
 * Manages batch job state in Redis for bulk generation endpoints.
 * Tracks multiple jobs under a single batch ID and detects when all jobs complete.
 */
import { randomUUID } from 'crypto';
import { connection } from '~/config/redis';
import { logger } from '~/config/logger';

// 7-day TTL for batch data in Redis
const BATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failure';

export interface IBatchJobResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: {
    url: string;
    fileSizeBytes: number;
    processingTimeMs: number;
  };
  error?: string;
}

export interface IBatchMetadata {
  batchId: string;
  model: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  jobIds: string[];
  webhookUrl?: string;
  webhookSent: boolean;
  createdAt: string;
  completedAt?: string;
}

/**
 * Generate a unique batch ID with prefix
 */
export function generateBatchId(): string {
  return `batch_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * Create a new batch and store metadata in Redis
 */
export async function createBatch(jobIds: string[], model: string, webhookUrl?: string): Promise<IBatchMetadata> {
  const batchId = generateBatchId();
  const now = new Date().toISOString();

  const metadata: IBatchMetadata = {
    batchId,
    model,
    totalJobs: jobIds.length,
    completedJobs: 0,
    failedJobs: 0,
    jobIds,
    webhookUrl,
    webhookSent: false,
    createdAt: now
  };

  // Store batch metadata
  await connection.setex(`batch:${batchId}`, BATCH_TTL_SECONDS, JSON.stringify(metadata));

  // Create reverse mapping from jobId to batchId for quick lookup
  const pipeline = connection.pipeline();
  for (const jobId of jobIds) {
    pipeline.setex(`job-batch:${jobId}`, BATCH_TTL_SECONDS, batchId);
  }
  await pipeline.exec();

  logger.info({ batchId, model, totalJobs: jobIds.length }, 'Batch created');

  return metadata;
}

/**
 * Get batch metadata by batch ID
 */
export async function getBatch(batchId: string): Promise<IBatchMetadata | null> {
  const data = await connection.get(`batch:${batchId}`);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as IBatchMetadata;
  } catch {
    logger.error({ batchId }, 'Failed to parse batch metadata');
    return null;
  }
}

/**
 * Get the batch ID for a given job ID
 */
export async function getBatchIdForJob(jobId: string): Promise<string | null> {
  return connection.get(`job-batch:${jobId}`);
}

/**
 * Update batch with job completion status
 * Returns the updated metadata and whether the batch is now complete
 */
export async function updateBatchJobStatus(
  batchId: string,
  jobId: string,
  status: 'completed' | 'failed'
): Promise<{ metadata: IBatchMetadata; isComplete: boolean } | null> {
  const metadata = await getBatch(batchId);
  if (!metadata) {
    logger.warn({ batchId, jobId }, 'Batch not found for job update');
    return null;
  }

  // Update counters based on status
  if (status === 'completed') {
    metadata.completedJobs += 1;
  } else if (status === 'failed') {
    metadata.failedJobs += 1;
  }

  const totalFinished = metadata.completedJobs + metadata.failedJobs;
  const isComplete = totalFinished >= metadata.totalJobs;

  if (isComplete) {
    metadata.completedAt = new Date().toISOString();
  }

  // Save updated metadata
  await connection.setex(`batch:${batchId}`, BATCH_TTL_SECONDS, JSON.stringify(metadata));

  logger.info(
    { batchId, jobId, status, completedJobs: metadata.completedJobs, failedJobs: metadata.failedJobs, isComplete },
    'Batch job status updated'
  );

  return { metadata, isComplete };
}

/**
 * Mark batch webhook as sent to prevent duplicate sends
 */
export async function markBatchWebhookSent(batchId: string): Promise<void> {
  const metadata = await getBatch(batchId);
  if (!metadata) {
    return;
  }

  metadata.webhookSent = true;
  await connection.setex(`batch:${batchId}`, BATCH_TTL_SECONDS, JSON.stringify(metadata));

  logger.info({ batchId }, 'Batch webhook marked as sent');
}

/**
 * Calculate the overall batch status based on job completion
 */
export function calculateBatchStatus(metadata: IBatchMetadata): BatchStatus {
  const totalFinished = metadata.completedJobs + metadata.failedJobs;

  if (totalFinished === 0) {
    return 'pending';
  }

  if (totalFinished < metadata.totalJobs) {
    return 'processing';
  }

  // All jobs finished
  if (metadata.failedJobs === 0) {
    return 'completed';
  }

  return 'partial_failure';
}
