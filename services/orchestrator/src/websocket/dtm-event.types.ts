/**
 * DTM WebSocket Event Types
 *
 * These events are broadcast to connected dashboard clients
 * for real-time operations monitoring.
 */

import type { StepStatus as CoreStepStatus } from '@dtm/core';
import type { AgentEvent, AgentForest } from '@dtm/core';

/**
 * WS-facing step status — derived from @dtm/core's StepStatus enum (the DB-canonical
 * 10-value source), NOT a hand-maintained duplicate. This USED TO be a hand-typed
 * 7-value union (missing skipped/waiting_for_children/partial_success) while the DB
 * enum had 10 — the 3-way status-vocabulary drift (dtm-video-v2 capability-spec.md
 * §1.5/§2d) that let events.gateway.ts's sendSnapshot() smuggle those 3 statuses
 * through an unsound `as StepSnapshot['status']` cast. Deriving via a template-literal
 * type over the enum means a future value added to @dtm/core's StepStatus and NOT
 * handled by a consumer (e.g. the monitor's STATUS_CLASS map) becomes a compile error,
 * not a silently-unstyled DAG node. setpoint-evals/SE-27-dag-overlay-status-parity
 * pins this — do not replace this with a hand-written string union.
 */
export type StepStatus = `${CoreStepStatus}`;

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'partial_success';

export interface StepSnapshot {
  step: string;
  description: string;
  status: StepStatus;
  stepNumber: number;
  error?: string;
  duration?: number;
  attempt?: number;
  /**
   * Number of fan-out children this step spawned (discovery/parent steps only —
   * e.g. DiscoverLineItems, DiscoverSensors). Absent/undefined for non-fan-out steps.
   * Mirrors dtm_steps.child_count (Step.childCount) — see SE-28-step-snapshot-childcount.
   */
  childCount?: number;
}

export interface JobResults {
  totalRecordsProcessed: number;
  totalRecordsFailed: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsAborted: number;
  durationMs: number;
}

export interface JobSnapshot {
  id: string;
  workflow: string;
  variant: string;
  status: JobStatus;
  steps: StepSnapshot[];
  createdAt: string;
  completedAt?: string;
  error?: string;
  results?: JobResults;
}

export interface SqsQueueStatus {
  name: string;
  available: number;
  inFlight: number;
  dlq: number;
}

export interface BaseEvent {
  correlationId?: string;
  timestamp: string;
}

export type DtmEvent =
  | (BaseEvent & {
      type: 'job_created';
      jobId: string;
      workflow: string;
      variant: string;
      steps: StepSnapshot[];
    })
  | (BaseEvent & { type: 'job_completed'; jobId: string; status: JobStatus; results?: JobResults })
  | (BaseEvent & { type: 'step_started'; jobId: string; step: string })
  | (BaseEvent & { type: 'step_completed'; jobId: string; step: string; duration: number })
  | (BaseEvent & { type: 'step_failed'; jobId: string; step: string; error: string })
  | (BaseEvent & { type: 'step_retrying'; jobId: string; step: string; attempt: number })
  | (BaseEvent & { type: 'step_skipped'; jobId: string; step: string; reason: string })
  | (BaseEvent & { type: 'step_ack_waiting'; jobId: string; step: string })
  | (BaseEvent & { type: 'step_ack_received'; jobId: string; step: string })
  | (BaseEvent & { type: 'sqs_status'; queues: SqsQueueStatus[] })
  | (BaseEvent & { type: 'snapshot'; jobs: JobSnapshot[] })
  // Phase-C agent-tree plane (agent-event/1, canonical schema in server-config
  // setpoint-evals/agent-event-schema/): live envelope pass-through + the
  // server-authoritative per-root snapshot. SE-39 pins both variants across the wire.
  | (BaseEvent & { type: 'agent_event'; event: AgentEvent })
  | (BaseEvent & { type: 'agent_forest'; forest: AgentForest });
