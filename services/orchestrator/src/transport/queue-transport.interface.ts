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
 * `redelivery` — who re-dispatches a task whose worker died mid-flight?
 *   'bus'          — the transport itself redelivers (SQS visibility-timeout
 *                    redrive, Cloud Tasks retryConfig). The orchestrator-driven
 *                    redelivery engine MUST stay off.
 *   'orchestrator' — the transport offers at-most-once dispatch; the
 *                    redelivery engine (RedeliveryEngineTask) owns re-dispatch
 *                    from the dtm_steps.lease_expires_at delegation leases.
 *
 * `attemptCounter` — where does the per-attempt count come from?
 *   'native'    — the bus surfaces a delivery count the worker can read
 *                 (SQS ApproximateReceiveCount → retryMetadata.attemptNumber).
 *   'synthetic' — no usable native count reaches the orchestrator; the
 *                 bus-neutral dtm_steps.attempt_count column (incremented on
 *                 every dispatch) is the source of truth. Cloud Tasks DOES set
 *                 an X-CloudTasks-TaskExecutionCount header, but nothing in
 *                 this repo's worker path reads it, so the honest declaration
 *                 is 'synthetic'.
 *
 * `dlq` — where do exhausted tasks go?
 *   'native' — the bus routes them (SQS redrive policy → DLQ).
 *   'table'  — no native DLQ; the redelivery engine writes dtm_dead_letters
 *              rows on attempt exhaustion. Cloud Tasks has no dead-letter
 *              queue concept (an exhausted task is simply dropped), so it
 *              declares 'table'.
 */
export interface TaskTransportCapabilities {
  stats: 'native' | 'none';
  redelivery: 'bus' | 'orchestrator';
  attemptCounter: 'native' | 'synthetic';
  dlq: 'native' | 'table';
}

/**
 * Is the orchestrator-driven redelivery engine active for this deployment?
 * True only when the active transport declares `redelivery: 'orchestrator'`
 * or the REDELIVERY_ENGINE_FORCE_ENABLED escape hatch (setpoint evals, tests)
 * forces it on. Under the default SQS profile this is false and the engine
 * is a complete no-op.
 */
export function isRedeliveryEngineActive(
  capabilities: TaskTransportCapabilities,
  forceEnabled: boolean,
): boolean {
  return capabilities.redelivery === 'orchestrator' || forceEnabled;
}

/**
 * Pluggable queue transport interface.
 * Implementations: SqsTransport (LocalStack/AWS), CloudTasksTransport (GCP),
 * ZmqTransport (ZeroMQ ROUTER + zmq-worker-host DEALER fleet).
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
