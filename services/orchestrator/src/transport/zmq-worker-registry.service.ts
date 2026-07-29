import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Public snapshot of one registered zmq worker (returned by listWorkers and
 * served by GET /api/v1/workers — the monitor consumes it in Phase 4).
 */
export interface ZmqWorkerRecord {
  workerId: string;
  queues: string[];
  state: 'alive' | 'dead';
  registeredAt: Date;
  lastHeartbeatAt: Date;
}

interface InternalWorkerRecord extends ZmqWorkerRecord {
  /** ROUTER-side socket identity the worker's DEALER presented at HELLO. */
  identity: string;
}

/** Death notification payload — the public snapshot plus the socket identity. */
export interface ZmqWorkerDeath extends ZmqWorkerRecord {
  identity: string;
}

/**
 * Zmq Worker Registry (orchestrator side of the zmq task transport).
 *
 * Tracks the DEALER worker fleet: HELLO registers workerId → {queues, socket
 * identity}, heartbeats refresh liveness, and a sweeper marks a worker dead
 * after a configurable silence. Routing (pickWorkerIdentity) fair-queues
 * round-robin across a queue's LIVE replicas only.
 *
 * Death is NOT a task-loss event on its own: tasks already handed to a dead
 * worker are re-dispatched by the redelivery engine from the dtm_steps
 * delegation lease (Postgres is the durability anchor). The registry only
 * guarantees no NEW dispatch is routed to a dead worker.
 *
 * Configuration:
 * - ZMQ_WORKER_SILENCE_MS: silence after which a worker is dead (default: 15000)
 * - ZMQ_WORKER_SWEEP_INTERVAL_MS: sweeper cadence (default: 5000)
 */
@Injectable()
export class ZmqWorkerRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZmqWorkerRegistryService.name);
  private readonly workers = new Map<string, InternalWorkerRecord>();
  private readonly roundRobinCounters = new Map<string, number>();
  private readonly deathListeners: Array<(worker: ZmqWorkerDeath) => void> = [];
  private readonly silenceMs: number;
  private readonly sweepIntervalMs: number;
  private sweepTimer?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.silenceMs = parseInt(this.configService.get<string>('ZMQ_WORKER_SILENCE_MS', '15000'), 10);
    this.sweepIntervalMs = parseInt(
      this.configService.get<string>('ZMQ_WORKER_SWEEP_INTERVAL_MS', '5000'),
      10,
    );
  }

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // Never keep the event loop (or a jest run) alive for the sweeper alone.
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /**
   * Register (or revive) a worker from its HELLO frame. Re-registration
   * replaces queues AND socket identity — a worker that restarted on a new
   * connection must not retain stale routing state.
   */
  register(workerId: string, queues: string[], identity: string, now = Date.now()): void {
    const existing = this.workers.get(workerId);
    const revived = existing?.state === 'dead';

    this.workers.set(workerId, {
      workerId,
      queues: [...queues],
      identity,
      state: 'alive',
      registeredAt: existing && !revived ? existing.registeredAt : new Date(now),
      lastHeartbeatAt: new Date(now),
    });

    if (!existing) {
      this.logger.log(`Worker registered: ${workerId} serving [${queues.join(', ')}]`);
    } else if (revived) {
      this.logger.log(
        `Worker re-registered after death: ${workerId} serving [${queues.join(', ')}]`,
      );
    }
  }

  /**
   * Refresh liveness from a heartbeat frame. A heartbeat IS proof of life:
   * from a DEAD (known) worker it REVIVES the worker — discarding it and
   * demanding a full re-HELLO strands any worker whose heartbeat interval
   * exceeds the silence window (first heartbeat lands after the first sweep,
   * the worker flaps dead and never recovers). Heartbeats from UNKNOWN
   * workers are still ignored — their socket identity/queues are unknown, so
   * only a HELLO can register them.
   *
   * Returns the outcome so callers (the transport) can flush buffered tasks
   * on revival exactly as they do on HELLO.
   */
  heartbeat(workerId: string, now = Date.now()): 'refreshed' | 'revived' | 'ignored' {
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.logger.warn(`Heartbeat from unregistered worker '${workerId}' ignored (HELLO required)`);
      return 'ignored';
    }
    worker.lastHeartbeatAt = new Date(now);
    if (worker.state === 'dead') {
      worker.state = 'alive';
      this.logger.log(
        `Worker revived by heartbeat: ${workerId} serving [${worker.queues.join(', ')}]`,
      );
      return 'revived';
    }
    return 'refreshed';
  }

  /**
   * Mark every alive worker whose last heartbeat is older than the silence
   * window as dead. Returns the workers transitioned by THIS sweep; death
   * listeners fire once per transition.
   */
  sweep(now = Date.now()): ZmqWorkerRecord[] {
    const newlyDead: ZmqWorkerRecord[] = [];

    for (const worker of this.workers.values()) {
      if (worker.state !== 'alive') continue;
      if (now - worker.lastHeartbeatAt.getTime() <= this.silenceMs) continue;

      worker.state = 'dead';
      this.logger.warn(
        `Worker lost: ${worker.workerId} (silent for ${now - worker.lastHeartbeatAt.getTime()}ms > ${this.silenceMs}ms) — unrouted; in-flight tasks fall to the redelivery engine on lease expiry`,
      );
      const snapshot: ZmqWorkerDeath = { ...this.toSnapshot(worker), identity: worker.identity };
      newlyDead.push(snapshot);
      for (const listener of this.deathListeners) listener(snapshot);
    }

    return newlyDead;
  }

  /**
   * Pick the next live replica serving a queue (round-robin fair-queue).
   * Returns the ROUTER-addressable socket identity, or null when no live
   * worker serves the queue (callers buffer, never silently drop).
   */
  pickWorkerIdentity(queueName: string): string | null {
    const candidates = [...this.workers.values()]
      .filter((w) => w.state === 'alive' && w.queues.includes(queueName))
      .sort((a, b) => a.workerId.localeCompare(b.workerId));

    if (candidates.length === 0) return null;

    const next = this.roundRobinCounters.get(queueName) ?? 0;
    this.roundRobinCounters.set(queueName, next + 1);
    return candidates[next % candidates.length].identity;
  }

  getWorker(workerId: string): ZmqWorkerRecord | undefined {
    const worker = this.workers.get(workerId);
    return worker ? this.toSnapshot(worker) : undefined;
  }

  /** Fleet snapshot for GET /api/v1/workers (copies — safe to mutate). */
  listWorkers(): ZmqWorkerRecord[] {
    return [...this.workers.values()].map((w) => this.toSnapshot(w));
  }

  /** Register a callback fired once per alive → dead transition. */
  onWorkerDead(listener: (worker: ZmqWorkerDeath) => void): void {
    this.deathListeners.push(listener);
  }

  private toSnapshot(worker: InternalWorkerRecord): ZmqWorkerRecord {
    const { identity: _identity, ...snapshot } = worker;
    return { ...snapshot, queues: [...worker.queues] };
  }
}
