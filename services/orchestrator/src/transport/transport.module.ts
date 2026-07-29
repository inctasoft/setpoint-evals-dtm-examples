import { Module } from '@nestjs/common';
import { AwsModule } from '../aws/aws.module';
import { QueueTransport } from './queue-transport.interface';
import { SqsTransport } from './sqs-transport.service';
import { CloudTasksTransport } from './cloud-tasks-transport.service';
import { ZmqTransport } from './zmq-transport.service';
import { ZmqWorkerRegistryService } from './zmq-worker-registry.service';
import { ZmqWorkersController } from './zmq-workers.controller';

const QUEUE_TRANSPORT = process.env.QUEUE_TRANSPORT || 'sqs';

/**
 * Provides QueueTransport based on QUEUE_TRANSPORT env var.
 *   sqs          → SqsTransport  (LocalStack / AWS SQS)
 *   cloud-tasks  → CloudTasksTransport (GCP Cloud Tasks)
 *   zmq          → ZmqTransport (ZeroMQ ROUTER + zmq-worker-host DEALER fleet)
 *
 * The zmq profile is fully dark under every other profile: ZmqTransport is
 * never instantiated, the ROUTER never binds, and the /workers controller is
 * never registered. ZmqTransport resolves StepRepository from the @Global
 * DatabaseModule (same seam the WebSocketModule relies on) — importing the
 * DatabaseModule here would break the hermetic boot specs.
 */
@Module({
  imports: QUEUE_TRANSPORT === 'sqs' ? [AwsModule] : [],
  controllers: QUEUE_TRANSPORT === 'zmq' ? [ZmqWorkersController] : [],
  providers: [
    ...(QUEUE_TRANSPORT === 'zmq'
      ? [
          ZmqWorkerRegistryService,
          ZmqTransport,
          { provide: QueueTransport, useClass: ZmqTransport },
        ]
      : QUEUE_TRANSPORT === 'cloud-tasks'
        ? [CloudTasksTransport, { provide: QueueTransport, useClass: CloudTasksTransport }]
        : [SqsTransport, { provide: QueueTransport, useClass: SqsTransport }]),
  ],
  exports: [QueueTransport, ...(QUEUE_TRANSPORT === 'zmq' ? [ZmqWorkerRegistryService] : [])],
})
export class TransportModule {}
