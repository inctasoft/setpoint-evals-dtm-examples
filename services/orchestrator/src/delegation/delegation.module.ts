import { Module } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { DelegationService } from './delegation.service';
import { CorrelationModule } from '../common/correlation/correlation.module';
import { TransportModule } from '../transport/transport.module';

/**
 * Delegation Module
 * Handles delegation of workflow steps to workers via pluggable QueueTransport.
 * QUEUE_TRANSPORT=sqs (default) | cloud-tasks
 */
@Module({
  imports: [DatabaseModule, TransportModule, CorrelationModule],
  providers: [DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
