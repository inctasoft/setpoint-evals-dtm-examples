/**
 * Callback Payload Interfaces
 *
 * Defines the HTTP callback payloads that workers send back to the orchestrator.
 * These are the contract between workers and the DTM core.
 *
 * Flow: Worker receives work via SQS → processes → sends HTTP callback to orchestrator
 */

/**
 * Retry metadata tracked across worker attempts.
 * Populated by the worker SDK from SQS message attributes.
 */
export interface RetryMetadata {
  /** SQS message ID for this attempt */
  sqsMessageId: string;

  /** Number of times SQS has delivered this message (1 = first attempt) */
  sqsReceiveCount: number;

  /** Wall-clock time (ms) the worker spent processing */
  processingTimeMs: number;

  /** Whether this is a retry (sqsReceiveCount > 1) */
  isRetry: boolean;
}

/**
 * Base fields present in all callback payloads.
 */
export interface BaseCallbackPayload {
  /** Job ID this step belongs to */
  jobId: string;

  /** Step ID being reported on */
  stepId: string;

  /** Retry metadata from the worker */
  retryMetadata: RetryMetadata;
}

/**
 * Worker signals it has started processing.
 * Sent at the START of Lambda execution to transition step to IN_PROGRESS.
 */
export interface InProgressCallbackPayload extends BaseCallbackPayload {
  status: "in_progress";
}

/**
 * Worker signals successful completion.
 */
export interface SuccessCallbackPayload<T = unknown>
  extends BaseCallbackPayload {
  status: "completed";

  /** Number of records successfully processed */
  recordsProcessed: number;

  /** Step output data (stored in step.output for downstream steps) */
  output: T;
}

/**
 * Worker signals failure.
 */
export interface FailureCallbackPayload extends BaseCallbackPayload {
  status: "failed";

  /** Number of records processed before failure */
  recordsProcessed: number;

  /** Error message */
  error: string;
}

/**
 * Union type for all callback payloads.
 */
export type CallbackPayload =
  | InProgressCallbackPayload
  | SuccessCallbackPayload
  | FailureCallbackPayload;

/**
 * Base work message structure sent from orchestrator to workers via SQS.
 */
export interface WorkMessage {
  /** Job ID */
  jobId: string;

  /** Step ID */
  stepId: string;

  /** Step name (e.g., 'ValidateCustomer') */
  stepName: string;

  /** Workflow variant (e.g., 'membership', 'membership_batch') */
  workflowVariant: string;

  /** Input data for this step */
  input: Record<string, unknown>;

  /** HTTP callback URL for the worker to report progress */
  callbackUrl: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Test options for this specific step (if testing is enabled) */
  testOptions?: Record<string, unknown>;
}
