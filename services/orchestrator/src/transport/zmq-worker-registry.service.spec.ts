import { ConfigService } from '@nestjs/config';
import { ZmqWorkerRegistryService } from './zmq-worker-registry.service';

/**
 * Phase 2 — zmq worker registry (RED-first).
 *
 * The registry is the orchestrator's view of the DEALER worker fleet:
 * HELLO registers (workerId → queues + socket identity), heartbeats refresh
 * liveness, and a sweeper marks a worker dead after a configurable silence
 * (ZMQ_WORKER_SILENCE_MS, default 15s). Routing (pickWorkerIdentity) must
 * fair-queue across a queue's live replicas and NEVER route to a dead worker.
 */
describe('Phase 2 — ZmqWorkerRegistryService', () => {
  const SILENCE_MS = 15000;

  function makeRegistry(silenceMs = SILENCE_MS): ZmqWorkerRegistryService {
    const config = {
      get: (key: string, fallback: string) =>
        key === 'ZMQ_WORKER_SILENCE_MS' ? String(silenceMs) : fallback,
    } as unknown as ConfigService;
    return new ZmqWorkerRegistryService(config);
  }

  it('SE-REG-hello: HELLO registers a worker as alive with its queues and routable identity', () => {
    const registry = makeRegistry();

    registry.register('w-1', ['order-validate-customer'], 'identity-w-1', 1000);

    const worker = registry.getWorker('w-1');
    expect(worker).toMatchObject({
      workerId: 'w-1',
      queues: ['order-validate-customer'],
      state: 'alive',
    });
    expect(registry.pickWorkerIdentity('order-validate-customer')).toBe('identity-w-1');
  });

  it('SE-REG-heartbeat: a heartbeat inside the silence window keeps the worker alive', () => {
    const registry = makeRegistry();
    registry.register('w-1', ['q1'], 'identity-w-1', 1000);

    registry.heartbeat('w-1', 1000 + SILENCE_MS - 1);
    const dead = registry.sweep(1000 + SILENCE_MS + 500);

    expect(dead).toEqual([]);
    expect(registry.getWorker('w-1')?.state).toBe('alive');
  });

  it('SE-REG-silence: a worker silent past the window is marked dead and unroutable', () => {
    const registry = makeRegistry();
    const deaths: string[] = [];
    registry.onWorkerDead((w) => deaths.push(w.workerId));
    registry.register('w-1', ['q1'], 'identity-w-1', 1000);

    const dead = registry.sweep(1000 + SILENCE_MS + 1);

    expect(dead.map((w) => w.workerId)).toEqual(['w-1']);
    expect(registry.getWorker('w-1')?.state).toBe('dead');
    expect(registry.pickWorkerIdentity('q1')).toBeNull();
    expect(deaths).toEqual(['w-1']);

    // A second sweep does not re-report / re-notify the same death.
    expect(registry.sweep(1000 + SILENCE_MS + 5000)).toEqual([]);
    expect(deaths).toEqual(['w-1']);
  });

  it('SE-REG-revive-heartbeat: a heartbeat from a DEAD worker revives it (proof of life) and restores routability', () => {
    const registry = makeRegistry();
    const deaths: string[] = [];
    registry.onWorkerDead((w) => deaths.push(w.workerId));
    registry.register('w-1', ['q1'], 'identity-w-1', 1000);
    registry.sweep(1000 + SILENCE_MS + 1);
    expect(registry.getWorker('w-1')?.state).toBe('dead');
    expect(registry.pickWorkerIdentity('q1')).toBeNull();

    // A heartbeat IS evidence of life: discarding it and demanding a full
    // re-HELLO strands every worker whose heartbeat interval exceeds the
    // silence window (the SE-32 boot-flap: first heartbeat at +5s, silence
    // 3s → dead before the first heartbeat ever lands, never recovers).
    const outcome = registry.heartbeat('w-1', 1000 + SILENCE_MS + 2000);

    expect(outcome).toBe('revived');
    expect(registry.getWorker('w-1')?.state).toBe('alive');
    expect(registry.pickWorkerIdentity('q1')).toBe('identity-w-1');
    // Death notification fired exactly once — revival is not a new death.
    expect(deaths).toEqual(['w-1']);
    // And a subsequent heartbeat is a plain refresh, not another revival.
    expect(registry.heartbeat('w-1', 1000 + SILENCE_MS + 3000)).toBe('refreshed');
  });

  it('SE-REG-rehello: a HELLO from a dead worker revives it with fresh queues and identity', () => {
    const registry = makeRegistry();
    registry.register('w-1', ['q1'], 'identity-old', 1000);
    registry.sweep(1000 + SILENCE_MS + 1);
    expect(registry.getWorker('w-1')?.state).toBe('dead');

    registry.register('w-1', ['q2'], 'identity-new', 20000);

    expect(registry.getWorker('w-1')?.state).toBe('alive');
    expect(registry.pickWorkerIdentity('q2')).toBe('identity-new');
    expect(registry.pickWorkerIdentity('q1')).toBeNull();
  });

  it('SE-REG-fair-queue: routing round-robins across a queue’s live replicas only', () => {
    const registry = makeRegistry();
    registry.register('w-1', ['q1'], 'identity-w-1', 1000);
    registry.register('w-2', ['q1'], 'identity-w-2', 1000);
    registry.register('w-3', ['q1'], 'identity-w-3', 0); // silent since t=0
    registry.sweep(SILENCE_MS + 1); // kills w-3 only (w-1/w-2 are 14001ms old)

    const picks = [1, 2, 3, 4].map(() => registry.pickWorkerIdentity('q1'));

    expect(picks).toEqual(['identity-w-1', 'identity-w-2', 'identity-w-1', 'identity-w-2']);
  });

  it('SE-REG-unknown-heartbeat: a heartbeat from an unregistered worker is ignored', () => {
    const registry = makeRegistry();

    registry.heartbeat('ghost', 1000);

    expect(registry.getWorker('ghost')).toBeUndefined();
    expect(registry.listWorkers()).toEqual([]);
  });

  it('SE-REG-snapshot: listWorkers exposes the fleet for the /workers endpoint', () => {
    const registry = makeRegistry();
    registry.register('w-1', ['q1'], 'identity-w-1', 1000);
    registry.register('w-2', ['q2', 'q3'], 'identity-w-2', 2000);

    const workers = registry.listWorkers();

    expect(workers).toHaveLength(2);
    expect(workers.map((w) => w.workerId).sort()).toEqual(['w-1', 'w-2']);
    // Snapshots are copies — mutating one must not corrupt the registry.
    workers[0].queues.push('tampered');
    expect(registry.getWorker('w-1')?.queues).toEqual(['q1']);
  });
});
