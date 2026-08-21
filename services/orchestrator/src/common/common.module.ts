import { Module } from '@nestjs/common';
import { DeduplicationService } from './deduplication.service';
import { DatabaseModule } from '@dtm/database';

@Module({
  imports: [DatabaseModule],
  providers: [DeduplicationService],
  exports: [DeduplicationService],
})
export class CommonModule {}
