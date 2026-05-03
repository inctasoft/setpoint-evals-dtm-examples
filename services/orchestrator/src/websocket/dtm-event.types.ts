/**
 * DTM WebSocket Event Types
 *
 * These events are broadcast to connected dashboard clients
 * for real-time operations monitoring.
 */

export type StepStatus =
  | 'pending'
  | 'delegated'
  | 'in_progress'
  | 'in_progress_retrying'
  | 'waiting_for_ack'
  | 'completed'
  | 'failed';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'partial_success';

export interface StepSnapshot {
  step: string;
  description: string;
  status: StepStatus;
  stepNumber: number;
  error?: string;
  duration?: number;
  attempt?: number;
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
  | (BaseEvent & { type: 'step_ack_waiting'; jobId: string; step: string })
  | (BaseEvent & { type: 'step_ack_received'; jobId: string; step: string })
  | (BaseEvent & { type: 'sqs_status'; queues: SqsQueueStatus[] })
  | (BaseEvent & { type: 'snapshot'; jobs: JobSnapshot[] });
