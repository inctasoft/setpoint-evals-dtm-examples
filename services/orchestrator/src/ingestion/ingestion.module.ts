import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { DatabaseModule } from '@dtm/database';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { CommonModule } from '../common/common.module';

/**
 * Ingestion Module
 * Handles incoming job submissions via REST API:
 * - WorkflowController: Generic workflow endpoint (POST /workflows/:name/jobs)
 */
@Module({
  imports: [DatabaseModule, OrchestrationModule, CommonModule],
  controllers: [WorkflowController],
})
export class IngestionModule {}
