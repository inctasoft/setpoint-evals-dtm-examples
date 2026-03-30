import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { KafkaConsumerModule, KafkaConsumerService } from '@dtm/kafka-consumer';
import { DatabaseModule } from '@dtm/database';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { CommonModule } from '../common/common.module';
import { AcknowledgementHandler } from './handlers/acknowledgement.handler';
import { KafkaModule } from './kafka.module';
import { WorkflowRegistryService } from '../workflow-loader';

/**
 * KafkaHandlersModule manages Kafka consumer handlers for workflow events
 *
 * This module:
 * - Subscribes to ACK topics from all registered workflows (dynamic, via WorkflowRegistryService)
 * - Handles acknowledgements from external systems or dev-ack-simulator (see tools/dev-ack-simulator/)
 *
 * Configuration (via typed config namespaces):
 * - kafka.broker                    → Kafka broker URL
 * - kafka.consumerGroupId           → Consumer group ID
 *
 */
@Module({
  imports: [
    // Use forRootAsync to inject ConfigService for Kafka configuration
    // Note: Type assertion needed due to NestJS version differences between workspace packages
    KafkaConsumerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const broker = configService.get<string>('kafka.broker');
        const clientId = configService.get<string>('kafka.consumerClientId');
        const groupId = configService.get<string>('kafka.consumerGroupId');
        console.log(
          `[KafkaHandlersModule] Consumer: broker=${broker}, clientId=${clientId}, groupId=${groupId}`,
        );
        return {
          broker: broker || 'localhost:9093',
          groupId: groupId || 'dtm-service-group',
          clientId: clientId || 'dtm-orchestrator-consumer',
        };
      },
    }) as any,
    DatabaseModule,
    OrchestrationModule,
    CommonModule,
    ConfigModule,
    KafkaModule,
  ],
  providers: [AcknowledgementHandler],
  exports: [AcknowledgementHandler],
})
export class KafkaHandlersModule implements OnModuleInit {
  private readonly logger = new Logger(KafkaHandlersModule.name);

  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly acknowledgementHandler: AcknowledgementHandler,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  async onModuleInit() {
    // Connect to Kafka
    await this.kafkaConsumer.connect();

    // Dynamic ACK topic subscriptions from all registered workflows
    const ackTopics = this.workflowRegistry.getAllAckTopics();
    this.logger.log(
      `Registering ACK handlers for ${ackTopics.length} topic(s) across all workflows: [${ackTopics.join(', ')}]`,
    );

    for (const ackTopic of ackTopics) {
      this.kafkaConsumer.registerHandler(ackTopic, this.acknowledgementHandler);
      await this.kafkaConsumer.subscribe({ topic: ackTopic, fromBeginning: false });
    }

    this.logger.log(`✅ Kafka handlers registered: ${ackTopics.length} ACK topic(s)`);

    // Start consuming
    await this.kafkaConsumer.startConsuming();
  }
}
