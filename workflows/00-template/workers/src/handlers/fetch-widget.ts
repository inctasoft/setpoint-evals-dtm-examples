/**
 * Fetch Widget — Lambda Worker (Phase 1)
 *
 * Template worker handler. Replace with your actual source query logic.
 *
 * Contract:
 * 1. Receive BaseWorkMessage from SQS
 * 2. Query source database for entity data
 * 3. Send callback to orchestrator (success or failure)
 *
 * See reference: workflows/order-processing/workers/
 */

import {
  sendSuccessCallback,
  sendFailureCallback,
  sendInProgressCallback,
  BaseWorkMessage,
} from '@dtm/worker-sdk';

export async function handler(message: BaseWorkMessage): Promise<void> {
  const { jobId, stepId, callbackUrl, input } = message;
  const retryCount = (input.retryCount as number) || 0;
  const widgetId = input.widgetId as string || 'unknown';

  try {
    await sendInProgressCallback(callbackUrl, stepId, {
      message: `Querying source for widget ${widgetId}`,
    });

    // TODO: Replace with your actual source database query
    const widgetData = {
      id: widgetId,
      name: `Widget ${widgetId}`,
      queriedAt: new Date().toISOString(),
    };

    await sendSuccessCallback(callbackUrl, stepId, {
      data: widgetData,
      recordCount: 1,
    });
  } catch (error) {
    await sendFailureCallback(callbackUrl, stepId, {
      error: error instanceof Error ? error.message : 'Unknown error',
      retryable: retryCount < 3,
    });
  }
}
