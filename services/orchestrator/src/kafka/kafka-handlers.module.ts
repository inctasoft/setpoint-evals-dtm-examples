import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { ConfigModule } from '@nestjs/config';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { CommonModule } from '../common/common.module';
import { AcknowledgementHandler } from './handlers/acknowledgement.handler';
import { EventBusModule } from '../event-bus/event-bus.module';
import { EventBus } from '../event-bus/event-bus.interface';
import { WorkflowRegistryService } from '../workflow-loader';

/**
 * KafkaHandlersModule manages event-bus consumer handlers for workflow events
 *
 * This module:
 * - Subscribes to ACK topics from all registered workflows (dynamic, via WorkflowRegistryService)
 * - Handles acknowledgements from external systems or dev-ack-simulator (see tools/dev-ack-simulator/)
 * - Goes through the EventBus abstraction (Phase 3): the Kafka profile wires
 *   the identical consumer flow as before (connect → subscribe ×N →
 *   startConsuming); the zmq profile receives acks over the PULL socket.
 *
 * Configuration (via typed config namespaces):
 * - kafka.broker                    → Kafka broker URL (kafka profile)
 * - kafka.consumerGroupId           → Consumer group ID (kafka profile)
 * - EVENT_BUS                       → kafka (default) | zmq
 *
 */
@Module({
  imports: [DatabaseModule, OrchestrationModule, CommonModule, ConfigModule, EventBusModule],
  providers: [AcknowledgementHandler],
  exports: [AcknowledgementHandler],
})
export class KafkaHandlersModule implements OnModuleInit {
  private readonly logger = new Logger(KafkaHandlersModule.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly acknowledgementHandler: AcknowledgementHandler,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  async onModuleInit() {
    // Dynamic ACK topic subscriptions from all registered workflows
    const ackTopics = this.workflowRegistry.getAllAckTopics();
    this.logger.log(
      `Registering ACK handlers for ${ackTopics.length} topic(s) across all workflows: [${ackTopics.join(', ')}]`,
    );

    for (const ackTopic of ackTopics) {
      await this.eventBus.subscribe(ackTopic, (topic, message) =>
        this.acknowledgementHandler.handleBusMessage(topic, message),
      );
    }

    // Buses with an explicit consumer-start lifecycle (Kafka) start here;
    // live-on-bind buses (zmq) no-op.
    await this.eventBus.start();

    this.logger.log(`✅ Kafka handlers registered: ${ackTopics.length} ACK topic(s)`);
  }
}
