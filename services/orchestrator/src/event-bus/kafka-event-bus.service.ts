import { Injectable, Logger } from '@nestjs/common';
import { KafkaConsumerService, IMessageHandler } from '@dtm/kafka-consumer';
import { KafkaService } from '../kafka/kafka.service';
import { EventBus, EventBusCapabilities, EventBusMessageHandler } from './event-bus.interface';

/**
 * Kafka-backed event bus (Phase 3). A THIN adapter over the existing
 * KafkaService (producer) and KafkaConsumerService (consumer): identical
 * arguments in, identical booleans out, identical call ordering
 * (connect → subscribe ×N → startConsuming). Today's Kafka behavior is
 * byte-equivalent by construction — the aws estate's green run is the proof.
 */
@Injectable()
export class KafkaEventBus extends EventBus {
  readonly capabilities: EventBusCapabilities = {
    droppedPublishRecovery: 'bus',
  };

  private readonly logger = new Logger(KafkaEventBus.name);
  private connectPromise?: Promise<void>;
  private startPromise?: Promise<void>;

  constructor(
    private readonly kafkaService: KafkaService,
    private readonly kafkaConsumer: KafkaConsumerService,
  ) {
    super();
  }

  async publish(topic: string, message: unknown, key?: string): Promise<boolean> {
    return this.kafkaService.publish(topic, message, key);
  }

  async subscribe(topic: string, handler: EventBusMessageHandler): Promise<void> {
    // Connect lazily on first subscribe, preserving today's ordering
    // (connect → registerHandler/subscribe ×N → startConsuming).
    this.connectPromise ??= this.kafkaConsumer.connect();
    await this.connectPromise;

    // kafkajs IMessageHandler adapter: parse the value and deliver
    // (topic, parsed). An unparseable value throws — the consumer routes it
    // to the DLQ exactly as today's handler-side parse failure does.
    const adapter: IMessageHandler = {
      handleMessage: async (payload) => {
        const value = payload.message.value?.toString();
        if (!value) {
          throw new Error('Event message value is null');
        }
        const message: unknown = JSON.parse(value);
        await handler(payload.topic, message);
      },
    };

    this.kafkaConsumer.registerHandler(topic, adapter);
    await this.kafkaConsumer.subscribe({ topic, fromBeginning: false });
    this.logger.log(`Subscribed to event topic: ${topic}`);
  }

  /** The consumer's startConsuming — exactly once, after all subscriptions. */
  async start(): Promise<void> {
    this.startPromise ??= this.kafkaConsumer.startConsuming();
    await this.startPromise;
  }

  isConnected(): boolean {
    return this.kafkaService.isConnected();
  }

  healthCheck(): { healthy: boolean; message: string } {
    const connected = this.isConnected();
    return {
      healthy: connected,
      message: connected ? 'Kafka event bus connected' : 'Kafka event bus not connected',
    };
  }
}
