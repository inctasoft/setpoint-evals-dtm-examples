import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SqsService } from '../aws/sqs.service';
import { EventsGateway } from './events.gateway';
import type { SqsQueueStatus } from './dtm-event.types';

const SQS_POLL_INTERVAL_MS = 5000;

@Injectable()
export class SqsStatusService {
  private readonly logger = new Logger(SqsStatusService.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly eventsGateway: EventsGateway,
  ) {
    this.logger.log('SqsStatusService initialized — polling every 5s');
  }

  @Interval(SQS_POLL_INTERVAL_MS)
  async pollAndBroadcast(): Promise<void> {
    try {
      const queueUrls = await this.sqsService.listQueues();
      this.logger.debug(`SQS poll: found ${queueUrls.length} queue(s)`);
      if (queueUrls.length === 0) return;

      const statuses: SqsQueueStatus[] = await Promise.all(
        queueUrls.map(async (url) => {
          const name = url.split('/').pop() ?? url;
          const stats = await this.sqsService.getQueueStats(url);

          // Check for a corresponding DLQ
          const dlqUrl = queueUrls.find((u) => u === `${url}-dlq`);
          let dlqCount = 0;
          if (dlqUrl) {
            const dlqStats = await this.sqsService.getQueueStats(dlqUrl);
            dlqCount = dlqStats.available;
          }

          return {
            name,
            available: stats.available,
            inFlight: stats.inFlight,
            dlq: dlqCount,
          };
        }),
      );

      // Filter out DLQ entries from the main list (they're shown as a column on their parent)
      const mainQueues = statuses.filter((s) => !s.name.endsWith('-dlq'));

      this.eventsGateway.broadcast({
        type: 'sqs_status',
        queues: mainQueues,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `SQS status poll failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
