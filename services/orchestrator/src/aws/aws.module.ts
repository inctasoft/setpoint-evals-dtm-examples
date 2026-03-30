import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SqsConfig } from './sqs.config';
import { SqsService } from './sqs.service';

/**
 * AWS Module
 * Provides AWS SDK services (SQS, etc.) for the application
 */
@Module({
  imports: [ConfigModule],
  providers: [SqsConfig, SqsService],
  exports: [SqsConfig, SqsService],
})
export class AwsModule {}
