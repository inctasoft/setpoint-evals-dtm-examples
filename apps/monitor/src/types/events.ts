import type { StepStatus as CoreStepStatus } from '@dtm/core';

/**
 * Frontend-facing step status — derived from @dtm/core's StepStatus enum (the
 * DB-canonical 10-value source), NOT a hand-maintained duplicate. This USED TO be a
 * hand-typed 7-value union (missing skipped/waiting_for_children/partial_success),
 * one leg of the 3-way status-vocabulary drift (dtm-video-v2 capability-spec.md
 * §1.5/§2d/§3.4; setpoint-evals/SE-27-dag-overlay-status-parity, backend half).
 *
 * Widening this to 10 values is a DELIBERATE handoff signal: workflow-dag.tsx's
 * `STATUS_CLASS: Record<StepStatus, string>` now requires all 10 keys — a missing
 * mapping is a compile error, not a silently-unstyled DAG node ("derive STATUS_CLASS
 * keys from the shared status type so a missing mapping is a compile error",
 * capability-spec.md §3.4). Adding the 3 missing STATUS_CLASS entries + classDefs +
 * legend items is dtm-video-v2 Lane B's work, not done in this change.
 */
export type StepStatus = `${CoreStepStatus}`;

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial_success';

export interface StepState {
  step: string;
  description: string;
  status: StepStatus;
  stepNumber: number;
  error?: string;
  duration?: number;
  attempt?: number;
  /** Number of fan-out children (discovery/parent steps only). See SE-28-step-snapshot-childcount. */
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

export interface JobState {
  id: string;
  workflow: string;
  variant: string;
  status: JobStatus;
  steps: StepState[];
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

export interface EventLogEntry {
  timestamp: string;
  type: string;
  jobId: string;
  detail: string;
  correlationId?: string;
}

interface BaseEvent {
  correlationId?: string;
  timestamp: string;
}

export type DtmEvent =
  | (BaseEvent & { type: 'job_created'; jobId: string; workflow: string; variant: string; steps: StepState[] })
  | (BaseEvent & { type: 'job_completed'; jobId: string; status: JobStatus; results?: JobResults })
  | (BaseEvent & { type: 'step_started'; jobId: string; step: string })
  | (BaseEvent & { type: 'step_completed'; jobId: string; step: string; duration: number })
  | (BaseEvent & { type: 'step_failed'; jobId: string; step: string; error: string })
  | (BaseEvent & { type: 'step_retrying'; jobId: string; step: string; attempt: number })
  | (BaseEvent & { type: 'step_skipped'; jobId: string; step: string; reason: string })
  | (BaseEvent & { type: 'step_ack_waiting'; jobId: string; step: string })
  | (BaseEvent & { type: 'step_ack_received'; jobId: string; step: string })
  | (BaseEvent & { type: 'sqs_status'; queues: SqsQueueStatus[] })
  | (BaseEvent & { type: 'snapshot'; jobs: JobState[] });
