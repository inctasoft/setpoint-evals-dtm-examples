import { ConfigService } from '@nestjs/config';
import * as zmq from 'zeromq';
import { decodeZmqEnvelope } from '@dtm/core';
import { ZmqEventBus } from './zmq-event-bus.service';

/**
 * Phase 3 — ZmqEventBus (RED-first).
 *
 * Topology: the orchestrator BINDS a PUB socket (events out) and a PULL
 * socket (acks in); subscribers (dev-ack-simulator) CONNECT with SUB/PUSH.
 * Specs run a REAL in-process zeromq pair: a fake SUB subscriber receives the
 * published event envelope, and a fake PUSH peer's ack is dispatched to the
 * subscribed handler by topic. Reliability is the republish scan's job, not
 * the socket's — publish() honestly returns true on acceptance.
 */

const EVENT_TOPIC = 'order-processing.customer.completed';
const ACK_TOPIC = 'order-processing.customer.ack';

async function nextFrame(
  iter: AsyncIterableIterator<Buffer[]>,
): Promise<{ topic: string; json: string }> {
  const { value } = await iter.next();
  return { topic: value[0].toString(), json: value[1].toString() };
}

describe('Phase 3 — ZmqEventBus (real zeromq pair)', () => {
  let bus: ZmqEventBus;
  let eventsEndpoint: string;
  let acksEndpoint: string;
  const peers: zmq.Socket[] = [];

  beforeEach(async () => {
    let port = 15600 + Math.floor(Math.random() * 800);
    const config = {
      get: (key: string, fallback: string) => {
        if (key === 'ZMQ_EVENTS_ENDPOINT') return `tcp://127.0.0.1:${port++}`;
        if (key === 'ZMQ_ACKS_ENDPOINT') return `tcp://127.0.0.1:${port++}`;
        return fallback;
      },
    } as unknown as ConfigService;
    bus = new ZmqEventBus(config);
    await bus.onModuleInit();
    eventsEndpoint = bus.boundEventsEndpoint;
    acksEndpoint = bus.boundAcksEndpoint;
  });

  afterEach(async () => {
    for (const peer of peers.splice(0)) peer.close();
    await bus.onModuleDestroy();
  });

  function makeSubscriber(topic: string): {
    sub: zmq.Subscriber;
    frames: AsyncIterableIterator<Buffer[]>;
  } {
    const sub = new zmq.Subscriber();
    sub.connect(eventsEndpoint);
    sub.subscribe(topic);
    peers.push(sub);
    return { sub, frames: sub[Symbol.asyncIterator]() };
  }

  /** PUB/SUB slow-joiner: a publish fired before the subscription propagates
   * is silently dropped (that is exactly why the republish scan exists).
   * Specs settle the subscription before asserting delivery. */
  const settleSubscription = () => new Promise((r) => setTimeout(r, 200));

  it('SE-ZBUS-publish: a published event reaches a SUB subscriber as a typed event envelope under the event topic', async () => {
    const { frames } = makeSubscriber(EVENT_TOPIC);
    await settleSubscription();
    const event = { jobId: 'j-1', stepId: 's-1', recordCount: 2 };

    const accepted = await bus.publish(EVENT_TOPIC, event, 'j-1');

    expect(accepted).toBe(true);
    const frame = await nextFrame(frames);
    expect(frame.topic).toBe(EVENT_TOPIC);
    const envelope = decodeZmqEnvelope(frame.topic, frame.json);
    expect(envelope.kind).toBe('event');
    if (envelope.kind !== 'event') throw new Error('unreachable');
    expect(envelope.payload.topic).toBe(EVENT_TOPIC);
    expect(envelope.payload.message).toEqual(event);
  });

  it('SE-ZBUS-filter: a subscriber to a different topic receives nothing (PUB/SUB topic filtering)', async () => {
    const { frames } = makeSubscriber('order-processing.order.completed');
    await settleSubscription();

    await bus.publish(EVENT_TOPIC, { jobId: 'j-1' });

    const frame = await Promise.race([
      nextFrame(frames),
      new Promise<null>((r) => setTimeout(() => r(null), 500)),
    ]);
    expect(frame).toBeNull();
  });

  it('SE-ZBUS-ack-return: a PUSH peer’s ack envelope is dispatched to the subscribed handler by topic', async () => {
    const handler = jest.fn(async () => undefined);
    await bus.subscribe(ACK_TOPIC, handler);
    await bus.start(); // no-op for zmq, but must be safe

    const push = new zmq.Push();
    push.connect(acksEndpoint);
    peers.push(push);
    const { buildZmqEventEnvelope, encodeZmqEnvelope } = jest.requireActual('@dtm/core');
    await push.send(
      encodeZmqEnvelope(
        buildZmqEventEnvelope({ topic: ACK_TOPIC, message: { jobId: 'j-1', stepId: 's-1' } }),
      ),
    );

    await new Promise((r) => setTimeout(r, 300));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(ACK_TOPIC, { jobId: 'j-1', stepId: 's-1' });
  });

  it('SE-ZBUS-unknown-topic: an ack for a topic with no handler is dropped with a log, never thrown', async () => {
    const push = new zmq.Push();
    push.connect(acksEndpoint);
    peers.push(push);
    const { buildZmqEventEnvelope, encodeZmqEnvelope } = jest.requireActual('@dtm/core');
    await push.send(
      encodeZmqEnvelope(buildZmqEventEnvelope({ topic: 'dtm.unknown.ack', message: { x: 1 } })),
    );

    // No handler, no throw — the receive loop stays alive for the next frame.
    await new Promise((r) => setTimeout(r, 300));
    expect(bus.isConnected()).toBe(true);
  });

  it('SE-ZBUS-health: healthCheck reports both bound endpoints', () => {
    const health = bus.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toContain(eventsEndpoint);
    expect(health.message).toContain(acksEndpoint);
  });
});
