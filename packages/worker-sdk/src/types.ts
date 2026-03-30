import { SQSRecord } from "aws-lambda";

/**
 * Base work message structure sent from orchestrator to workers
 */
export interface BaseWorkMessage {
  jobId: string;
  stepId: string;
  stepValue: string;
  stepType: string;
  jobType: string;
  input: Record<string, unknown>;
  callbackUrl: string;
  correlationId?: string;
}

/**
 * Source configuration for source-querying workers
 */
export interface SourceConfig {
  sourceDatabase: string;
  sourceTable: string;
  filterKey: string;
}

/**
 * Processing configuration for data-processing workers
 */
export interface ProcessingConfig {
  targetDatabase: string;
  targetTable: string;
  transformRules?: Record<string, unknown>;
}

/**
 * Work message for source-querying workers
 */
export interface SourceWorkMessage extends BaseWorkMessage {
  sourceConfig?: SourceConfig;
}

/**
 * Work message for data-processing workers
 */
export interface ProcessingWorkMessage extends BaseWorkMessage {
  processingConfig?: ProcessingConfig;
}

/**
 * Retry metadata tracked across Lambda attempts
 */
export interface RetryMetadata {
  sqsMessageId: string;
  sqsReceiveCount: number;
  processingTimeMs: number;
  isRetry: boolean;
}

/**
 * SQS message attributes extracted for tracking
 */
export interface SQSMessageAttributes {
  receiveCount: number;
  messageId: string;
}

/**
 * Success callback payload structure
 */
export interface SuccessCallbackPayload<T = unknown> {
  jobId: string;
  stepId: string;
  status: "completed";
  recordsProcessed: number;
  output: T;
  retryMetadata: RetryMetadata;
}

/**
 * Failure callback payload structure
 */
export interface FailureCallbackPayload {
  jobId: string;
  stepId: string;
  status: "failed";
  recordsProcessed: number;
  error: string;
  retryMetadata: RetryMetadata;
}

/**
 * In-progress callback payload structure
 * Sent at the START of Lambda processing to signal work has begun
 */
export interface InProgressCallbackPayload {
  jobId: string;
  stepId: string;
  status: "in_progress";
  retryMetadata: RetryMetadata;
}

/**
 * AWS SQS batch item failure response format
 */
export interface BatchItemFailure {
  itemIdentifier: string;
}

/**
 * Lambda handler response for SQS batch processing
 */
export interface SQSBatchResponse {
  batchItemFailures: BatchItemFailure[];
}
