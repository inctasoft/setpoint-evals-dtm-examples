import { Module } from '@nestjs/common';
import { DatabaseModule } from '@dtm/database';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * MetricsModule — backs the monitor's "Throughput" tab. Reads dtm_steps
 * directly via TypeORM's Repository<Step> (registered by @dtm/database's
 * DatabaseModule — @Global(), so importing it here is belt-and-suspenders,
 * not a second registration). No new database package build required: this
 * module reads the Step entity class straight from the installed dist, it
 * does not add repository methods to the shared package.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
