import { Injectable, Logger } from "@nestjs/common";
import { Kafka, Producer, KafkaMessage, IHeaders } from "kafkajs";

/**
 * Standard DLQ message envelope for consistent error tracking
 */
export interface DLQEnvelope {
  // Origin tracking
  originalTopic: string;
  originalPartition: number;
  originalOffset: string;
  originalTimestamp: string;
  originalKey: string | null;

  // Error context
  errorReason: string;
  errorStack?: string;
  errorContext?: string;
  errorType?: "validation" | "processing" | "timeout" | "unknown";

  // Processing metadata
  service: string;
  consumerGroup: string;
  attemptCount: number;
  firstFailedAt: string;
  lastFailedAt: string;

  // Original message (base64 encoded if binary)
  originalValue: string;
  originalHeaders: Record<string, string>;
}

/**
 * Configuration for DLQ Service
 */
export interface DLQConfig {
  brokers: string[];
  clientId: string;
  service: string;
  consumerGroup: string;
  enabled?: boolean;
  ssl?: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
}

/**
 * Dead Letter Queue Service
 *
 * Handles failed messages with:
 * - Per-topic DLQ pattern (topic.dlq)
 * - Standardized message envelope
 * - Lazy producer initialization
 * - Graceful error handling (DLQ failures don't crash service)
 * - Structured logging for observability
 *
 * Usage:
 * ```typescript
 * try {
 *   await handler.process(message);
 * } catch (error) {
 *   await dlqService.sendToDLQ({
 *     message,
 *     topic: 'dtm.your-workflow.ack',
 *     partition: 0,
 *     error,
 *     errorContext: 'Failed to process consumer created event',
 *   });
 * }
 * ```
 */
@Injectable()
export class DLQService {
  private readonly logger = new Logger(DLQService.name);
  private producer: Producer | null = null;
  private isConnected = false;
  private config: DLQConfig;

  // Track attempt counts per message (in-memory cache)
  private attemptTracker = new Map<
    string,
    { count: number; firstFailed: Date }
  >();

  constructor(config: DLQConfig) {
    this.config = config;

    if (!config.enabled) {
      this.logger.warn("DLQ Service disabled via configuration");
    }
  }

  /**
   * Send a failed message to the Dead Letter Queue
   *
   * @param params - Message and error details
   */
  async sendToDLQ(params: {
    message: KafkaMessage;
    topic: string;
    partition: number;
    error: Error | string;
    errorContext?: string;
    errorType?: DLQEnvelope["errorType"];
  }): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug("DLQ disabled - skipping message");
      return;
    }

    const { message, topic, partition, error, errorContext, errorType } =
      params;

    try {
      // Ensure producer is connected
      await this.ensureConnected();

      // Generate DLQ topic name (per-topic pattern)
      const dlqTopic = this.getDLQTopicName(topic);

      // Track attempts for this message
      const messageKey = this.getMessageKey(topic, partition, message.offset);
      const attempts = this.trackAttempt(messageKey);

      // Build standardized DLQ envelope
      const envelope: DLQEnvelope = {
        // Origin tracking
        originalTopic: topic,
        originalPartition: partition,
        originalOffset: message.offset,
        originalTimestamp: message.timestamp,
        originalKey: message.key?.toString() || null,

        // Error context
        errorReason: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorContext: errorContext || "Message processing failed",
        errorType: errorType || "unknown",

        // Processing metadata
        service: this.config.service,
        consumerGroup: this.config.consumerGroup,
        attemptCount: attempts.count,
        firstFailedAt: attempts.firstFailed.toISOString(),
        lastFailedAt: new Date().toISOString(),

        // Original message
        originalValue: message.value?.toString("base64") || "",
        originalHeaders: this.serializeHeaders(message.headers),
      };

      // Send to DLQ
      await this.producer!.send({
        topic: dlqTopic,
        messages: [
          {
            key: message.key || undefined,
            value: JSON.stringify(envelope, null, 2),
            headers: {
              "x-dlq-version": "1.0",
              "x-original-topic": topic,
              "x-service": this.config.service,
              "x-error-type": errorType || "unknown",
            },
          },
        ],
      });

      this.logger.warn(`Message sent to DLQ: ${dlqTopic}`, {
        originalTopic: topic,
        dlqTopic,
        partition,
        offset: message.offset,
        attemptCount: attempts.count,
        errorReason: envelope.errorReason,
      });

      // Cleanup attempt tracker after 1 hour
      setTimeout(() => this.attemptTracker.delete(messageKey), 3600000);
    } catch (dlqError) {
      // CRITICAL: DLQ failures should NOT crash the consumer
      this.logger.error("Failed to send message to DLQ (non-fatal)", {
        error: dlqError instanceof Error ? dlqError.message : String(dlqError),
        originalTopic: topic,
        partition,
        offset: message.offset,
      });

      // Continue processing - don't throw
    }
  }

  /**
   * Ensure producer is connected (lazy initialization)
   */
  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.producer) {
      return;
    }

    try {
      const kafka = new Kafka({
        clientId: `${this.config.clientId}-dlq`,
        brokers: this.config.brokers,
        ssl: this.config.ssl,
        sasl: this.config.sasl as any, // Type assertion needed for union type compatibility
        retry: {
          retries: 5,
          initialRetryTime: 1000,
          factor: 2,
          maxRetryTime: 30000,
        },
      });

      this.producer = kafka.producer({
        allowAutoTopicCreation: false, // DLQ topics should be pre-created
        idempotent: true, // Prevent duplicate DLQ messages
        maxInFlightRequests: 1,
        transactionTimeout: 30000,
        retry: {
          retries: 5,
          initialRetryTime: 1000,
        },
      });

      await this.producer.connect();
      this.isConnected = true;
      this.logger.log("✅ DLQ Producer connected");
    } catch (error) {
      this.logger.error(
        `Failed to connect DLQ producer: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Disconnect producer
   */
  async disconnect(): Promise<void> {
    if (this.producer && this.isConnected) {
      try {
        await this.producer.disconnect();
        this.isConnected = false;
        this.logger.log("DLQ Producer disconnected");
      } catch (error) {
        this.logger.error(
          `Error disconnecting DLQ producer: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  /**
   * Check if DLQ service is connected
   */
  isServiceConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get DLQ topic name for a given operational topic
   */
  private getDLQTopicName(originalTopic: string): string {
    return `${originalTopic}.dlq`;
  }

  /**
   * Generate unique key for message tracking
   */
  private getMessageKey(
    topic: string,
    partition: number,
    offset: string,
  ): string {
    return `${topic}:${partition}:${offset}`;
  }

  /**
   * Track message attempts
   */
  private trackAttempt(messageKey: string): {
    count: number;
    firstFailed: Date;
  } {
    const existing = this.attemptTracker.get(messageKey);

    if (existing) {
      existing.count += 1;
      this.attemptTracker.set(messageKey, existing);
      return existing;
    }

    const newAttempt = { count: 1, firstFailed: new Date() };
    this.attemptTracker.set(messageKey, newAttempt);
    return newAttempt;
  }

  /**
   * Serialize Kafka headers to plain object
   */
  private serializeHeaders(
    headers: IHeaders | undefined,
  ): Record<string, string> {
    if (!headers) return {};

    const serialized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      serialized[key] = value?.toString() || "";
    }
    return serialized;
  }

  /**
   * Get DLQ statistics
   */
  getStats(): {
    connected: boolean;
    trackedMessages: number;
    enabled: boolean;
  } {
    return {
      connected: this.isConnected,
      trackedMessages: this.attemptTracker.size,
      enabled: this.config.enabled || false,
    };
  }
}
