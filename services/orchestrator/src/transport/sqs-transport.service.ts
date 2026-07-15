import { Injectable } from '@nestjs/common';
import { SqsService, LambdaStepPayload } from '../aws/sqs.service';
import { SqsConfig } from '../aws/sqs.config';
import { QueueTransport, TaskSendResult, QueueStats } from './queue-transport.interface';

/**
 * SQS-backed queue transport (LocalStack / AWS SQS).
 * Wraps the existing SqsService to implement the QueueTransport interface.
 */
@Injectable()
export class SqsTransport extends QueueTransport {
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

  async sendBulkTasks(
    tasks: Array<LambdaStepPayload & { queueName: string }>,
  ): Promise<Array<{ stepId: string } & TaskSendResult>> {
    // Resolve queueName -> queueUrl per task, mirroring sendTask() above —
    // sendBulkStepMessages() needs the resolved queueUrl, not the queueName.
    const payloads = tasks.map(({ queueName, ...payload }) => ({
      ...payload,
      queueUrl: this.sqsConfig.getQueueUrlByName(queueName),
    }));
    const results = await this.sqsService.sendBulkStepMessages(payloads);
    return results.map((r) => ({
      stepId: r.stepId,
      taskHandle: r.messageId,
      success: r.success,
      error: r.error,
    }));
  }

  async getQueueStats(queueName: string): Promise<QueueStats> {
    const queueUrl = this.sqsConfig.getQueueUrlByName(queueName);
    return this.sqsService.getQueueStats(queueUrl);
  }

  getWorkerEndpointUrl(_queueName: string): string {
    return this.sqsConfig.getCallbackUrl();
  }

  healthCheck(): { healthy: boolean; message: string } {
    return this.sqsService.healthCheck();
  }
}
