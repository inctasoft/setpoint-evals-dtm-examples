import { Module } from '@nestjs/common';
import { EvalsController } from './evals.controller';
import { EvalsDiscoveryService } from './evals-discovery.service';
import { EvalsRunService } from './evals-run.service';
import { IngestionModule } from '../ingestion/ingestion.module';

/**
 * Setpoint Evals discovery + run module — backs the monitor's "Scenarios"
 * screen. Filesystem discovery only (no bundled manifest, ever); run reuses
 * IngestionModule's WorkflowJobService (zero drift from a real
 * POST /workflows/:name/jobs).
 */
@Module({
  imports: [IngestionModule],
  controllers: [EvalsController],
  providers: [EvalsDiscoveryService, EvalsRunService],
})
export class EvalsModule {}
