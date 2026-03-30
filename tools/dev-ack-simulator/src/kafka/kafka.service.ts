import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Producer, logLevel } from "kafkajs";

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private producer: Producer;
  private isConnected: boolean = false;
  private reconnecting: boolean = false;

  constructor(private readonly configService: ConfigService) {
    const brokers = this.configService.get<string>(
      "KAFKA_BROKERS",
      "localhost:9092",
    );

    this.kafka = new Kafka({
      clientId: "dev-ack-simulator",
      brokers: brokers.split(","),
      logLevel: logLevel.ERROR,
    });

    this.producer = this.kafka.producer();
  }

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.isConnected = false;
    await this.producer.disconnect();
    this.logger.log("Kafka producer disconnected");
  }

  /**
   * Connect to Kafka with retry logic
   */
  private async connect(): Promise<void> {
    try {
      await this.producer.connect();
      this.isConnected = true;
      this.reconnecting = false;
      this.logger.log("✅ Kafka producer connected successfully");
    } catch (error) {
      this.logger.error(`Failed to connect Kafka producer: ${error}`);
      this.logger.warn(
        "⚠️  Service will start without Kafka producer. It will try to reconnect on first publish.",
      );
      // Don't throw error to prevent application crash
      // The publish method handles reconnection automatically
    }
  }

  /**
   * Reconnect to Kafka after disconnect
   */
  private async reconnect(): Promise<boolean> {
    if (this.reconnecting) {
      this.logger.debug("Reconnection already in progress...");
      return false;
    }

    this.reconnecting = true;
    this.logger.warn("⚠️  Attempting to reconnect to Kafka...");

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)),
        );

        await this.producer.connect();
        this.isConnected = true;
        this.reconnecting = false;
        this.logger.log("✅ Kafka producer reconnected successfully");
        return true;
      } catch (error) {
        attempt++;
        this.logger.warn(
          `Reconnection attempt ${attempt}/${maxRetries} failed: ${error}`,
        );
      }
    }

    this.reconnecting = false;
    this.logger.error("❌ Failed to reconnect to Kafka after maximum retries");
    return false;
  }

  /**
   * Publish a message to a Kafka topic with automatic reconnection
   */
  async publish(
    topic: string,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.producer.send({
        topic,
        messages: [
          {
            value: JSON.stringify(message),
          },
        ],
      });

      this.logger.debug(`Published message to topic: ${topic}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to publish to ${topic}: ${error}`);

      // Check if it's a disconnect error and try to reconnect
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("disconnected") ||
        errorMessage.includes("not connected")
      ) {
        this.isConnected = false;
        this.logger.warn(
          "🔄 Producer disconnected, attempting to reconnect...",
        );

        const reconnected = await this.reconnect();
        if (reconnected) {
          // Retry the publish operation once after successful reconnection
          try {
            await this.producer.send({
              topic,
              messages: [{ value: JSON.stringify(message) }],
            });
            this.logger.log(
              `✅ Message published to ${topic} after reconnection`,
            );
            return true;
          } catch (retryError) {
            this.logger.error(
              `Failed to publish after reconnection: ${retryError}`,
            );
            return false;
          }
        }
      }

      return false;
    }
  }
}
