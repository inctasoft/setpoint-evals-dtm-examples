/**
 * API response types matching the orchestrator's jobs.controller.ts response shape.
 * See: services/orchestrator/src/jobs/jobs.controller.ts:256-306
 */

export interface StepResponse {
  id: string;
  /** stepValue from DB, returned as "stepNumber" by API */
  stepNumber: string;
  stepName: string;
  description: string | null;
  status: string;
  lambdaFunctionName: string | null;
  sqsMessageId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  retryCount: number;
  maxRetryCount: number;
  kafkaPublishedAt: string | null;
  ackReceivedAt: string | null;
  ackMetadata: Record<string, unknown> | null;
  parentStepId: string | null;
  childIndex: number | null;
  childItemId: string | null;
  childCount: number | null;
}

export interface JobResultResponse {
  totalRecords: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsAborted?: number;
  completedAt: string;
  durationMs: number;
}

export interface JobStatusResponse {
  id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  submittedBy: string;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  steps: StepResponse[];
  result: JobResultResponse | null;
}

/** POST /api/v1/workflows/:name/jobs response */
export interface InitiateJobResponse {
  jobId: string;
  workflowName: string;
  variant: string;
}

/** DB row from dtm_steps table */
export interface StepRow {
  id: string;
  job_id: string;
  step_value: string;
  status: string;
  retry_count: number;
  max_retry_count: number;
  error: string | null;
  execution_history: unknown[];
  records_processed: number;
  records_failed: number;
  parent_step_id: string | null;
  child_index: number | null;
  child_item_id: string | null;
  child_count: number | null;
  kafka_published_at: string | null;
  ack_received_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}
