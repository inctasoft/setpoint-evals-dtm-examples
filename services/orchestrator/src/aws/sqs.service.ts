import { Injectable, Logger } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
  SendMessageCommandOutput,
  ListQueuesCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { SqsConfig } from './sqs.config';
import { JobType } from '@dtm/database';

/**
 * Payload sent to Lambda workers via SQS
 *
 * stepValue: Enum string value (e.g., 'ValidateCustomer', 'SubmitCustomer') identifying the step
 * sourceConfig: Source system configuration (connection details, table, filter key)
 * processingConfig: Processing definitions (data type, transformation list)
 *
 * Note: Each worker is dedicated to one action (determined by which queue it listens to),
 * so no 'action' field is needed in runtime. Workers receive only their relevant config.
 */
export interface LambdaStepPayload {
  jobId: string;
  stepId: string;
  stepValue: string; // String enum value (e.g., 'ValidateCustomer')
  jobType: JobType;
  input: Record<string, unknown>;
  callbackUrl: string;
  correlationId?: string; // Trace ID for distributed tracing
  /** Source configuration (for source-querying workers) */
  sourceConfig?: {
    sourceDatabase: string;
    sourceTable: string;
    filterKey: string;
  };
  /** Processing configuration (for data-processing workers) */
  processingConfig?: {
    inputDataType: string;
    transformations: string[];
  };
}

/**
 * SQS Service for sending messages to Lambda workers
 */
@Injectable()
export class SqsService {
  private readonly logger = new Logger(SqsService.name);
  private readonly sqsClient: SQSClient;

  constructor(private readonly sqsConfig: SqsConfig) {
    // Initialize SQS client
    const region = this.sqsConfig.getRegion();
    const endpoint = this.sqsConfig.getEndpoint();

    this.logger.log(`Initializing SQS client for region: ${region}`);

    const clientConfig: {
      region: string;
      endpoint?: string;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
    } = {
      region,
    };

    // For local development with localstack or explicit credentials
    if (endpoint) {
      clientConfig.endpoint = endpoint;
      this.logger.log(`Using custom SQS endpoint: ${endpoint}`);
    }

    // Use explicit credentials if provided (local dev)
    // In production (EKS), IAM roles will be used automatically
    const accessKeyId = this.sqsConfig.getAccessKeyId();
    const secretAccessKey = this.sqsConfig.getSecretAccessKey();

    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId,
        secretAccessKey,
      };
      this.logger.log('Using explicit AWS credentials');
    } else {
      this.logger.log('Using IAM role credentials (production mode)');
    }

    this.sqsClient = new SQSClient(clientConfig);
  }

  /**
   * Send a step delegation message to the appropriate SQS queue
   * Each step has its own queue/Lambda
   */
  async sendStepMessage(
    payload: LambdaStepPayload,
    queueUrl: string,
  ): Promise<{ messageId: string; success: boolean; error?: string }> {
    this.logger.log(`Sending step ${payload.stepId} (${payload.stepValue}) to queue: ${queueUrl}`);

    try {
      const messageInput: SendMessageCommandInput = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
        MessageAttributes: {
          jobId: {
            DataType: 'String',
            StringValue: payload.jobId,
          },
          stepId: {
            DataType: 'String',
            StringValue: payload.stepId,
          },
          stepValue: {
            DataType: 'String',
            StringValue: payload.stepValue,
          },
          jobType: {
            DataType: 'String',
            StringValue: payload.jobType,
          },
          ...(payload.correlationId && {
            correlationId: {
              DataType: 'String',
              StringValue: payload.correlationId,
            },
          }),
        },
      };

      const command: SendMessageCommand = new SendMessageCommand(messageInput);

      const result: SendMessageCommandOutput = await this.sqsClient.send<
        SendMessageCommandInput,
        SendMessageCommandOutput
      >(command);

      const messageId: string = result.MessageId ?? 'unknown';

      this.logger.log(`Successfully sent step ${payload.stepId} to SQS. MessageId: ${messageId}`);

      return {
        messageId,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to send step ${payload.stepId} to SQS: ${errorMessage}`,
        errorStack,
      );

      return {
        messageId: '',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send multiple step messages in bulk
   * Used when a job has multiple steps that can be processed in parallel
   */
  async sendBulkStepMessages(
    payloads: Array<LambdaStepPayload & { queueUrl: string }>,
  ): Promise<Array<{ stepId: string; messageId: string; success: boolean; error?: string }>> {
    this.logger.log(`Sending bulk messages for ${payloads.length} steps`);

    const results = await Promise.all(
      payloads.map(async (payload) => {
        const result = await this.sendStepMessage(payload, payload.queueUrl);
        return {
          stepId: payload.stepId,
          ...result,
        };
      }),
    );

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    this.logger.log(`Bulk send complete: ${successCount} succeeded, ${failureCount} failed`);

    return results;
  }

  /**
   * List all SQS queues matching a prefix (e.g. 'dtm-')
   */
  async listQueues(prefix?: string): Promise<string[]> {
    try {
      const command = new ListQueuesCommand({
        QueueNamePrefix: prefix,
      });
      const result = await this.sqsClient.send(command);
      return result.QueueUrls ?? [];
    } catch (error) {
      this.logger.error(
        `Failed to list SQS queues: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get queue attributes (message counts) for a specific queue URL
   */
  async getQueueStats(queueUrl: string): Promise<{
    available: number;
    inFlight: number;
    delayed: number;
  }> {
    try {
      const command = new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
        ],
      });
      const result = await this.sqsClient.send(command);
      const attrs = result.Attributes ?? {};
      return {
        available: parseInt(attrs.ApproximateNumberOfMessages ?? '0', 10),
        inFlight: parseInt(attrs.ApproximateNumberOfMessagesNotVisible ?? '0', 10),
        delayed: parseInt(attrs.ApproximateNumberOfMessagesDelayed ?? '0', 10),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to get queue stats for ${queueUrl}: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return { available: 0, inFlight: 0, delayed: 0 };
    }
  }

  /**
   * Health check for SQS connectivity
   * Can be called by the health endpoint
   */
  healthCheck(): {
    healthy: boolean;
    message: string;
    totalQueues: number;
  } {
    const queueUrls = this.sqsConfig.getAllQueueUrls();

    // In a real implementation, you might want to send a test message or get queue attributes
    // For now, we'll just check if the client is configured
    const healthy = !!this.sqsClient;

    return {
      healthy,
      message: healthy
        ? `SQS client is configured with ${queueUrls.length} queues`
        : 'SQS client is not configured',
      totalQueues: queueUrls.length,
    };
  }
}
