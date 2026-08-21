import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { QueueTransport } from '../transport/queue-transport.interface';
import { EventsGateway } from './events.gateway';
import type { SqsQueueStatus } from './dtm-event.types';

const SQS_POLL_INTERVAL_MS = 5000;

/**
 * Feeds the task-bus status panel over the websocket. Routes through the
 * `QueueTransport` abstraction (NOT SqsService directly) and is gated on the
 * transport's declared `stats` capability, so under a stats-less profile
 * (Cloud Tasks / zmq) it neither requires the AWS module nor emits fake rows.
 */
@Injectable()
export class SqsStatusService {
  private readonly logger = new Logger(SqsStatusService.name);

  constructor(
    private readonly transport: QueueTransport,
    private readonly eventsGateway: EventsGateway,
  ) {
    const stats = this.transport.capabilities.stats;
    this.logger.log(
      stats === 'native'
        ? 'SqsStatusService initialized — polling task-bus stats every 5s'
        : `SqsStatusService initialized — transport stats capability is '${stats}', panel polling disabled`,
    );
  }

  @Interval(SQS_POLL_INTERVAL_MS)
  async pollAndBroadcast(): Promise<void> {
    // Capability gate: a transport that can't report queue depth does no work
    // and broadcasts nothing (the panel renders empty, not fabricated zeros).
    if (this.transport.capabilities.stats === 'none') return;

    try {
      const queues: SqsQueueStatus[] = await this.transport.getQueueStatuses();
      this.logger.debug(`task-bus poll: ${queues.length} queue(s)`);
      if (queues.length === 0) return;

      this.eventsGateway.broadcast({
        type: 'sqs_status',
        queues,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `task-bus status poll failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
