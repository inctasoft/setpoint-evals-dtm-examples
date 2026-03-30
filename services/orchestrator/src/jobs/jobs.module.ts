import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { DatabaseModule } from '@dtm/database';

/**
 * Jobs Module
 * Handles job status queries via REST API
 */
@Module({
  imports: [DatabaseModule],
  controllers: [JobsController],
})
export class JobsModule {}
