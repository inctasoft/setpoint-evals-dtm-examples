import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { LambdaStepPayload } from '../aws/sqs.service';
import {
  QueueTransport,
  TaskSendResult,
  QueueStatusRow,
  TaskTransportCapabilities,
} from './queue-transport.interface';

/**
 * GCP Cloud Tasks transport.
 *
 * Queue names map to Cloud Tasks queues in `projects/{project}/locations/{location}/queues/{name}`.
 * Tasks are delivered as HTTP POST to `workerEndpointUrl/{queueName}`.
 *
 * Required env vars:
 *   GCP_PROJECT          — GCP project ID (e.g. valko-prod)
 *   GCP_LOCATION         — Cloud Tasks region (e.g. us-central1)
 *   DTM_WORKER_ENDPOINT  — Base URL for worker HTTP endpoint
 *                          (e.g. https://your-worker-<hash>.run.app)
 *   CLOUD_TASKS_ENDPOINT — Optional emulator endpoint (e.g. http://cloud-tasks-emulator:8123)
 */
@Injectable()
export class CloudTasksTransport extends QueueTransport implements OnModuleInit {
  // Cloud Tasks exposes no per-queue depth API — declare it honestly so the
  // monitor panel shows nothing rather than fabricated zeros.
  // Redelivery is native (retryConfig), but there is no native DLQ and no
  // attempt count reaches the orchestrator (nothing reads the GCP dispatch
  // headers), so those two axes declare the honest table/synthetic values.
  readonly capabilities: TaskTransportCapabilities = {
    stats: 'none',
    redelivery: 'bus',
    attemptCounter: 'synthetic',
    dlq: 'table',
  };

  private readonly logger = new Logger(CloudTasksTransport.name);
  private client: CloudTasksClient;
  private readonly project: string;
  private readonly location: string;
  private readonly workerEndpoint: string;
  private readonly emulatorEndpoint: string | undefined;

  constructor() {
    super();
    this.project = process.env.GCP_PROJECT || 'valko-local';
    this.location = process.env.GCP_LOCATION || 'local';
    this.workerEndpoint = (process.env.DTM_WORKER_ENDPOINT || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    this.emulatorEndpoint = process.env.CLOUD_TASKS_ENDPOINT;
  }

  async onModuleInit() {
    const clientOptions = this.emulatorEndpoint
      ? {
          apiEndpoint: this.emulatorEndpoint,
          port: parseInt(this.emulatorEndpoint.split(':').pop() || '8123', 10),
          servicePath: this.emulatorEndpoint.replace(/^https?:\/\//, '').split(':')[0],
        }
      : {};

    this.client = new CloudTasksClient(clientOptions as any);
    this.logger.log(
      `CloudTasksTransport initialized. project=${this.project} location=${this.location} emulator=${this.emulatorEndpoint ?? 'none'}`,
    );
  }

  private queuePath(queueName: string): string {
    return this.client.queuePath(this.project, this.location, queueName);
  }

  async sendTask(queueName: string, payload: LambdaStepPayload): Promise<TaskSendResult> {
    const workerUrl = `${this.workerEndpoint}/dtm/worker/execute-chunk`;
    const body = Buffer.from(JSON.stringify(payload)).toString('base64');

    try {
      const [response] = await this.client.createTask({
        parent: this.queuePath(queueName),
        task: {
          httpRequest: {
            httpMethod: 'POST' as any,
            url: workerUrl,
            headers: { 'Content-Type': 'application/json' },
            body,
          },
        },
      });

      const taskName = response.name ?? 'unknown';
      this.logger.log(`Cloud Task created: ${taskName} for step ${payload.stepId}`);
      return { taskHandle: taskName, success: true };
    } catch (error: any) {
      this.logger.error(`Failed to create Cloud Task for step ${payload.stepId}: ${error.message}`);
      return { taskHandle: '', success: false, error: error.message };
    }
  }

  async getQueueStatuses(): Promise<QueueStatusRow[]> {
    // Cloud Tasks exposes no per-queue message counts via API (capabilities.stats
    // === 'none'); the panel shows nothing rather than fake zeros. Monitoring of
    // Cloud Tasks depth is via GCP Console / Cloud Monitoring.
    return [];
  }

  getWorkerEndpointUrl(_queueName: string): string {
    return this.workerEndpoint;
  }

  healthCheck(): { healthy: boolean; message: string } {
    return {
      healthy: !!this.client,
      message: `Cloud Tasks transport (project=${this.project}, location=${this.location})`,
    };
  }
}
