import { Injectable } from '@nestjs/common';
import { SqsService, LambdaStepPayload } from '../aws/sqs.service';
import { SqsConfig } from '../aws/sqs.config';
import {
  QueueTransport,
  TaskSendResult,
  QueueStatusRow,
  TaskTransportCapabilities,
} from './queue-transport.interface';

/**
 * SQS-backed queue transport (LocalStack / AWS SQS).
 * Wraps the existing SqsService to implement the QueueTransport interface.
 */
@Injectable()
export class SqsTransport extends QueueTransport {
  readonly capabilities: TaskTransportCapabilities = { stats: 'native' };

  constructor(
    private readonly sqsService: SqsService,
    private readonly sqsConfig: SqsConfig,
  ) {
    super();
  }

  async sendTask(queueName: string, payload: LambdaStepPayload): Promise<TaskSendResult> {
    const queueUrl = this.sqsConfig.getQueueUrlByName(queueName);
    const result = await this.sqsService.sendStepMessage(payload, queueUrl);
    return {
      taskHandle: result.messageId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Build the task-bus status panel rows from live SQS queue attributes.
   * (Moved here from SqsStatusService so the websocket panel feed no longer
   * couples to SqsService directly — it goes through this abstraction, which a
   * stats-less transport can honestly decline.)
   */
  async getQueueStatuses(): Promise<QueueStatusRow[]> {
    const queueUrls = await this.sqsService.listQueues();
    if (queueUrls.length === 0) return [];

    const statuses: QueueStatusRow[] = await Promise.all(
      queueUrls.map(async (url) => {
        const name = url.split('/').pop() ?? url;
        const stats = await this.sqsService.getQueueStats(url);

        // A corresponding DLQ is shown as a column on its parent, not its own row.
        const dlqUrl = queueUrls.find((u) => u === `${url}-dlq`);
        let dlqCount = 0;
        if (dlqUrl) {
          const dlqStats = await this.sqsService.getQueueStats(dlqUrl);
          dlqCount = dlqStats.available;
        }

        return { name, available: stats.available, inFlight: stats.inFlight, dlq: dlqCount };
      }),
    );

    // Drop DLQ entries from the main list (folded into their parent's dlq column).
    return statuses.filter((s) => !s.name.endsWith('-dlq'));
  }

  getWorkerEndpointUrl(_queueName: string): string {
    return this.sqsConfig.getCallbackUrl();
  }

  healthCheck(): { healthy: boolean; message: string } {
    return this.sqsService.healthCheck();
  }
}
