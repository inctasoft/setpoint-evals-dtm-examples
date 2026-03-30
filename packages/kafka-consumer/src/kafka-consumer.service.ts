import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import {
  KafkaConsumerConfig,
  TopicSubscription,
} from "./interfaces/consumer-config.interface";
import { IMessageHandler } from "./interfaces/message-handler.interface";

@Injectable()
export class KafkaConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;
  private topicHandlers: Map<string, IMessageHandler> = new Map();
  private isConnected = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  constructor(private readonly config: KafkaConsumerConfig) {}

  /**
   * Initialize Kafka consumer
   */
  async connect(): Promise<void> {
    if (!this.config.broker) {
      this.logger.warn("Kafka broker not configured - consumer disabled");
      return;
    }

    const brokers = this.config.broker.split(",").map((b) => b.trim());
    this.logger.log(
      `[KafkaConsumerService] Creating consumer with brokers: ${JSON.stringify(brokers)}`,
    );

    try {
      this.kafka = new Kafka({
        clientId: this.config.clientId || "dtm-consumer",
        brokers,
        retry: {
          retries: 10, // Increased from 5 for startup reliability
          initialRetryTime: 1000, // Increased from 300ms to 1s
          factor: 2,
          maxRetryTime: 30000, // Max 30 seconds between retries
          multiplier: 2,
        },
      });

      this.consumer = this.kafka.consumer({
        groupId: this.config.groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        // Retry on rebalance - don't fail the consumer
        rebalanceTimeout: 60000,
        maxWaitTimeInMs: 5000,
      });

      // Handle consumer crash events - auto-reconnect instead of crashing
      this.consumer.on("consumer.crash", async (event) => {
        const error = event.payload.error;
        this.logger.error(`❌ Kafka consumer crashed: ${error.message}`);
        this.isConnected = false;

        // Don't crash the process - attempt reconnection
        if (!this.isReconnecting) {
          await this.handleReconnection();
        }
      });

      // Handle disconnect events
      this.consumer.on("consumer.disconnect", () => {
        this.logger.warn("⚠️ Kafka consumer disconnected");
        this.isConnected = false;
      });

      // Handle rebalancing - this is normal, don't treat as error
      this.consumer.on("consumer.rebalancing", () => {
        this.logger.log("🔄 Kafka consumer group rebalancing...");
      });

      // Handle successful group join
      this.consumer.on("consumer.group_join", (event) => {
        this.logger.log(
          `✅ Kafka consumer joined group: ${event.payload.groupId}`,
        );
        this.reconnectAttempts = 0; // Reset on successful join
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
   * Start consuming messages
   * Note: KafkaJS will automatically retry on connection failures and handle rebalancing
   */
  async startConsuming(): Promise<void> {
    if (!this.consumer) {
      this.logger.debug("Consumer not initialized - skipping start");
      return;
    }

    try {
      await this.consumer.run({
        // Auto-commit after each message to prevent reprocessing on rebalance
        autoCommit: true,
        autoCommitInterval: 5000,
        autoCommitThreshold: 1,
        eachMessage: async (payload: EachMessagePayload) => {
          try {
            await this.handleMessage(payload);
          } catch (messageError) {
            // Log but don't throw - prevent consumer crash on message processing errors
            this.logger.error(
              `Error processing message, will continue: ${messageError instanceof Error ? messageError.message : "Unknown error"}`,
            );
          }
        },
      });
      this.logger.log("🚀 Kafka consumer started");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if this is a rebalancing error - these are normal and will auto-recover
      if (
        errorMessage.includes("rebalancing") ||
        errorMessage.includes("rejoin")
      ) {
        this.logger.log(
          "🔄 Consumer rebalancing in progress - will auto-recover",
        );
        return;
      }

      this.logger.error(`Failed to start consumer: ${errorMessage}`);
      this.logger.warn(
        "Kafka consumer will retry automatically in the background...",
      );
      // Don't throw - let kafkajs handle reconnection automatically
      // The consumer will keep trying to reconnect based on retry config
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const handler = this.topicHandlers.get(topic);

    if (!handler) {
      this.logger.warn(`No handler registered for topic: ${topic}`);
      return;
    }

    try {
      const messageValue = message.value?.toString() || "";
      this.logger.debug(
        `📥 Received message from ${topic} [partition ${partition}]: ${messageValue.substring(0, 100)}...`,
      );

      await handler.handleMessage(payload);

      this.logger.debug(`✅ Successfully processed message from ${topic}`);
    } catch (error) {
      this.logger.error(
        `❌ Error processing message from ${topic}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // In production, you might want to send to a DLQ here
      throw error;
    }
  }

  /**
   * Handle reconnection after crash or disconnect
   */
  private async handleReconnection(): Promise<void> {
    if (this.isReconnecting) {
      this.logger.debug("Already attempting reconnection...");
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.logger.error(
        `❌ Max reconnection attempts (${this.maxReconnectAttempts}) exceeded. Manual intervention required.`,
      );
      this.isReconnecting = false;
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      30000,
    );
    this.logger.log(
      `🔄 Attempting reconnection (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      if (this.consumer) {
        // Try to disconnect cleanly first
        try {
          await this.consumer.disconnect();
        } catch {
          // Ignore disconnect errors during reconnection
        }
      }

      // Reconnect
      await this.connect();

      // Re-register handlers and restart consuming
      if (this.topicHandlers.size > 0) {
        await this.startConsuming();
      }

      this.logger.log("✅ Successfully reconnected to Kafka");
    } catch (error) {
      this.logger.error(
        `❌ Reconnection attempt ${this.reconnectAttempts} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // Will retry on next crash event
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Check if consumer is connected
   */
  isConsumerConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect consumer
   */
  async disconnect(): Promise<void> {
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
  }

  async onModuleDestroy() {
    await this.disconnect();
  }
}
