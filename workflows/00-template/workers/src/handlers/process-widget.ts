/**
 * Process Widget — Lambda Worker (Phase 2)
 *
 * Template worker handler. Replace with your actual processing logic.
 *
 * Contract:
 * 1. Receive BaseWorkMessage from SQS (includes source data from prior step)
 * 2. Process data to target format
 * 3. Send callback to orchestrator with processed data
 *
 * See reference: workflows/order-processing/workers/
 */

import {
  sendSuccessCallback,
  sendFailureCallback,
  sendInProgressCallback,
  BaseWorkMessage,
  getMyTestOptions,
} from '@dtm/worker-sdk';

export async function handler(message: BaseWorkMessage): Promise<void> {
  const { jobId, stepId, callbackUrl, input } = message;
  const testOptions = getMyTestOptions(message);
  const widgetId = (input.widgetId as string) || 'unknown';

  try {
    await sendInProgressCallback(callbackUrl, stepId, {
      message: `Processing widget ${widgetId}`,
    });

    // TODO: Replace with your actual processing logic
    const processedData = {
      widgetId,
      processedAt: new Date().toISOString(),
      source: input,
    };

    await sendSuccessCallback(callbackUrl, stepId, {
      data: processedData,
      outputDataKey: `widget_${widgetId}`,
    });
  } catch (error) {
    await sendFailureCallback(callbackUrl, stepId, {
      error: error instanceof Error ? error.message : 'Unknown error',
      retryable: false,
    });
  }
}
