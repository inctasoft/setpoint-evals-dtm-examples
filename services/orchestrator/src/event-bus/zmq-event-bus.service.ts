import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as zmq from 'zeromq';
import { buildZmqEventEnvelope, decodeZmqEnvelope, encodeZmqEnvelope } from '@dtm/core';
import { EventBus, EventBusCapabilities, EventBusMessageHandler } from './event-bus.interface';

/**
 * ZeroMQ event bus (Phase 3 of the bus-agnosticism program).
 *
 * Topology (orchestrator binds, peers connect):
 * - events OUT: PUB socket (ZMQ_EVENTS_ENDPOINT, default tcp://0.0.0.0:5558).
 *   Subscribers (dev-ack-simulator) CONNECT with SUB and filter by topic.
 * - acks IN:    PULL socket (ZMQ_ACKS_ENDPOINT, default tcp://0.0.0.0:5559).
 *   Publishers (dev-ack-simulator) CONNECT with PUSH; PUSH-side queuing holds
 *   acks locally while the orchestrator is down.
 *
 * Every frame is the versioned `[topic, json]` envelope from @dtm/core
 * (kind 'event', additive on envelope version 1) — no hand-built literals.
 *
 * Honest reliability contract: PUB/SUB is fire-and-forget — a publish with
 * no attached subscriber is SILENTLY DISCARDED and publish() still returns
 * true (the socket accepted it; fabricating a failure would be a lie).
 * Recovery is NOT this class's job: the EventRepublishScanTask re-publishes
 * un-ACKed steps on a short interval (declared via
 * capabilities.droppedPublishRecovery === 'orchestrator').
 */
@Injectable()
export class ZmqEventBus extends EventBus implements OnModuleInit, OnModuleDestroy {
  readonly capabilities: EventBusCapabilities = {
    droppedPublishRecovery: 'orchestrator',
  };

  private readonly logger = new Logger(ZmqEventBus.name);
  private readonly eventsEndpoint: string;
  private readonly acksEndpoint: string;
  private pub?: zmq.Publisher;
  private pull?: zmq.Pull;
  private receiveLoop?: Promise<void>;
  private readonly handlers = new Map<string, EventBusMessageHandler[]>();

  constructor(private readonly configService: ConfigService) {
    super();
    this.eventsEndpoint = this.configService.get<string>(
      'ZMQ_EVENTS_ENDPOINT',
      'tcp://0.0.0.0:5558',
    );
    this.acksEndpoint = this.configService.get<string>('ZMQ_ACKS_ENDPOINT', 'tcp://0.0.0.0:5559');
  }

  /** Actual bound addresses (after wildcard-port resolution) — used by specs. */
  get boundEventsEndpoint(): string {
    return this.pub?.lastEndpoint ?? this.eventsEndpoint;
  }

  get boundAcksEndpoint(): string {
    return this.pull?.lastEndpoint ?? this.acksEndpoint;
  }

  async onModuleInit(): Promise<void> {
    this.pub = new zmq.Publisher();
    await this.pub.bind(this.eventsEndpoint);
    this.pull = new zmq.Pull();
    await this.pull.bind(this.acksEndpoint);
    this.receiveLoop = this.runReceiveLoop();
    this.logger.log(
      `ZmqEventBus bound: PUB ${this.boundEventsEndpoint} (events out), PULL ${this.boundAcksEndpoint} (acks in) — droppedPublishRecovery: orchestrator`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.pub?.close();
    this.pull?.close();
    await this.receiveLoop?.catch(() => undefined);
  }

  /**
   * Fire-and-forget publish. Returns true on acceptance — NOT a delivery
   * guarantee (PUB/SUB drops when no subscriber is attached; the republish
   * scan owns recovery).
   */
  async publish(topic: string, message: unknown, key?: string): Promise<boolean> {
    if (!this.pub) throw new Error('ZmqEventBus PUB socket is not bound');
    void key; // PUB/SUB has no partitioning key — documented no-op.
    await this.pub.send(
      encodeZmqEnvelope(
        buildZmqEventEnvelope({
          topic,
          message: (message ?? {}) as Record<string, unknown>,
        }),
      ),
    );
    return true;
  }

  async subscribe(topic: string, handler: EventBusMessageHandler): Promise<void> {
    const handlers = this.handlers.get(topic) ?? [];
    handlers.push(handler);
    this.handlers.set(topic, handlers);
    this.logger.log(`Registered ack handler for topic: ${topic}`);
  }

  /** No-op — the bus is live on bind (kept for interface parity). */
  async start(): Promise<void> {
    return Promise.resolve();
  }

  isConnected(): boolean {
    return !!this.pub && !!this.pull;
  }

  healthCheck(): { healthy: boolean; message: string } {
    return {
      healthy: this.isConnected(),
      message: `ZeroMQ event bus PUB ${this.boundEventsEndpoint} / PULL ${this.boundAcksEndpoint}`,
    };
  }

  private async runReceiveLoop(): Promise<void> {
    if (!this.pull) return;
    try {
      for await (const frames of this.pull) {
        const [topic, json] = frames;
        try {
          const envelope = decodeZmqEnvelope(topic.toString(), json.toString());
          if (envelope.kind !== 'event') {
            this.logger.warn(
              `Unexpected frame kind '${envelope.kind}' on the ack socket — dropped`,
            );
            continue;
          }
          const handlers = this.handlers.get(envelope.payload.topic) ?? [];
          if (handlers.length === 0) {
            this.logger.warn(
              `Ack event for topic '${envelope.payload.topic}' has no registered handler — dropped`,
            );
            continue;
          }
          for (const handler of handlers) {
            await handler(envelope.payload.topic, envelope.payload.message);
          }
        } catch (error) {
          this.logger.error(
            `Malformed ack frame: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    } catch (error) {
      // Socket closed during shutdown — an expected end of the loop.
      this.logger.debug(
        `PULL receive loop ended: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
