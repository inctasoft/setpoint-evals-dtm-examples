import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { SqsStatusService } from './sqs-status.service';
import { TransportModule } from '../transport/transport.module';

/**
 * WebSocket module for real-time dashboard updates.
 *
 * Marked @Global so any service can inject EventsGateway
 * to broadcast events without importing this module.
 *
 * Imports TransportModule (not AwsModule) so the SQS-panel feed goes through the
 * profile-selected QueueTransport — keeping the panel wireable under a non-AWS
 * profile that provides no SqsService.
 */
@Global()
@Module({
  imports: [TransportModule],
  providers: [EventsGateway, SqsStatusService],
  exports: [EventsGateway],
})
export class WebSocketModule {}
