import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Kafka, Consumer, EachMessagePayload, logLevel } from "kafkajs";
import { SimulatorService } from "../simulator/simulator.service";
import {
  ACK_SUBSCRIPTIONS,
  AckSubscription,
} from "../config/ack-subscription.interface";

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumer.name);
  private kafka: Kafka;
  private consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    private readonly simulatorService: SimulatorService,
    @Inject(ACK_SUBSCRIPTIONS)
    private readonly subscriptions: AckSubscription[],
  ) {
    const brokers = this.configService.get<string>("KAFKA_BROKERS");

    this.kafka = new Kafka({
      clientId: "dev-ack-simulator-consumer",
      brokers: brokers.split(","),
      logLevel: logLevel.ERROR,
    });

    this.consumer = this.kafka.consumer({
      groupId: "dev-ack-simulator-group",
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });
  }

  async onModuleInit() {
    // EVENT_BUS=zmq: the simulator consumes over the zmq SUB socket instead —
    // the Kafka consumer stays dark (Phase 3).
    if ((process.env.EVENT_BUS || "kafka") === "zmq") {
      this.logger.log(
        "EVENT_BUS=zmq — Kafka consumer disabled (zmq event bus active)",
      );
      return;
    }

    if (this.subscriptions.length === 0) {
      this.logger.warn(
        "No ACK subscriptions configured — Kafka consumer will not start",
      );
      return;
    }

    // Add event listeners for connection monitoring
    this.consumer.on("consumer.disconnect", () => {
      this.logger.warn(
        "Kafka consumer disconnected - auto-reconnect in progress...",
      );
    });

    this.consumer.on("consumer.connect", () => {
      this.logger.log("Kafka consumer connected/reconnected");
    });

    this.consumer.on("consumer.crash", async (event) => {
      this.logger.error(`Consumer crashed: ${event.payload.error.message}`);
      this.logger.warn("KafkaJS will attempt automatic restart...");
    });

    // Retry connection with exponential backoff
    await this.connectWithRetry();
  }

  private async connectWithRetry(
    maxRetries = 10,
    initialDelay = 2000,
  ): Promise<void> {
    let retries = 0;
    let delay = initialDelay;

    while (retries < maxRetries) {
      try {
        await this.consumer.connect();
        this.logger.log("Kafka consumer connected successfully");

        // Subscribe to completion topics derived from workflow config
        const topics = this.subscriptions.map((s) => s.listenTopic);
        await this.consumer.subscribe({
          topics,
          fromBeginning: false,
        });

        this.logger.log(
          `Subscribed to ${topics.length} completion topics: ${topics.join(", ")}`,
        );

        // Start consuming messages with automatic error recovery
        await this.consumer.run({
          autoCommitInterval: 5000,
          autoCommitThreshold: 100,
          eachMessage: async (payload: EachMessagePayload) => {
            await this.handleMessage(payload);
          },
        });

        this.logger.log("Kafka consumer started and running");
        return; // Success!
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          this.logger.error(
            `Failed to connect Kafka consumer after ${maxRetries} attempts: ${error.message}`,
          );
          this.logger.warn(
            "Service will continue running, but consumer is not active",
          );
          return; // Don't crash - keep service alive
        }

        this.logger.warn(
          `Kafka consumer connection failed (attempt ${retries}/${maxRetries}): ${error.message}`,
        );
        this.logger.log(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30000); // Exponential backoff, max 30s
      }
    }
  }

  async onModuleDestroy() {
    try {
      await this.consumer.disconnect();
      this.logger.log("Kafka consumer disconnected");
    } catch (error) {
      this.logger.warn(`Error disconnecting consumer: ${error.message}`);
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    try {
      await this.simulatorService.handleMessage(payload);
    } catch (error) {
      this.logger.error(`Error handling message: ${error}`);
    }
  }
}
