import { logger } from '~/config/logger';

interface IWebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  result?: {
    url: string;
    fileSizeBytes: number;
    processingTimeMs: number;
  };
  error?: string;
  timestamp: string;
}

export async function sendWebhook(
  webhookUrl: string,
  jobId: string,
  status: 'completed' | 'failed',
  result?: IWebhookPayload['result'],
  error?: string
): Promise<void> {
  const payload: IWebhookPayload = {
    jobId,
    status,
    result,
    error,
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (!response.ok) {
      logger.error({ jobId, webhookUrl, status: response.status }, 'Webhook delivery failed');
    } else {
      logger.info({ jobId, webhookUrl }, 'Webhook sent successfully');
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, webhookUrl, error: errorMessage }, 'Webhook error');
  }
}
