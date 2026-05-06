import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { LambdaStepPayload } from '../aws/sqs.service';
import { QueueTransport, TaskSendResult, QueueStats } from './queue-transport.interface';

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
 *                          (e.g. https://voice-assistant-<hash>.run.app)
 *   CLOUD_TASKS_ENDPOINT — Optional emulator endpoint (e.g. http://cloud-tasks-emulator:8123)
 */
@Injectable()
export class CloudTasksTransport extends QueueTransport implements OnModuleInit {
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
    this.workerEndpoint = (
      process.env.DTM_WORKER_ENDPOINT || 'http://localhost:3000'
    ).replace(/\/$/, '');
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

  async sendBulkTasks(
    tasks: Array<LambdaStepPayload & { queueName: string }>,
  ): Promise<Array<{ stepId: string } & TaskSendResult>> {
    return Promise.all(
      tasks.map(async (t) => {
        const result = await this.sendTask(t.queueName, t);
        return { stepId: t.stepId, ...result };
      }),
    );
  }

  async getQueueStats(_queueName: string): Promise<QueueStats> {
    // Cloud Tasks doesn't expose per-queue message counts via API.
    // Return zeros — monitoring should use GCP Console / Cloud Monitoring.
    return { available: 0, inFlight: 0, delayed: 0 };
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
