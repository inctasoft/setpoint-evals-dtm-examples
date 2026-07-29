import { ConfigService } from '@nestjs/config';
import * as zmq from 'zeromq';
import {
  decodeZmqEnvelope,
  encodeZmqEnvelope,
  buildZmqReceivedEnvelope,
  buildZmqHelloEnvelope,
  buildZmqHeartbeatEnvelope,
} from '@dtm/core';
import { ZmqTransport } from './zmq-transport.service';
import { ZmqWorkerRegistryService } from './zmq-worker-registry.service';
import { isRedeliveryEngineActive } from './queue-transport.interface';
import { LambdaStepPayload } from '../aws/sqs.service';

/**
 * Phase 2 — ZmqTransport (RED-first).
 *
 * The zmq tasks transport: a ROUTER socket the orchestrator BINDS, worker
 * hosts CONNECT to as DEALERs. Specs run against a REAL in-process zeromq
 * pair (no mocks of the wire): the test drives a fake DEALER worker peer and
 * asserts routing by queue, no-worker buffering + flush-on-HELLO, the
 * receipt-ack → TaskSendResult contract, the injected synthetic attempt
 * counter, and the capability pins that activate the Phase 1 redelivery
 * engine.
 */

const QUEUE = 'order-validate-customer';

function makePayload(stepId = 'step-1'): LambdaStepPayload {
  return {
    jobId: 'job-1',
    stepId,
    stepValue: 'ValidateCustomer',
    jobType: 'quick-order',
    input: { customerId: 1 },
    callbackUrl: 'http://orchestrator:3000/api/v1/callback/step-progress',
  } as unknown as LambdaStepPayload;
}

/** Read the next [topic, json] frame pair a fake DEALER worker receives. */
async function nextFrame(
  iter: AsyncIterableIterator<Buffer[]>,
): Promise<{ topic: string; json: string }> {
  const { value } = await iter.next();
  return { topic: value[0].toString(), json: value[1].toString() };
}

describe('Phase 2 — ZmqTransport (ROUTER side, real zeromq pair)', () => {
  let transport: ZmqTransport;
  let registry: ZmqWorkerRegistryService;
  let endpoint: string;
  let stepRepository: { findById: jest.Mock };
  const dealers: zmq.Dealer[] = [];

  function makeDealer(workerId: string): {
    dealer: zmq.Dealer;
    frames: AsyncIterableIterator<Buffer[]>;
  } {
    const dealer = new zmq.Dealer({ routingId: workerId });
    dealer.connect(endpoint);
    dealers.push(dealer);
    return { dealer, frames: dealer[Symbol.asyncIterator]() };
  }

  async function sendHello(dealer: zmq.Dealer, workerId: string, queues: string[]): Promise<void> {
    await dealer.send(encodeZmqEnvelope(buildZmqHelloEnvelope({ workerId, queues })));
    // Give the router's receive loop a tick to process the registration.
    await new Promise((r) => setTimeout(r, 100));
  }

  beforeEach(async () => {
    const config = {
      get: (key: string, fallback: string) => {
        if (key === 'ZMQ_TASKS_ENDPOINT') return 'tcp://127.0.0.1:*';
        if (key === 'ZMQ_TASK_ACK_TIMEOUT_MS') return '250';
        return fallback;
      },
    } as unknown as ConfigService;
    registry = new ZmqWorkerRegistryService(config);
    stepRepository = { findById: jest.fn(async () => ({ attemptCount: 1 })) };
    transport = new ZmqTransport(config, registry, stepRepository as never);
    await transport.onModuleInit();
    endpoint = transport.boundEndpoint;
  });

  afterEach(async () => {
    for (const dealer of dealers.splice(0)) dealer.close();
    await transport.onModuleDestroy();
  });

  it('SE-ZMQ-caps: declares orchestrator redelivery + synthetic counter + table dlq, engine gate ON', () => {
    expect(transport.capabilities).toEqual({
      stats: 'native',
      redelivery: 'orchestrator',
      attemptCounter: 'synthetic',
      dlq: 'table',
    });
    // The Phase 1 engine gate flips ON for this transport without the escape hatch.
    expect(isRedeliveryEngineActive(transport.capabilities, false)).toBe(true);
  });

  it('SE-ZMQ-route: sendTask routes by queue, injects the synthetic attempt number, ack → TaskSendResult', async () => {
    const { dealer, frames } = makeDealer('w-1');
    await sendHello(dealer, 'w-1', [QUEUE]);
    expect(registry.pickWorkerIdentity(QUEUE)).toBe('w-1');

    const pending = transport.sendTask(QUEUE, makePayload());
    const frame = await nextFrame(frames);
    const envelope = decodeZmqEnvelope(frame.topic, frame.json);

    expect(envelope.kind).toBe('task');
    if (envelope.kind !== 'task') throw new Error('unreachable');
    expect(envelope.payload.queueName).toBe(QUEUE);
    // attemptCount(1) + 1 — the synthetic counter, not a bus receive count.
    expect(envelope.payload.attemptNumber).toBe(2);
    expect(envelope.payload.taskHandle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(envelope.payload.message).toMatchObject({ jobId: 'job-1', stepId: 'step-1' });

    // Receipt-ack closes the honest TaskSendResult contract.
    await dealer.send(encodeZmqEnvelope(buildZmqReceivedEnvelope(envelope.payload.taskHandle)));

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.taskHandle).toBe(envelope.payload.taskHandle);
  });

  it('SE-ZMQ-buffer: a task for a queue with no worker is buffered, not dropped — flushed on HELLO', async () => {
    const result = await transport.sendTask(QUEUE, makePayload('step-buffered'));

    // Accepted (Postgres lease is the durability anchor), but nothing was routed.
    expect(result.success).toBe(true);
    expect(registry.pickWorkerIdentity(QUEUE)).toBeNull();

    const statuses = await transport.getQueueStatuses();
    const row = statuses.find((s) => s.name === QUEUE);
    expect(row).toMatchObject({ available: 1, inFlight: 0 });

    // A worker appears → HELLO flushes the buffered task to it.
    const { dealer, frames } = makeDealer('w-late');
    await sendHello(dealer, 'w-late', [QUEUE]);

    const frame = await nextFrame(frames);
    const envelope = decodeZmqEnvelope(frame.topic, frame.json);
    expect(envelope.kind).toBe('task');
    if (envelope.kind !== 'task') throw new Error('unreachable');
    expect(envelope.payload.message).toMatchObject({ stepId: 'step-buffered' });
  });

  it('SE-ZMQ-fair-queue: two replicas of one queue each get a share of the dispatches', async () => {
    const w1 = makeDealer('w-1');
    const w2 = makeDealer('w-2');
    await sendHello(w1.dealer, 'w-1', [QUEUE]);
    await sendHello(w2.dealer, 'w-2', [QUEUE]);

    const first = await transport.sendTask(QUEUE, makePayload('step-a'));
    const second = await transport.sendTask(QUEUE, makePayload('step-b'));

    const seen = await Promise.all(
      [w1.frames, w2.frames].map(async (frames) => {
        const frame = await Promise.race([
          nextFrame(frames),
          new Promise<null>((r) => setTimeout(() => r(null), 750)),
        ]);
        return frame ? decodeZmqEnvelope(frame.topic, frame.json) : null;
      }),
    );

    const steps = seen
      .filter((e): e is NonNullable<typeof e> => e !== null && e.kind === 'task')
      .map((e) => (e.kind === 'task' ? (e.payload.message as { stepId: string }).stepId : null));
    expect(steps.sort()).toEqual(['step-a', 'step-b']);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it('SE-ZMQ-ack-timeout: a missing receipt-ack still resolves honestly (at-most-once, lease-anchored)', async () => {
    const { dealer, frames } = makeDealer('w-silent');
    await sendHello(dealer, 'w-silent', [QUEUE]);

    const result = await transport.sendTask(QUEUE, makePayload());
    // The task went on the wire (worker just never acks): sendTask must not hang
    // and must not fabricate a failure — the delegation lease owns re-dispatch.
    expect(result.success).toBe(true);
    expect(result.taskHandle).toBeTruthy();
    await nextFrame(frames); // consume to keep the dealer iterator honest
  });

  it('SE-ZMQ-revive-flush: tasks buffered while the only worker is dead flush when its heartbeat revives it', async () => {
    const { dealer, frames } = makeDealer('w-flap');
    await sendHello(dealer, 'w-flap', [QUEUE]);

    // Worker goes silent past the silence window → dead → unroutable. (The
    // SE-32 boot-flap: heartbeat interval > silence window strands workers;
    // a heartbeat is proof of life and must revive, not be discarded.)
    registry.sweep(Date.now() + 60000);
    expect(registry.pickWorkerIdentity(QUEUE)).toBeNull();

    const buffered = await transport.sendTask(QUEUE, makePayload('step-flush-on-revive'));
    expect(buffered.success).toBe(true); // buffered, never dropped

    // The worker's next heartbeat revives it → the buffered task flushes.
    await dealer.send(encodeZmqEnvelope(buildZmqHeartbeatEnvelope('w-flap')));

    const frame = await nextFrame(frames);
    const envelope = decodeZmqEnvelope(frame.topic, frame.json);
    expect(envelope.kind).toBe('task');
    if (envelope.kind !== 'task') throw new Error('unreachable');
    expect(envelope.payload.message).toMatchObject({ stepId: 'step-flush-on-revive' });
    expect(registry.getWorker('w-flap')?.state).toBe('alive');

    await dealer.send(encodeZmqEnvelope(buildZmqReceivedEnvelope(envelope.payload.taskHandle)));
  });

  it('SE-ZMQ-health: healthCheck reports the bound ROUTER endpoint', async () => {
    const health = transport.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain(endpoint);
  });
});
