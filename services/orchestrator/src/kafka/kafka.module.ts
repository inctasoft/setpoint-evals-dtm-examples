import { Module } from '@nestjs/common';
import { KafkaService } from './kafka.service';
import { KafkaTopicsController } from './kafka-topics.controller';
import { CorrelationModule } from '../common/correlation/correlation.module';

/**
 * KafkaModule provides Kafka producer functionality for publishing job events.
 *
 * This module:
 * - Exports KafkaService for publishing events to Kafka topics
 * - Used by CallbackService to publish job completion/failure events
 * - Gracefully degrades if KAFKA_BROKER is not configured
 * - Serves the monitor's "Kafka Topics" tab via a read-only admin-client
 *   controller (KafkaTopicsController) — never subscribes/consumes
 *
 * Note: Kafka consumer functionality is in KafkaConsumerModule (for external system ACK events)
 */
@Module({
  imports: [CorrelationModule],
  controllers: [KafkaTopicsController],
  providers: [KafkaService],
  exports: [KafkaService],
})
export class KafkaModule {}
