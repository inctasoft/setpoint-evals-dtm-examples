import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { DelegationModule } from '../delegation/delegation.module';
import { KafkaModule } from '../kafka/kafka.module';
import { OrchestrationService } from './orchestration.service';
import { CascadePublishService } from './cascade-publish.service';
import { FanOutService } from './fan-out.service';

@Module({
  imports: [
    DatabaseModule,
    DelegationModule,
    forwardRef(() => KafkaModule), // Forward ref to avoid circular dependency
  ],
  providers: [OrchestrationService, CascadePublishService, FanOutService],
  exports: [OrchestrationService, CascadePublishService, FanOutService],
})
export class OrchestrationModule {}
