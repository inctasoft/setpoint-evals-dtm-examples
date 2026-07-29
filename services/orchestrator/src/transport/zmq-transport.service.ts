import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as zmq from 'zeromq';
import {
  ZmqTaskEnvelope,
  buildZmqTaskEnvelope,
  decodeZmqEnvelope,
  encodeZmqEnvelope,
} from '@dtm/core';
import { StepRepository } from '@dtm/database';
import { LambdaStepPayload } from '../aws/sqs.service';
import { detectRuntime, getOrchestratorCallbackUrl } from '../config/runtime.config';
import {
  QueueTransport,
  TaskSendResult,
  QueueStatusRow,
  TaskTransportCapabilities,
} from './queue-transport.interface';
import { ZmqWorkerRegistryService } from './zmq-worker-registry.service';

/** One dispatched task awaiting the worker's RECEIVED receipt-ack. */
interface PendingReceipt {
  queueName: string;
  identity: string;
  resolve: (acked: boolean) => void;
  timer: NodeJS.Timeout;
}

/**
 * ZeroMQ task transport (Phase 2 of the bus-agnosticism program).
 *
 * Topology: the orchestrator BINDS a ROUTER socket (ZMQ_TASKS_ENDPOINT);
 * zmq-worker-host containers CONNECT as DEALERs, one host per workflow
 * (compose-scaled for replicas). Every frame is the versioned
 * `[topic, json]` envelope from @dtm/core — no hand-built literals.
 *
 * Honest capability choices:
 * - stats: 'native'        — per-queue depth comes from state THIS transport
 *                            owns (no-worker buffer + receipt-ack in-flight),
 *                            not fabricated. The dlq column is always 0: dead
 *                            letters live in the dtm_dead_letters TABLE
 *                            (dlq: 'table'), there is no per-queue bus DLQ.
 * - redelivery: 'orchestrator' — at-most-once dispatch; the Phase 1 engine
 *                            re-dispatches from the dtm_steps delegation lease.
 * - attemptCounter: 'synthetic' — no native delivery count exists; sendTask
 *                            injects dtm_steps.attempt_count + 1 into the
 *                            envelope and the worker-host surfaces it as the
 *                            SQSEvent ApproximateReceiveCount.
 * - dlq: 'table'           — attempt exhaustion is dead-lettered by the
 *                            redelivery engine, not the bus.
 *
 * Durability contract (by design): when NO worker is registered for a queue,
 * sendTask BUFFERS the task in memory (per queue) and flushes on the next
 * HELLO — it is never silently dropped. A crashed orchestrator loses the
 * buffer; that is acceptable because Postgres is the durability anchor: the
 * step's delegation lease expires and the redelivery engine re-dispatches.
 *
 * Configuration:
 * - ZMQ_TASKS_ENDPOINT: ROUTER bind address (default: tcp://0.0.0.0:5557)
 * - ZMQ_TASK_ACK_TIMEOUT_MS: receipt-ack wait per dispatch (default: 2000)
 */
@Injectable()
export class ZmqTransport extends QueueTransport implements OnModuleInit, OnModuleDestroy {
  readonly capabilities: TaskTransportCapabilities = {
    stats: 'native',
    redelivery: 'orchestrator',
    attemptCounter: 'synthetic',
    dlq: 'table',
  };

  private readonly logger = new Logger(ZmqTransport.name);
  private readonly endpoint: string;
  private readonly ackTimeoutMs: number;
  private router?: zmq.Router;
  private receiveLoop?: Promise<void>;

  /** Queue → tasks accepted while no worker was registered (flush on HELLO). */
  private readonly buffers = new Map<string, ZmqTaskEnvelope[]>();
  /** taskHandle → receipt-ack waiter (also the in-flight depth accounting). */
  private readonly pendingReceipts = new Map<string, PendingReceipt>();
  /** Every queue ever dispatched to or buffered for (status panel rows). */
  private readonly seenQueues = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly registry: ZmqWorkerRegistryService,
    private readonly stepRepository: StepRepository,
  ) {
    super();
    this.endpoint = this.configService.get<string>('ZMQ_TASKS_ENDPOINT', 'tcp://0.0.0.0:5557');
    this.ackTimeoutMs = parseInt(
      this.configService.get<string>('ZMQ_TASK_ACK_TIMEOUT_MS', '2000'),
      10,
    );
  }

  /** Actual bound address (after wildcard-port resolution) — used by specs. */
  get boundEndpoint(): string {
    return this.router?.lastEndpoint ?? this.endpoint;
  }

  async onModuleInit(): Promise<void> {
    this.router = new zmq.Router();
    await this.router.bind(this.endpoint);
    this.receiveLoop = this.runReceiveLoop();

    // A dead worker's outstanding receipt-acks can never arrive — release the
    // sendTask waiters honestly instead of letting them hit the ack timeout.
    this.registry.onWorkerDead((worker) => this.releaseReceiptsForIdentity(worker.identity));

    this.logger.log(
      `ZmqTransport ROUTER bound at ${this.boundEndpoint} (redelivery: orchestrator, attemptCounter: synthetic, dlq: table)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const pending of this.pendingReceipts.values()) clearTimeout(pending.timer);
    this.pendingReceipts.clear();
    this.router?.close();
    await this.receiveLoop?.catch(() => undefined);
  }

  async sendTask(queueName: string, payload: LambdaStepPayload): Promise<TaskSendResult> {
    this.seenQueues.add(queueName);

    const taskHandle = randomUUID();
    const attemptNumber = await this.nextAttemptNumber(payload.stepId);
    const envelope = buildZmqTaskEnvelope({
      taskHandle,
      queueName,
      attemptNumber,
      message: payload as unknown as Record<string, unknown>,
    });

    const identity = this.registry.pickWorkerIdentity(queueName);
    if (!identity) {
      // No worker for this queue — buffer, never drop. The step's delegation
      // lease (Postgres) is the durability anchor: if this process dies before
      // a worker arrives, the redelivery engine re-dispatches on lease expiry.
      const queue = this.buffers.get(queueName) ?? [];
      queue.push(envelope);
      this.buffers.set(queueName, queue);
      this.logger.warn(
        `No zmq worker registered for queue '${queueName}' — buffered task ${taskHandle} (step ${payload.stepId}); flushes on worker HELLO`,
      );
      return { taskHandle, success: true };
    }

    this.dispatchToWorker(identity, envelope);
    const acked = await this.awaitReceipt(envelope, identity);

    if (!acked) {
      // At-most-once honesty: the frame left the socket but the worker never
      // confirmed receipt. Not a fabricated failure — the delegation lease
      // owns re-dispatch if the task was in fact lost.
      this.logger.warn(
        `No receipt-ack within ${this.ackTimeoutMs}ms for task ${taskHandle} (step ${payload.stepId}) — lease expiry covers a lost dispatch`,
      );
    }

    return { taskHandle, success: true };
  }

  /**
   * Capability-honest status feed (stats: 'native'): depth from state this
   * transport owns — `available` = buffered awaiting a worker, `inFlight` =
   * handed to a worker but not yet receipt-acked. `dlq` is always 0 because
   * dead letters are dtm_dead_letters table rows (dlq: 'table'), not a
   * per-queue bus structure.
   */
  async getQueueStatuses(): Promise<QueueStatusRow[]> {
    const queueNames = new Set<string>(this.seenQueues);
    for (const worker of this.registry.listWorkers()) {
      for (const q of worker.queues) queueNames.add(q);
    }

    return [...queueNames].sort().map((name) => ({
      name,
      available: this.buffers.get(name)?.length ?? 0,
      inFlight: [...this.pendingReceipts.values()].filter((p) => p.queueName === name).length,
      dlq: 0,
    }));
  }

  /**
   * Workers callback over HTTP exactly as on the SQS path. Mirrors
   * SqsConfig.getCallbackUrl's mode split: in Docker the env override is
   * ignored (it is localhost-shaped for host-side dev) and workers reach the
   * orchestrator by service name.
   */
  getWorkerEndpointUrl(_queueName: string): string {
    const runtime = detectRuntime();
    const envOverride = process.env.ORCHESTRATOR_CALLBACK_URL;
    const port = parseInt(process.env.PORT || process.env.ORCHESTRATOR_PORT || '3000', 10);
    return getOrchestratorCallbackUrl(runtime === 'docker' ? undefined : envOverride, port);
  }

  healthCheck(): { healthy: boolean; message: string } {
    const aliveWorkers = this.registry.listWorkers().filter((w) => w.state === 'alive').length;
    return {
      healthy: !!this.router,
      message: `ZeroMQ tasks ROUTER bound at ${this.boundEndpoint} (${aliveWorkers} live worker(s))`,
    };
  }

  /** Synthetic attempt counter: dtm_steps.attempt_count at dispatch + 1. */
  private async nextAttemptNumber(stepId: string): Promise<number> {
    const step = await this.stepRepository.findById(stepId);
    return (step?.attemptCount ?? 0) + 1;
  }

  private dispatchToWorker(identity: string, envelope: ZmqTaskEnvelope): void {
    if (!this.router) throw new Error('ZmqTransport ROUTER is not bound');
    void this.router.send([identity, ...encodeZmqEnvelope(envelope)]);
  }

  /** Park a waiter on the worker's RECEIVED frame; resolves false on timeout. */
  private awaitReceipt(envelope: ZmqTaskEnvelope, identity: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReceipts.delete(envelope.payload.taskHandle);
        resolve(false);
      }, this.ackTimeoutMs);
      timer.unref();
      this.pendingReceipts.set(envelope.payload.taskHandle, {
        queueName: envelope.payload.queueName,
        identity,
        resolve,
        timer,
      });
    });
  }

  private releaseReceiptsForIdentity(identity: string): void {
    for (const [taskHandle, pending] of this.pendingReceipts) {
      if (pending.identity !== identity) continue;
      clearTimeout(pending.timer);
      this.pendingReceipts.delete(taskHandle);
      pending.resolve(false);
    }
  }

  /** Flush buffered tasks for queues a freshly-registered worker serves. */
  private flushBuffers(queues: string[]): void {
    for (const queueName of queues) {
      const buffered = this.buffers.get(queueName);
      if (!buffered?.length) continue;

      let flushed = 0;
      let envelope: ZmqTaskEnvelope | undefined;
      while ((envelope = buffered.shift())) {
        // Per-iteration capture: the receipt-ack callback below is async and
        // must not close over the loop-mutated `envelope` (TS18048, and it
        // would observe later iterations' tasks).
        const task = envelope;
        const identity = this.registry.pickWorkerIdentity(queueName);
        if (!identity) {
          buffered.unshift(task);
          break;
        }
        this.dispatchToWorker(identity, task);
        void this.awaitReceipt(task, identity).then((acked) => {
          if (!acked) {
            this.logger.warn(
              `No receipt-ack for flushed task ${task.payload.taskHandle} — lease expiry covers a lost dispatch`,
            );
          }
        });
        flushed++;
      }
      if (buffered.length === 0) this.buffers.delete(queueName);
      if (flushed > 0) {
        this.logger.log(`Flushed ${flushed} buffered task(s) for queue '${queueName}'`);
      }
    }
  }

  private async runReceiveLoop(): Promise<void> {
    if (!this.router) return;
    try {
      for await (const frames of this.router) {
        const [identity, topic, json] = frames;
        try {
          this.handleWorkerFrame(identity.toString(), topic.toString(), json.toString());
        } catch (error) {
          this.logger.error(
            `Malformed worker frame (topic '${topic.toString()}'): ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } catch (error) {
      // Socket closed during shutdown — an expected end of the loop.
      this.logger.debug(
        `ROUTER receive loop ended: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private handleWorkerFrame(identity: string, topic: string, json: string): void {
    const envelope = decodeZmqEnvelope(topic, json);

    switch (envelope.kind) {
      case 'hello':
        this.registry.register(envelope.payload.workerId, envelope.payload.queues, identity);
        this.flushBuffers(envelope.payload.queues);
        break;
      case 'heartbeat':
        this.registry.heartbeat(envelope.payload.workerId);
        break;
      case 'received': {
        const pending = this.pendingReceipts.get(envelope.payload.taskHandle);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingReceipts.delete(envelope.payload.taskHandle);
          pending.resolve(true);
        }
        break;
      }
      default:
        this.logger.warn(
          `Unexpected frame kind '${(envelope as { kind: string }).kind}' from worker`,
        );
    }
  }
}
