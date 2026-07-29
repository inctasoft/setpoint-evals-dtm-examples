import { Module } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { KafkaModule } from '../kafka/kafka.module';
import { TransportModule } from '../transport/transport.module';
import { CallbackService } from './callback.service';
import { CallbackController } from './callback.controller';

/**
 * Callback Module
 * Handles HTTP callbacks from Lambda workers
 * Triggers orchestration to continue job processing
 */
@Module({
  imports: [DatabaseModule, OrchestrationModule, KafkaModule, TransportModule],
  providers: [CallbackService],
  controllers: [CallbackController],
  exports: [CallbackService],
})
export class CallbackModule {}
