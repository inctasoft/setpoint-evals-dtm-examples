/**
 * Phase 3 — dev-ack-simulator ZmqEventBusClient (RED-first).
 *
 * Real in-process zeromq pairs: a fake orchestrator PUB peer's event envelope
 * is delivered to SimulatorService.handleBusMessage, and the client's ack
 * publish arrives at a fake orchestrator PULL peer as a typed 'event'
 * envelope under the ack topic.
 */
import * as zmq from "zeromq";
import { ConfigService } from "@nestjs/config";
import {
  buildZmqEventEnvelope,
  decodeZmqEnvelope,
  encodeZmqEnvelope,
} from "@dtm/core";
import { ZmqEventBusClient } from "./zmq-event-bus.client";
import { SimulatorService } from "../simulator/simulator.service";

const LISTEN_TOPIC = "order-processing.customer.completed";
const ACK_TOPIC = "order-processing.customer.ack";

describe("Phase 3 — ZmqEventBusClient (simulator side, real zeromq pair)", () => {
  let client: ZmqEventBusClient;
  let eventsEndpoint: string;
  let acksEndpoint: string;
  let simulatorService: { handleBusMessage: jest.Mock };
  const peers: zmq.Socket[] = [];

  beforeEach(async () => {
    const base = 16600 + Math.floor(Math.random() * 800);
    eventsEndpoint = `tcp://127.0.0.1:${base}`;
    acksEndpoint = `tcp://127.0.0.1:${base + 1}`;
    const config = {
      get: (key: string, fallback: string) => {
        if (key === "ZMQ_EVENTS_ENDPOINT") return eventsEndpoint;
        if (key === "ZMQ_ACKS_ENDPOINT") return acksEndpoint;
        return fallback;
      },
    } as unknown as ConfigService;
    simulatorService = { handleBusMessage: jest.fn(async () => undefined) };
    client = new ZmqEventBusClient(
      config,
      simulatorService as unknown as SimulatorService,
      [
        {
          listenTopic: LISTEN_TOPIC,
          ackTopic: ACK_TOPIC,
          outputStep: "SubmitCustomer",
          cascadeName: "customer",
        },
      ],
    );
    await client.onModuleInit();
  });

  afterEach(async () => {
    for (const peer of peers.splice(0)) peer.close();
    await client.onModuleDestroy();
  });

  it("SE-ZSIM-consume: a PUB peer's event reaches SimulatorService.handleBusMessage by topic", async () => {
    // Fake orchestrator: PUB binds the endpoint the client SUB-connected to.
    const pub = new zmq.Publisher();
    await pub.bind(eventsEndpoint);
    peers.push(pub);
    const event = {
      jobId: "j-1",
      stepId: "s-1",
      requiresAcknowledgement: true,
    };
    // Slow-joiner settle before publishing.
    await new Promise((r) => setTimeout(r, 300));
    await pub.send(
      encodeZmqEnvelope(
        buildZmqEventEnvelope({ topic: LISTEN_TOPIC, message: event }),
      ),
    );

    await new Promise((r) => setTimeout(r, 400));
    expect(simulatorService.handleBusMessage).toHaveBeenCalledTimes(1);
    expect(simulatorService.handleBusMessage).toHaveBeenCalledWith(
      LISTEN_TOPIC,
      event,
    );
  });

  it("SE-ZSIM-publish: publish() delivers a typed event envelope to a PULL peer under the ack topic", async () => {
    const pull = new zmq.Pull();
    await pull.bind(acksEndpoint);
    peers.push(pull);
    const frames = pull[Symbol.asyncIterator]();

    const ok = await client.publish(ACK_TOPIC, { jobId: "j-1", stepId: "s-1" });

    expect(ok).toBe(true);
    const { value } = await frames.next();
    const envelope = decodeZmqEnvelope(
      value[0].toString(),
      value[1].toString(),
    );
    expect(envelope.kind).toBe("event");
    if (envelope.kind !== "event") throw new Error("unreachable");
    expect(envelope.payload.topic).toBe(ACK_TOPIC);
    expect(envelope.payload.message).toEqual({ jobId: "j-1", stepId: "s-1" });
  });
});
