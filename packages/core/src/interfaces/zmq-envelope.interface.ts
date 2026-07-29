/**
 * ZeroMQ Tasks Envelope — versioned wire contract for the `zmq` task transport
 * (Phase 2 of the bus-agnosticism program).
 *
 * Both peers (the orchestrator's ROUTER socket and the worker-host's DEALER
 * socket) speak ONE frame pair: `[topic, json]` where `json` is a typed,
 * versioned envelope from this file. Neither side hand-builds literals —
 * envelopes are created with the `buildZmq*Envelope` factories and put on /
 * taken off the wire only through `encodeZmqEnvelope` / `decodeZmqEnvelope`.
 *
 * Frame kinds:
 *   task      orchestrator → worker   a step dispatch (topic `task.<queueName>`)
 *   received  worker → orchestrator   lightweight receipt-ack for one taskHandle
 *   hello     worker → orchestrator   registration (workerId + queues served)
 *   heartbeat worker → orchestrator   liveness refresh (silence ⇒ dead)
 *
 * Durability note: this transport is at-most-once. A task dispatched to a
 * worker that dies mid-flight is re-dispatched by the orchestrator's
 * redelivery engine from the `dtm_steps` delegation lease — the database is
 * the durability anchor, not the socket.
 */

/** Current envelope schema version. Decoders reject anything else. */
export const ZMQ_ENVELOPE_VERSION = 1;

/** Topic prefix for task frames: `task.<queueName>`. */
export const ZMQ_TASK_TOPIC_PREFIX = "task.";

/** Topic shared by all worker → orchestrator control frames. */
export const ZMQ_CONTROL_TOPIC = "ctl";

export interface ZmqTaskPayload {
  /** Orchestrator-minted uuid for this dispatch (no bus message id exists). */
  taskHandle: string;
  /** Queue the task belongs to — also the DEALER's handler lookup key. */
  queueName: string;
  /** Synthetic attempt counter (dtm_steps.attempt_count at dispatch + 1). */
  attemptNumber: number;
  /** The step payload exactly as the SQS path would place in the message body. */
  message: Record<string, unknown>;
}

export interface ZmqReceivedPayload {
  taskHandle: string;
}

export interface ZmqHelloPayload {
  workerId: string;
  queues: string[];
}

export interface ZmqHeartbeatPayload {
  workerId: string;
}

interface ZmqEnvelopeBase<K extends string, P> {
  version: number;
  kind: K;
  payload: P;
}

export type ZmqTaskEnvelope = ZmqEnvelopeBase<"task", ZmqTaskPayload>;
export type ZmqReceivedEnvelope = ZmqEnvelopeBase<
  "received",
  ZmqReceivedPayload
>;
export type ZmqHelloEnvelope = ZmqEnvelopeBase<"hello", ZmqHelloPayload>;
export type ZmqHeartbeatEnvelope = ZmqEnvelopeBase<
  "heartbeat",
  ZmqHeartbeatPayload
>;

export type ZmqEnvelope =
  | ZmqTaskEnvelope
  | ZmqReceivedEnvelope
  | ZmqHelloEnvelope
  | ZmqHeartbeatEnvelope;

/** Topic a given envelope must travel under (checked on decode). */
export function zmqTopicForEnvelope(envelope: ZmqEnvelope): string {
  return envelope.kind === "task"
    ? `${ZMQ_TASK_TOPIC_PREFIX}${envelope.payload.queueName}`
    : ZMQ_CONTROL_TOPIC;
}

export function buildZmqTaskEnvelope(payload: ZmqTaskPayload): ZmqTaskEnvelope {
  return { version: ZMQ_ENVELOPE_VERSION, kind: "task", payload };
}

export function buildZmqReceivedEnvelope(
  taskHandle: string,
): ZmqReceivedEnvelope {
  return {
    version: ZMQ_ENVELOPE_VERSION,
    kind: "received",
    payload: { taskHandle },
  };
}

export function buildZmqHelloEnvelope(
  payload: ZmqHelloPayload,
): ZmqHelloEnvelope {
  return { version: ZMQ_ENVELOPE_VERSION, kind: "hello", payload };
}

export function buildZmqHeartbeatEnvelope(
  workerId: string,
): ZmqHeartbeatEnvelope {
  return {
    version: ZMQ_ENVELOPE_VERSION,
    kind: "heartbeat",
    payload: { workerId },
  };
}

/** Serialize an envelope to the `[topic, json]` frame pair. */
export function encodeZmqEnvelope(envelope: ZmqEnvelope): [string, string] {
  return [zmqTopicForEnvelope(envelope), JSON.stringify(envelope)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Invalid zmq envelope: '${field}' must be a non-empty string`,
    );
  }
}

/**
 * Parse and validate a `[topic, json]` frame pair back into a typed envelope.
 * Throws on any schema violation — callers treat a throw as a malformed peer
 * frame (log and drop), never as a task failure.
 */
export function decodeZmqEnvelope(topic: string, json: string): ZmqEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Invalid zmq envelope: payload is not valid JSON");
  }

  if (!isRecord(raw)) {
    throw new Error("Invalid zmq envelope: payload must be a JSON object");
  }
  if (raw.version !== ZMQ_ENVELOPE_VERSION) {
    throw new Error(
      `Invalid zmq envelope: unsupported version ${String(raw.version)} (expected ${ZMQ_ENVELOPE_VERSION})`,
    );
  }
  if (!isRecord(raw.payload)) {
    throw new Error("Invalid zmq envelope: missing payload object");
  }

  const payload = raw.payload;
  switch (raw.kind) {
    case "task": {
      requireString(payload.taskHandle, "taskHandle");
      requireString(payload.queueName, "queueName");
      if (
        typeof payload.attemptNumber !== "number" ||
        payload.attemptNumber < 1
      ) {
        throw new Error(
          "Invalid zmq envelope: 'attemptNumber' must be a positive number",
        );
      }
      if (!isRecord(payload.message)) {
        throw new Error("Invalid zmq envelope: 'message' must be an object");
      }
      if (topic !== `${ZMQ_TASK_TOPIC_PREFIX}${payload.queueName}`) {
        throw new Error(
          `Invalid zmq envelope: task topic '${topic}' does not match queue '${payload.queueName}'`,
        );
      }
      return raw as unknown as ZmqTaskEnvelope;
    }
    case "received":
      requireString(payload.taskHandle, "taskHandle");
      break;
    case "hello":
      requireString(payload.workerId, "workerId");
      if (
        !Array.isArray(payload.queues) ||
        payload.queues.some((q) => typeof q !== "string")
      ) {
        throw new Error(
          "Invalid zmq envelope: 'queues' must be an array of strings",
        );
      }
      break;
    case "heartbeat":
      requireString(payload.workerId, "workerId");
      break;
    default:
      throw new Error(`Invalid zmq envelope: unknown kind ${String(raw.kind)}`);
  }

  if (topic !== ZMQ_CONTROL_TOPIC) {
    throw new Error(
      `Invalid zmq envelope: control frame kind '${String(raw.kind)}' must travel under topic '${ZMQ_CONTROL_TOPIC}'`,
    );
  }
  return raw as unknown as ZmqEnvelope;
}
