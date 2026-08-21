import { SQSRecord } from "aws-lambda";
import { SQSMessageAttributes, BatchItemFailure } from "./types";

/**
 * SQS utilities for Lambda workers
 */

/**
 * Extract SQS message attributes (including receive count for retry tracking)
 *
 * @param record - SQS record from Lambda event
 * @returns Message attributes including retry count and message ID
 */
export function getSQSMessageAttributes(
  record: SQSRecord,
): SQSMessageAttributes {
  // SQS provides ApproximateReceiveCount in attributes
  const receiveCount = parseInt(
    record.attributes?.ApproximateReceiveCount || "1",
    10,
  );

  return {
    receiveCount,
    messageId: record.messageId,
  };
}

/**
 * Create a batch item failure object for SQS partial batch response
 *
 * @param messageId - SQS message ID that failed
 * @returns Batch item failure in AWS SQS format
 */
export function createBatchItemFailure(messageId: string): BatchItemFailure {
  return { itemIdentifier: messageId };
}

/**
 * Build retry metadata from SQS attributes and processing time.
 *
 * Emits BOTH the bus-neutral names (taskHandle / attemptNumber) and the
 * legacy SQS aliases (sqsMessageId / sqsReceiveCount) so one release of
 * mixed worker/orchestrator versions works (operator decision D-D).
 *
 * @param sqsAttributes - SQS message attributes
 * @param processingStartTime - Timestamp when processing started (from Date.now())
 * @returns Retry metadata object for callbacks
 */
export function buildRetryMetadata(
  sqsAttributes: SQSMessageAttributes,
  processingStartTime: number,
): {
  taskHandle: string;
  attemptNumber: number;
  sqsMessageId: string;
  sqsReceiveCount: number;
  processingTimeMs: number;
} {
  return {
    taskHandle: sqsAttributes.messageId,
    attemptNumber: sqsAttributes.receiveCount,
    sqsMessageId: sqsAttributes.messageId,
    sqsReceiveCount: sqsAttributes.receiveCount,
    processingTimeMs: Date.now() - processingStartTime,
  };
}
