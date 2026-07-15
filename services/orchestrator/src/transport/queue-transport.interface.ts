import { LambdaStepPayload } from '../aws/sqs.service';

export interface TaskSendResult {
  taskHandle: string;
  success: boolean;
  error?: string;
}

export interface QueueStats {
  available: number;
  inFlight: number;
  delayed: number;
}

/**
 * Pluggable queue transport interface.
 * Implementations: SqsTransport (LocalStack/AWS), CloudTasksTransport (GCP).
 */
export abstract class QueueTransport {
  abstract sendTask(queueName: string, payload: LambdaStepPayload): Promise<TaskSendResult>;

  abstract sendBulkTasks(
    tasks: Array<LambdaStepPayload & { queueName: string }>,
  ): Promise<Array<{ stepId: string } & TaskSendResult>>;

  abstract getQueueStats(queueName: string): Promise<QueueStats>;

  abstract getWorkerEndpointUrl(queueName: string): string;

  abstract healthCheck(): { healthy: boolean; message: string };
}
