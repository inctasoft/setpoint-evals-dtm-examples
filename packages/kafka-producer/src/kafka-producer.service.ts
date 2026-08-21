import { Kafka, Producer, ProducerConfig, IHeaders } from "kafkajs";
import {
  JobCompletedMessage,
  JobFailedMessage,
  KafkaProducerConfig,
} from "./types";

/**
 * Shared Kafka Producer Service
 *
 * This service provides a reusable Kafka producer that can be used
 * across multiple services in the dtm monorepo.
 *
 * Usage:
 * ```typescript
 * const producer = new KafkaProducerService({
 *   broker: process.env.KAFKA_BROKER || 'kafka:29092',
 *   clientId: 'my-service',
 * });
 *
 * await producer.connect();
 * await producer.publishTransformed({
 *   eventId: '123',
 *   jobId: '456',
 *   transformedAt: new Date().toISOString(),
 * });
 * await producer.disconnect();
 * ```
 */
export class KafkaProducerService {
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  // Project-specific topics
  private readonly TOPIC_TRANSFORMED = "dtm.jobs.completed";
  private readonly TOPIC_FAILED = "dtm.jobs.failed";

  constructor(config: KafkaProducerConfig) {
    const brokers = Array.isArray(config.broker)
      ? config.broker
      : config.broker.split(",").map((b) => b.trim());

    console.log(
      `[KafkaProducerService] Creating producer with brokers: ${JSON.stringify(brokers)}`,
    );

    this.kafka = new Kafka({
      clientId: config.clientId || "dtm-producer",
      brokers,
      retry: config.retry || {
        retries: 3,
        initialRetryTime: 100,
      },
    });

    const producerConfig: ProducerConfig = {
      allowAutoTopicCreation: false, // Topics should be created beforehand
      idempotent: true, // Ensure exactly-once semantics
      maxInFlightRequests: 1, // Required for idempotent producer
      transactionTimeout: 30000,
    };

    this.producer = this.kafka.producer(producerConfig);
  }

  /**
   * Connect to Kafka broker
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.producer.connect();
      this.isConnected = true;
    } catch (error) {
      throw new Error(
        `Failed to connect Kafka producer: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Disconnect from Kafka broker
   */
  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.producer.disconnect();
      this.isConnected = false;
    } catch (error) {
      // Log but don't throw - disconnect errors are usually not critical
      console.error(
        `Error disconnecting Kafka producer: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Check if producer is connected
   */
  isProducerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Publish a message to the dtm.jobs.completed topic
   */
  async publishTransformed(
    message: JobCompletedMessage,
    partition?: number,
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error("Producer is not connected. Call connect() first.");
    }

    try {
      await this.producer.send({
        topic: this.TOPIC_TRANSFORMED,
        messages: [
          {
            key: message.eventId,
            value: JSON.stringify(message),
            partition,
          },
        ],
      });
    } catch (error) {
      throw new Error(
        `Failed to publish to ${this.TOPIC_TRANSFORMED}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Publish a message to the dtm.jobs.failed topic
   */
  async publishFailed(
    message: JobFailedMessage,
    partition?: number,
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error("Producer is not connected. Call connect() first.");
    }

    try {
      await this.producer.send({
        topic: this.TOPIC_FAILED,
        messages: [
          {
            key: message.eventId,
            value: JSON.stringify(message),
            partition,
          },
        ],
      });
    } catch (error) {
      throw new Error(
        `Failed to publish to ${this.TOPIC_FAILED}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Publish a generic message to any topic
   * Useful for custom events like job completion
   */
  async publish<T = Record<string, unknown>>(
    topic: string,
    message: T,
    key?: string,
    partition?: number,
    headers?: IHeaders,
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error("Producer is not connected. Call connect() first.");
    }

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: key || undefined,
            value: JSON.stringify(message),
            partition,
            headers,
          },
        ],
      });
    } catch (error) {
      throw new Error(
        `Failed to publish to ${topic}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get the topic names used by this producer
   */
  getTopics(): {
    transformed: string;
    failed: string;
  } {
    return {
      transformed: this.TOPIC_TRANSFORMED,
      failed: this.TOPIC_FAILED,
    };
  }
}
