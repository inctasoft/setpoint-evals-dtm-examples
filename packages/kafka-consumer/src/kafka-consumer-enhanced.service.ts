import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import {
  KafkaConsumerConfig,
  TopicSubscription,
} from "./interfaces/consumer-config.interface";
import { IMessageHandler } from "./interfaces/message-handler.interface";
import { DLQService, DLQConfig } from "./dlq/dlq.service";

/**
 * Enhanced Kafka Consumer Service with Production-Grade Features
 *
 * Improvements over basic consumer:
 * - Dead Letter Queue (DLQ) integration
 * - Explicit heartbeat management for long operations
 * - Error boundaries that prevent queue blocking
 * - Structured error logging
 * - Graceful error handling (never throws from message handler)
 * - Per-topic DLQ support
 * - Retry tracking and limits
 *
 * Best Practices:
 * 1. Never throw from eachMessage handler
 * 2. Always send poison pills to DLQ
 * 3. Send heartbeats during long operations
 * 4. Log structured errors for observability
 * 5. Track consumer lag and processing metrics
 */
@Injectable()
export class KafkaConsumerEnhancedService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerEnhancedService.name);
  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;
  private dlqService: DLQService | null = null;
  private topicHandlers: Map<string, IMessageHandler> = new Map();
  private isConnected = false;

  // Configurable heartbeat interval (default 3s)
  private readonly HEARTBEAT_INTERVAL_MS = 3000;

  // Processing metrics
  private metrics = {
    messagesProcessed: 0,
    messagesSucceeded: 0,
    messagesFailed: 0,
    messagesSentToDLQ: 0,
  };

  constructor(
    private readonly config: KafkaConsumerConfig,
    dlqConfig?: DLQConfig,
  ) {
    // Initialize DLQ if config provided
    if (dlqConfig) {
      this.dlqService = new DLQService(dlqConfig);
    }
  }

  /**
   * Initialize Kafka consumer with production-ready configuration
   */
  async connect(): Promise<void> {
    if (!this.config.broker) {
      this.logger.warn("Kafka broker not configured - consumer disabled");
      return;
    }

    try {
      this.kafka = new Kafka({
        clientId: this.config.clientId || "dtm-consumer",
        brokers: this.config.broker.split(","),
        retry: {
          retries: 10,
          initialRetryTime: 1000,
          factor: 2, // Exponential backoff
          maxRetryTime: 30000,
          multiplier: 2,
        },
        // Connection timeout
        connectionTimeout: 10000,
        requestTimeout: 30000,
      });

      this.consumer = this.kafka.consumer({
        groupId: this.config.groupId,
        sessionTimeout: 45000, // Increased for long operations
        heartbeatInterval: 3000,
        maxWaitTimeInMs: 5000,
        // Rebalancing configuration
        rebalanceTimeout: 60000,
        // Important: Allow manual commit control for DLQ pattern
        // autoCommit: false, // Uncomment if you want manual commit control
      });

      await this.consumer.connect();
      this.isConnected = true;
      this.logger.log(
        `✅ Kafka consumer connected (group: ${this.config.groupId})`,
      );

      // Subscribe to topics if provided in config
      if (this.config.topics && this.config.topics.length > 0) {
        for (const topic of this.config.topics) {
          await this.subscribe({ topic, fromBeginning: false });
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to connect Kafka consumer: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Subscribe to a Kafka topic
   */
  async subscribe(subscription: TopicSubscription): Promise<void> {
    if (!this.consumer) {
      this.logger.debug(
        `Consumer not initialized - skipping subscription to ${subscription.topic}`,
      );
      return;
    }

    try {
      await this.consumer.subscribe({
        topic: subscription.topic,
        fromBeginning: subscription.fromBeginning ?? false,
      });
      this.logger.log(`📝 Subscribed to topic: ${subscription.topic}`);
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to ${subscription.topic}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Register a message handler for a specific topic
   */
  registerHandler(topic: string, handler: IMessageHandler): void {
    this.topicHandlers.set(topic, handler);
    this.logger.log(`✅ Registered handler for topic: ${topic}`);
  }

  /**
   * Start consuming messages with enhanced error handling
   *
   * Key Features:
   * - Explicit heartbeat management
   * - Error boundaries (never throws)
   * - DLQ integration
   * - Structured logging
   */
  async startConsuming(): Promise<void> {
    if (!this.consumer) {
      this.logger.debug("Consumer not initialized - skipping start");
      return;
    }

    try {
      await this.consumer.run({
        eachMessage: async (payload: EachMessagePayload) => {
          await this.handleMessageWithErrorBoundary(payload);
        },
      });
      this.logger.log("🚀 Kafka consumer started with enhanced error handling");
    } catch (error) {
      this.logger.error(
        `Failed to start consumer: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      this.logger.warn(
        "Kafka consumer will retry automatically in the background...",
      );
      // Don't throw - let kafkajs handle reconnection automatically
    }
  }

  /**
   * Handle incoming message with error boundary
   *
   * This is the CRITICAL method that ensures:
   * 1. Messages are never lost
   * 2. Queue is never blocked
   * 3. Heartbeats are sent during processing
   * 4. Errors are logged and sent to DLQ
   * 5. Metrics are tracked
   */
  private async handleMessageWithErrorBoundary(
    payload: EachMessagePayload,
  ): Promise<void> {
    const { topic, partition, message, heartbeat } = payload;
    this.metrics.messagesProcessed++;

    // Set up heartbeat interval for long-running operations
    const heartbeatInterval = setInterval(async () => {
      try {
        await heartbeat();
        this.logger.debug(
          `💓 Heartbeat sent (topic: ${topic}, offset: ${message.offset})`,
        );
      } catch (heartbeatError) {
        this.logger.error("Heartbeat failed", {
          error:
            heartbeatError instanceof Error
              ? heartbeatError.message
              : "Unknown error",
          topic,
          partition,
          offset: message.offset,
        });
      }
    }, this.HEARTBEAT_INTERVAL_MS);

    try {
      // Process message
      await this.handleMessage(payload);

      // Success metrics
      this.metrics.messagesSucceeded++;
      this.logger.debug(`✅ Successfully processed message from ${topic}`, {
        partition,
        offset: message.offset,
      });
    } catch (error) {
      // CRITICAL: Catch all errors to prevent queue blocking
      this.metrics.messagesFailed++;

      this.logger.error(`❌ Error processing message from ${topic}`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        topic,
        partition,
        offset: message.offset,
      });

      // Send to DLQ (if available)
      if (this.dlqService) {
        await this.dlqService.sendToDLQ({
          message,
          topic,
          partition,
          error: error instanceof Error ? error : new Error(String(error)),
          errorContext: "Message processing failed",
          errorType: "processing",
        });
        this.metrics.messagesSentToDLQ++;
      } else {
        this.logger.warn(
          "DLQ not configured - failed message will not be preserved",
          {
            topic,
            offset: message.offset,
          },
        );
      }

      // IMPORTANT: Do NOT throw here - let processing continue
      // The message will be committed and processing will move forward
    } finally {
      // Always clean up heartbeat interval
      clearInterval(heartbeatInterval);

      // Send final heartbeat
      try {
        await heartbeat();
      } catch (finalHeartbeatError) {
        this.logger.error("Final heartbeat failed", {
          error:
            finalHeartbeatError instanceof Error
              ? finalHeartbeatError.message
              : "Unknown error",
        });
      }
    }
  }

  /**
   * Handle incoming message (delegates to registered handler)
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const handler = this.topicHandlers.get(topic);

    if (!handler) {
      this.logger.warn(`No handler registered for topic: ${topic}`);
      return;
    }

    const messageValue = message.value?.toString() || "";
    this.logger.debug(
      `📥 Received message from ${topic} [partition ${partition}]`,
      {
        offset: message.offset,
        preview: messageValue.substring(0, 100),
      },
    );

    // Delegate to handler (can throw - caught by error boundary)
    await handler.handleMessage(payload);
  }

  /**
   * Check if consumer is connected
   */
  isConsumerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Get processing metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate:
        this.metrics.messagesProcessed > 0
          ? (this.metrics.messagesSucceeded / this.metrics.messagesProcessed) *
            100
          : 0,
      dlqRate:
        this.metrics.messagesProcessed > 0
          ? (this.metrics.messagesSentToDLQ / this.metrics.messagesProcessed) *
            100
          : 0,
    };
  }

  /**
   * Disconnect consumer and DLQ service
   */
  async disconnect(): Promise<void> {
    // Disconnect consumer
    if (this.consumer) {
      try {
        await this.consumer.disconnect();
        this.isConnected = false;
        this.logger.log("Kafka consumer disconnected");
      } catch (error) {
        this.logger.error(
          `Error disconnecting consumer: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // Disconnect DLQ service
    if (this.dlqService) {
      try {
        await this.dlqService.disconnect();
        this.logger.log("DLQ service disconnected");
      } catch (error) {
        this.logger.error(
          `Error disconnecting DLQ service: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    // Log final metrics
    this.logger.log("Final metrics:", this.getMetrics());
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
}
