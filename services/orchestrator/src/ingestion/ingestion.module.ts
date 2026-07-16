import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowJobService } from './workflow-job.service';
import { DatabaseModule } from '@dtm/database';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { CommonModule } from '../common/common.module';

/**
 * Ingestion Module
 * Handles incoming job submissions via REST API:
 * - WorkflowController: Generic workflow endpoint (POST /workflows/:name/jobs)
 * - WorkflowJobService: exported so non-HTTP callers (e.g. EvalsModule's run
 *   endpoint) can reuse the exact same job-submission logic with zero drift.
 */
@Module({
  imports: [DatabaseModule, OrchestrationModule, CommonModule],
  controllers: [WorkflowController],
  providers: [WorkflowJobService],
  exports: [WorkflowJobService],
})
export class IngestionModule {}
