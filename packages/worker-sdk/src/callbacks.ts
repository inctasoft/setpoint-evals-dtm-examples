import axios from "axios";
import {
  SuccessCallbackPayload,
  FailureCallbackPayload,
  InProgressCallbackPayload,
  RetryMetadata,
} from "./types";

/**
 * Callback utilities for communicating with orchestrator
 */

/**
 * Send in-progress callback to orchestrator to signal work has started
 *
 * This should be called at the START of Lambda processing, BEFORE any
 * simulated delays or actual work. This allows the orchestrator to track
 * which steps are actively being processed (vs just delegated to SQS).
 *
 * @param callbackUrl - Orchestrator callback endpoint URL
 * @param jobId - Job ID
 * @param stepId - Step ID
 * @param retryMetadata - Retry tracking information
 * @param stepName - Name of the step (for logging)
 */
export async function sendInProgressCallback(
  callbackUrl: string,
  jobId: string,
  stepId: string,
  retryMetadata: Omit<RetryMetadata, "isRetry">,
  stepName: string,
): Promise<void> {
  try {
    const payload: InProgressCallbackPayload = {
      jobId,
      stepId,
      status: "in_progress",
      retryMetadata: {
        // Bus-neutral primaries + legacy SQS aliases (D-D compat window):
        // workers send BOTH so mixed worker/orchestrator versions interoperate.
        taskHandle: retryMetadata.taskHandle ?? retryMetadata.sqsMessageId,
        attemptNumber: retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount,
        sqsMessageId: retryMetadata.sqsMessageId ?? retryMetadata.taskHandle,
        sqsReceiveCount: retryMetadata.sqsReceiveCount ?? retryMetadata.attemptNumber,
        processingTimeMs: retryMetadata.processingTimeMs,
        isRetry: (retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount ?? 1) > 1,
      },
    };

    console.log(`[${stepName}] Sending in-progress callback...`);
    const response = await axios.post(callbackUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000, // Shorter timeout for in-progress (non-critical)
    });

    console.log(`[${stepName}] ✅ In-progress callback sent:`, {
      status: response.status,
      attempt: retryMetadata.sqsReceiveCount,
    });
  } catch (error) {
    // Log but don't throw - in-progress callback is not critical
    // If it fails, the work continues and success/failure callback will update status
    console.warn(
      `[${stepName}] ⚠️ In-progress callback failed (non-critical):`,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

/**
 * Send success callback to orchestrator with processed data and retry metadata
 *
 * @param callbackUrl - Orchestrator callback endpoint URL
 * @param jobId - Job ID
 * @param stepId - Step ID
 * @param output - Processed output data (extracted/transformed)
 * @param recordsProcessed - Number of records processed
 * @param retryMetadata - Retry tracking information
 * @param stepName - Name of the step (for logging)
 */
export async function sendSuccessCallback<T = unknown>(
  callbackUrl: string,
  jobId: string,
  stepId: string,
  output: T,
  recordsProcessed: number,
  retryMetadata: Omit<RetryMetadata, "isRetry">,
  stepName: string,
): Promise<void> {
  try {
    const payload: SuccessCallbackPayload<T> = {
      jobId,
      stepId,
      status: "completed",
      recordsProcessed,
      output,
      // Retry metadata for tracking execution attempts
      retryMetadata: {
        // Bus-neutral primaries + legacy SQS aliases (D-D compat window):
        // workers send BOTH so mixed worker/orchestrator versions interoperate.
        taskHandle: retryMetadata.taskHandle ?? retryMetadata.sqsMessageId,
        attemptNumber: retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount,
        sqsMessageId: retryMetadata.sqsMessageId ?? retryMetadata.taskHandle,
        sqsReceiveCount: retryMetadata.sqsReceiveCount ?? retryMetadata.attemptNumber,
        processingTimeMs: retryMetadata.processingTimeMs,
        isRetry: (retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount ?? 1) > 1,
      },
    };

    console.log(`[${stepName}] Sending success callback...`);
    const response = await axios.post(callbackUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    console.log(`[${stepName}] ✅ Callback sent successfully:`, {
      status: response.status,
      attempt: retryMetadata.sqsReceiveCount,
      recordsProcessed,
    });
  } catch (error) {
    console.error(`[${stepName}] ❌ Callback failed:`, error);
    throw new Error(
      `Callback failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Send failure callback to orchestrator with error details and retry metadata
 *
 * @param callbackUrl - Orchestrator callback endpoint URL
 * @param jobId - Job ID
 * @param stepId - Step ID
 * @param error - Error that occurred
 * @param retryMetadata - Retry tracking information
 * @param stepName - Name of the step (for logging)
 */
export async function sendFailureCallback(
  callbackUrl: string,
  jobId: string,
  stepId: string,
  error: Error,
  retryMetadata: Omit<RetryMetadata, "isRetry">,
  stepName: string,
): Promise<void> {
  try {
    const payload: FailureCallbackPayload = {
      jobId,
      stepId,
      status: "failed",
      recordsProcessed: 0,
      error: error.message,
      // Retry metadata for tracking execution attempts
      retryMetadata: {
        // Bus-neutral primaries + legacy SQS aliases (D-D compat window):
        // workers send BOTH so mixed worker/orchestrator versions interoperate.
        taskHandle: retryMetadata.taskHandle ?? retryMetadata.sqsMessageId,
        attemptNumber: retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount,
        sqsMessageId: retryMetadata.sqsMessageId ?? retryMetadata.taskHandle,
        sqsReceiveCount: retryMetadata.sqsReceiveCount ?? retryMetadata.attemptNumber,
        processingTimeMs: retryMetadata.processingTimeMs,
        isRetry: (retryMetadata.attemptNumber ?? retryMetadata.sqsReceiveCount ?? 1) > 1,
      },
    };

    console.log(`[${stepName}] Sending failure callback...`);
    await axios.post(callbackUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log(
      `[${stepName}] ✅ Failure callback sent (attempt ${retryMetadata.sqsReceiveCount})`,
    );
  } catch (callbackError) {
    console.error(
      `[${stepName}] ❌ Failure callback also failed:`,
      callbackError,
    );
  }
}
