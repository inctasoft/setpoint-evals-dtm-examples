/**
 * REST-only response shapes for Phase 4b's multi-workflow dashboard — mirrors
 * services/orchestrator/src/workflow-loader/workflow-management.controller.ts,
 * kafka/kafka-topics.controller.ts and metrics/metrics.controller.ts.
 * (WebSocket event shapes live in ./events.ts.)
 */

/** GET /api/v1/workflows — one entry per registered workflow. */
export interface WorkflowSummary {
  name: string;
  description: string;
  enabled: boolean;
  variants: string[];
  cascadeCount: number;
  stepCount: number;
}

export interface WorkflowsListResponse {
  workflows: WorkflowSummary[];
  total: number;
}

/** GET /api/v1/workflows/:workflowName — DAG mini-viz's data contract (SE-23). */
export interface WorkflowStepDefinition {
  step: string;
  description: string;
  dependencies: string[];
  requiresAcknowledgement: boolean;
  isChildStep: boolean;
  isFanOutStep: boolean;
}

export interface WorkflowDetail {
  name: string;
  description: string;
  enabled: boolean;
  defaultVariant: string;
  variants: Array<{ name: string; isDefault: boolean; description: string }>;
  stepsByVariant: Record<string, WorkflowStepDefinition[]>;
  cascades: unknown[];
  outcomeRules: unknown[];
  featureFlags: Record<string, unknown>;
}

/** GET /api/v1/workflows/:workflowName/flags */
export interface WorkflowFlagsResponse {
  workflow: string;
  flags: Record<string, unknown>;
  clientOverridable: string[];
  requestOverridesEnabled: boolean;
}

/** GET /api/v1/jobs/:jobId — full job detail incl. step input/output/ackMetadata (Payloads tab). */
export interface JobDetailStep {
  id: string;
  stepNumber: number;
  stepName: string;
  description: string;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  lambdaFunctionName?: string;
  sqsMessageId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  retryCount?: number;
  maxRetryCount?: number;
  kafkaPublishedAt?: string | null;
  ackReceivedAt?: string | null;
  ackMetadata?: Record<string, unknown> | null;
}

export interface JobDetailFull {
  id: string;
  type: string;
  workflowName: string;
  status: string;
  payload: Record<string, unknown>;
  submittedBy: string;
  submittedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  steps: JobDetailStep[];
}

/** GET /api/v1/kafka/topics */
export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  approxMessageCount: number;
}

export interface KafkaTopicsResponse {
  topics: KafkaTopicSummary[];
  connected: boolean;
}

/** GET /api/v1/metrics/throughput */
export interface ThroughputBucket {
  bucket: string;
  completed: number;
  failed: number;
}

export interface ThroughputResponse {
  windowMinutes: number;
  workflow: string | null;
  buckets: ThroughputBucket[];
  totalCompleted: number;
  totalFailed: number;
}
