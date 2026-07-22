import { LambdaStepPayload } from '../aws/sqs.service';

export interface TaskSendResult {
  taskHandle: string;
  success: boolean;
  error?: string;
}

/**
 * A single row in the task-bus status panel (websocket `sqs_status` feed).
 * Bus-agnostic: SQS fills these from queue attributes; a stats-less transport
 * (e.g. Cloud Tasks) declares `stats: 'none'` and returns an empty list rather
 * than fabricating zeros.
 */
export interface QueueStatusRow {
  name: string;
  available: number;
  inFlight: number;
  dlq: number;
}

/**
 * Declared, honest capability contract for a task transport. Consumers branch on
 * these instead of assuming SQS-shaped behavior.
 *
 * `stats` — can the transport report live per-queue depth?
 *   'native' — yes (SQS GetQueueAttributes).
 *   'none'   — no first-class API (Cloud Tasks); the panel shows nothing rather
 *              than fake zeros, and the poller does no work.
 *
 * Phase 0 introduces only `stats` (the capability the current honesty fix needs).
 * The redelivery / attempt-counter / dlq axes from the bus-agnosticism plan land
 * with the redelivery engine in a later phase — declaring them now, with nothing
 * reading them, would be the exact interface dishonesty this phase removes.
 */
export interface TaskTransportCapabilities {
  stats: 'native' | 'none';
}

/**
 * Pluggable queue transport interface.
 * Implementations: SqsTransport (LocalStack/AWS), CloudTasksTransport (GCP).
 */
export abstract class QueueTransport {
  /** Declared capabilities — consumers branch on these, never on the concrete class. */
  abstract readonly capabilities: TaskTransportCapabilities;

  abstract sendTask(queueName: string, payload: LambdaStepPayload): Promise<TaskSendResult>;

  /**
   * Capability-aware status feed for the task-bus monitor panel. Transports with
   * `capabilities.stats === 'none'` return an empty list (callers skip them).
   */
  abstract getQueueStatuses(): Promise<QueueStatusRow[]>;

  abstract getWorkerEndpointUrl(queueName: string): string;

  abstract healthCheck(): { healthy: boolean; message: string };
}
