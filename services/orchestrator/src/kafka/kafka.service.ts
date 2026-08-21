/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from '@dtm/kafka-producer';
import { CorrelationService } from '../common/correlation/correlation.service';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafkaProducer: KafkaProducerService | null = null;

  constructor(
    private readonly correlationService: CorrelationService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // Initialize Kafka producer using typed config namespace
    const kafkaBroker = this.configService.get<string>('kafka.broker');
    const clientId = this.configService.get<string>('kafka.producerClientId');
    this.logger.log(`Initializing Kafka producer: broker=${kafkaBroker}, clientId=${clientId}`);

    if (kafkaBroker) {
      try {
        this.kafkaProducer = new KafkaProducerService({
          broker: kafkaBroker,
          clientId: clientId || 'dtm-orchestrator-producer',
        });
        await this.kafkaProducer.connect();
        this.logger.log('Kafka producer connected successfully');
      } catch (error) {
        this.logger.error(
          `Failed to connect Kafka producer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.warn('Kafka broker not configured - Kafka features disabled');
    }
  }

  async onModuleDestroy() {
    if (this.kafkaProducer) {
      try {
        await this.kafkaProducer.disconnect();
        this.logger.log('Kafka producer disconnected');
      } catch (error) {
        this.logger.error(
          `Error disconnecting Kafka producer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  /**
   * Check if Kafka is connected and available
   */
  isConnected(): boolean {
    return this.kafkaProducer?.isProducerConnected() || false;
  }

  /**
   * Publish a message to a Kafka topic
   * Returns true if published successfully, false if Kafka is not configured
   */
  async publish<T = any>(
    topic: string,
    message: T,
    key?: string,
    partition?: number,
  ): Promise<boolean> {
    if (!this.kafkaProducer) {
      this.logger.debug(`Kafka not configured - skipping publish to ${topic}`);
      return false;
    }

    try {
      const correlationId = this.correlationService.getCorrelationId();
      const headers = correlationId ? { 'x-correlation-id': correlationId } : undefined;

      await this.kafkaProducer.publish(topic, message, key, partition, headers);
      this.logger.log(`✅ Published message to ${topic} (key: ${key || 'none'})`);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to publish to ${topic}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }
}
