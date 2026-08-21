import {
  ZMQ_ENVELOPE_VERSION,
  ZMQ_CONTROL_TOPIC,
  buildZmqTaskEnvelope,
  buildZmqReceivedEnvelope,
  buildZmqHelloEnvelope,
  buildZmqHeartbeatEnvelope,
  buildZmqEventEnvelope,
  encodeZmqEnvelope,
  decodeZmqEnvelope,
  ZmqTaskEnvelope,
  ZmqHelloEnvelope,
  ZmqEventEnvelope,
} from '@dtm/core';

/**
 * Phase 2 — zmq tasks envelope schema (RED-first).
 *
 * The envelope is the SINGLE typed wire contract shared by the orchestrator's
 * ZmqTransport (ROUTER) and the zmq-worker-host (DEALER): a versioned
 * `[topic, json]` frame pair with kind task | received | hello | heartbeat.
 * These specs pin the round-trip, the topic discipline, and the fail-closed
 * decode behavior (malformed peer frames throw, never silently coerce).
 */
describe('Phase 2 — zmq tasks envelope schema', () => {
  it('SE-ENV-task: a task envelope round-trips through encode/decode under its queue topic', () => {
    const envelope = buildZmqTaskEnvelope({
      taskHandle: '4b7d1d3c-9f2a-4f0e-9a1b-1a2b3c4d5e6f',
      queueName: 'order-validate-customer',
      attemptNumber: 2,
      message: { jobId: 'job-1', stepId: 'step-1', stepValue: 'ValidateCustomer' },
    });

    const [topic, json] = encodeZmqEnvelope(envelope);
    expect(topic).toBe('task.order-validate-customer');

    const decoded = decodeZmqEnvelope(topic, json) as ZmqTaskEnvelope;
    expect(decoded.version).toBe(ZMQ_ENVELOPE_VERSION);
    expect(decoded.kind).toBe('task');
    expect(decoded.payload.taskHandle).toBe('4b7d1d3c-9f2a-4f0e-9a1b-1a2b3c4d5e6f');
    expect(decoded.payload.queueName).toBe('order-validate-customer');
    expect(decoded.payload.attemptNumber).toBe(2);
    expect(decoded.payload.message).toEqual({
      jobId: 'job-1',
      stepId: 'step-1',
      stepValue: 'ValidateCustomer',
    });
  });

  it('SE-ENV-control: received/hello/heartbeat envelopes travel under the shared control topic', () => {
    for (const envelope of [
      buildZmqReceivedEnvelope('handle-1'),
      buildZmqHelloEnvelope({ workerId: 'w-1', queues: ['q1', 'q2'] }),
      buildZmqHeartbeatEnvelope('w-1'),
    ]) {
      const [topic, json] = encodeZmqEnvelope(envelope);
      expect(topic).toBe(ZMQ_CONTROL_TOPIC);
      expect(decodeZmqEnvelope(topic, json)).toEqual(envelope);
    }
  });

  it('SE-ENV-hello-payload: a decoded hello carries the worker id and its full queue list', () => {
    const hello = buildZmqHelloEnvelope({
      workerId: 'order-processing-host-1',
      queues: ['order-validate-customer', 'order-submit-order'],
    });
    const [topic, json] = encodeZmqEnvelope(hello);

    const decoded = decodeZmqEnvelope(topic, json) as ZmqHelloEnvelope;
    expect(decoded.payload.workerId).toBe('order-processing-host-1');
    expect(decoded.payload.queues).toEqual(['order-validate-customer', 'order-submit-order']);
  });

  it('SE-ENV-version: a mismatched envelope version is rejected', () => {
    const [, json] = encodeZmqEnvelope(buildZmqHeartbeatEnvelope('w-1'));
    const tampered = json.replace(`"version":${ZMQ_ENVELOPE_VERSION}`, '"version":999');

    expect(() => decodeZmqEnvelope(ZMQ_CONTROL_TOPIC, tampered)).toThrow(/unsupported version/);
  });

  it('SE-ENV-malformed: non-JSON, wrong kind, and missing fields all throw', () => {
    expect(() => decodeZmqEnvelope(ZMQ_CONTROL_TOPIC, 'not json')).toThrow(/not valid JSON/);
    expect(() =>
      decodeZmqEnvelope(
        ZMQ_CONTROL_TOPIC,
        JSON.stringify({ version: 1, kind: 'nope', payload: {} }),
      ),
    ).toThrow(/unknown kind/);
    expect(() =>
      decodeZmqEnvelope(
        ZMQ_CONTROL_TOPIC,
        JSON.stringify({ version: 1, kind: 'heartbeat', payload: {} }),
      ),
    ).toThrow(/workerId/);
  });

  it('SE-ENV-topic-discipline: a task frame under the wrong topic is rejected', () => {
    const envelope = buildZmqTaskEnvelope({
      taskHandle: 'h-1',
      queueName: 'order-validate-customer',
      attemptNumber: 1,
      message: {},
    });
    const [, json] = encodeZmqEnvelope(envelope);

    // Control topic for a task frame, and a task topic naming another queue.
    expect(() => decodeZmqEnvelope(ZMQ_CONTROL_TOPIC, json)).toThrow(/topic/);
    expect(() => decodeZmqEnvelope('task.order-submit-order', json)).toThrow(/topic/);
  });

  it('SE-ENV-event: an event envelope round-trips under the EVENT TOPIC itself (SUB-side filtering needs no JSON peek)', () => {
    const envelope = buildZmqEventEnvelope({
      topic: 'order-processing.customer.completed',
      message: { jobId: 'j-1', stepId: 's-1', recordCount: 2 },
    });

    const [topic, json] = encodeZmqEnvelope(envelope);
    expect(topic).toBe('order-processing.customer.completed');

    const decoded = decodeZmqEnvelope(topic, json) as ZmqEventEnvelope;
    expect(decoded.version).toBe(ZMQ_ENVELOPE_VERSION);
    expect(decoded.kind).toBe('event');
    expect(decoded.payload.topic).toBe('order-processing.customer.completed');
    expect(decoded.payload.message).toEqual({ jobId: 'j-1', stepId: 's-1', recordCount: 2 });
  });

  it('SE-ENV-event-discipline: event frames reject topic/frame mismatch, missing topic, and non-object message', () => {
    const envelope = buildZmqEventEnvelope({
      topic: 'order-processing.customer.ack',
      message: { jobId: 'j-1' },
    });
    const [, json] = encodeZmqEnvelope(envelope);

    // Frame topic must equal the payload topic (and NOT the control topic).
    expect(() => decodeZmqEnvelope('order-processing.order.ack', json)).toThrow(/topic/);
    expect(() => decodeZmqEnvelope(ZMQ_CONTROL_TOPIC, json)).toThrow(/topic/);
    expect(() =>
      decodeZmqEnvelope(
        't',
        JSON.stringify({ version: 1, kind: 'event', payload: { topic: 't' } }),
      ),
    ).toThrow(/message/);
    expect(() =>
      decodeZmqEnvelope(
        't',
        JSON.stringify({ version: 1, kind: 'event', payload: { message: {} } }),
      ),
    ).toThrow(/topic/);
  });
});
