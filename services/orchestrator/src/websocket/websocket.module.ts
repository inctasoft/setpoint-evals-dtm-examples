import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { SqsStatusService } from './sqs-status.service';
import { AwsModule } from '../aws/aws.module';

/**
 * WebSocket module for real-time dashboard updates.
 *
 * Marked @Global so any service can inject EventsGateway
 * to broadcast events without importing this module.
 */
@Global()
@Module({
  imports: [AwsModule],
  providers: [EventsGateway, SqsStatusService],
  exports: [EventsGateway],
})
export class WebSocketModule {}
