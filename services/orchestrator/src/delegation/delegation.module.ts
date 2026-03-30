import { Module } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { AwsModule } from '../aws/aws.module';
import { DelegationService } from './delegation.service';
import { CorrelationModule } from '../common/correlation/correlation.module';

/**
 * Delegation Module
 * Handles delegation of workflow steps to Lambda workers
 */
@Module({
  imports: [DatabaseModule, AwsModule, CorrelationModule],
  providers: [DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
