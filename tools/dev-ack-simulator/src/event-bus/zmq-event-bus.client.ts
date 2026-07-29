/**
 * ZMQ Event Bus Client — dev-ack-simulator side of the zmq event bus
 * (Phase 3 of the bus-agnosticism program).
 *
 * Mirrors the orchestrator's ZmqEventBus topology from the peer side:
 * - events IN:  SUB socket CONNECTS to the orchestrator's PUB
 *   (ZMQ_EVENTS_ENDPOINT) and subscribes to every configured listen topic;
 *   received event envelopes are handed to SimulatorService.handleBusMessage
 *   exactly as the Kafka consumer hands parsed messages.
 * - acks OUT:   PUSH socket CONNECTS to the orchestrator's PULL
 *   (ZMQ_ACKS_ENDPOINT); PUSH-side queuing holds acks locally while the
 *   orchestrator is down.
 *
 * Every frame is the versioned `[topic, json]` envelope from @dtm/core
 * (kind 'event') — no hand-built literals.
 *
 * Reliability note: PUB/SUB drops events published before this client
 * subscribes (slow joiner) or while it is down. That is by design for the
 * zmq profile — the orchestrator's EventRepublishScanTask re-publishes
 * un-ACKed steps until one lands.
 */

import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as zmq from "zeromq";
import {
  buildZmqEventEnvelope,
  decodeZmqEnvelope,
  encodeZmqEnvelope,
} from "@dtm/core";
import { SimulatorService } from "../simulator/simulator.service";
import {
  ACK_SUBSCRIPTIONS,
  AckSubscription,
} from "../config/ack-subscription.interface";
import { SimulatorEventBus } from "./simulator-event-bus.interface";

@Injectable()
export class ZmqEventBusClient
  implements SimulatorEventBus, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ZmqEventBusClient.name);
  private readonly eventsEndpoint: string;
  private readonly acksEndpoint: string;
  private sub?: zmq.Subscriber;
  private push?: zmq.Push;
  private receiveLoop?: Promise<void>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SimulatorService))
    private readonly simulatorService: SimulatorService,
    @Inject(ACK_SUBSCRIPTIONS)
    private readonly subscriptions: AckSubscription[],
  ) {
    this.eventsEndpoint = this.configService.get<string>(
      "ZMQ_EVENTS_ENDPOINT",
      "tcp://orchestrator:5558",
    );
    this.acksEndpoint = this.configService.get<string>(
      "ZMQ_ACKS_ENDPOINT",
      "tcp://orchestrator:5559",
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.subscriptions.length === 0) {
      this.logger.warn(
        "No ACK subscriptions configured — zmq event bus client will not start",
      );
      return;
    }

    this.push = new zmq.Push();
    this.push.connect(this.acksEndpoint);

    this.sub = new zmq.Subscriber();
    this.sub.connect(this.eventsEndpoint);
    const topics = this.subscriptions.map((s) => s.listenTopic);
    for (const topic of topics) {
      this.sub.subscribe(topic);
    }
    this.receiveLoop = this.runReceiveLoop();

    this.logger.log(
      `🔌 ZmqEventBusClient connected: SUB ${this.eventsEndpoint} (${topics.length} topic(s)), PUSH ${this.acksEndpoint}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.sub?.close();
    this.push?.close();
    await this.receiveLoop?.catch(() => undefined);
  }

  /** Publish an ack event to the orchestrator's PULL socket. */
  async publish(
    topic: string,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.push) {
      this.logger.error("ZmqEventBusClient PUSH socket is not connected");
      return false;
    }
    await this.push.send(
      encodeZmqEnvelope(buildZmqEventEnvelope({ topic, message })),
    );
    return true;
  }

  private async runReceiveLoop(): Promise<void> {
    if (!this.sub) return;
    try {
      for await (const [topic, json] of this.sub) {
        try {
          const envelope = decodeZmqEnvelope(topic.toString(), json.toString());
          if (envelope.kind !== "event") {
            this.logger.warn(
              `Unexpected frame kind '${envelope.kind}' — dropped`,
            );
            continue;
          }
          await this.simulatorService.handleBusMessage(
            envelope.payload.topic,
            envelope.payload.message as Parameters<
              SimulatorService["handleBusMessage"]
            >[1],
          );
        } catch (error) {
          this.logger.error(
            `Malformed event frame: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } catch (error) {
      // Socket closed during shutdown — an expected end of the loop.
      this.logger.debug(
        `SUB receive loop ended: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
