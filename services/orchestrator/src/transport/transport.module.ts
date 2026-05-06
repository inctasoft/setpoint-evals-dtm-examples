import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { QueueTransport } from './queue-transport.interface';
import { SqsTransport } from './sqs-transport.service';
import { CloudTasksTransport } from './cloud-tasks-transport.service';

const QUEUE_TRANSPORT = process.env.QUEUE_TRANSPORT || 'sqs';

/**
 * Provides QueueTransport based on QUEUE_TRANSPORT env var.
 *   sqs          → SqsTransport  (LocalStack / AWS SQS)
 *   cloud-tasks  → CloudTasksTransport (GCP Cloud Tasks)
 */
@Module({
  imports: QUEUE_TRANSPORT === 'cloud-tasks' ? [] : [AwsModule],
  providers: [
    QUEUE_TRANSPORT === 'cloud-tasks'
      ? { provide: QueueTransport, useClass: CloudTasksTransport }
      : { provide: QueueTransport, useClass: SqsTransport },
    ...(QUEUE_TRANSPORT === 'sqs' ? [SqsTransport] : [CloudTasksTransport]),
  ],
  exports: [QueueTransport],
})
export class TransportModule {}
