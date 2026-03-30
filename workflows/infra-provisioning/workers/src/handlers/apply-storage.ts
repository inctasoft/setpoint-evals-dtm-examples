import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  ProcessingWorkMessage,
  simulateWork,
  simulateFailure,
  sendInProgressCallback,
  sendSuccessCallback,
  sendFailureCallback,
  getSQSMessageAttributes,
  createBatchItemFailure,
  buildRetryMetadata,
  getMyTestOptions,
  SQSBatchResponse,
  createLogger,
  WorkerLogger,
} from "@dtm/worker-sdk";

/**
 * Apply Storage Worker Lambda Handler
 *
 * Receives storage volume data from the orchestrator, applies transformations
 * to convert from source format to target provisioning format.
 *
 * Dependencies: PlanStorage
 *
 * Transformation mappings (Source -> Target):
 *   - volumeId -> sourceVolumeId
 *   - instanceId -> sourceInstanceId
 *   - name -> volumeName
 *   - sizeGb -> volumeSizeGb
 *   - volumeType -> ebsVolumeType
 *   - iops -> provisionedIops
 *   - status -> provisioningStatus
 */

const STEP_NAME = "Apply Storage";

interface SourceStorageVolume {
  volumeId: string;
  instanceId: string;
  name: string;
  sizeGb: number;
  volumeType: string;
  iops: number | null;
  status: string;
  attachedAt: string | null;
}

interface TargetStorageVolume {
  sourceVolumeId: string;
  sourceInstanceId: string;
  volumeName: string;
  volumeSizeGb: number;
  ebsVolumeType: string;
  provisionedIops: number | null;
  provisioningStatus: string;
  sourceAttachedAt: string | null;
  transformedAt: string;
}

function transformStorageData(source: SourceStorageVolume): TargetStorageVolume {
  return {
    sourceVolumeId: source.volumeId,
    sourceInstanceId: source.instanceId,
    volumeName: source.name,
    volumeSizeGb: source.sizeGb,
    ebsVolumeType: source.volumeType.toUpperCase(),
    provisionedIops: source.iops,
    provisioningStatus: source.status,
    sourceAttachedAt: source.attachedAt,
    transformedAt: new Date().toISOString(),
  };
}

async function processApplyWork(
  message: ProcessingWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing apply work`, { jobId, stepId, inputKeys: Object.keys(input) });

  await sendInProgressCallback(callbackUrl, jobId, stepId, retryMetadata, STEP_NAME);

  const dependencyData = input.dependencyData as Record<string, Record<string, unknown>> | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const planStorageData = dependencyData["PlanStorage"] as Record<string, unknown> | undefined;
  if (!planStorageData) {
    throw new Error("Missing PlanStorage data in dependencyData (check step dependencies)");
  }

  const storageData = planStorageData.storageVolume as SourceStorageVolume;
  if (!storageData) {
    throw new Error("Missing storageVolume field in PlanStorage data");
  }

  logger.log(`Extracted storage data:`, {
    volumeId: storageData.volumeId,
    name: storageData.name,
    sizeGb: storageData.sizeGb,
    volumeType: storageData.volumeType,
  });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(stepOpts?.failureAfter, stepOpts?.failOnAttempts, retryMetadata.sqsReceiveCount, STEP_NAME);
  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedStorage: TargetStorageVolume = transformStorageData(storageData);

    logger.log(`Transformed to target format:`, {
      volumeName: transformedStorage.volumeName,
      ebsVolumeType: transformedStorage.ebsVolumeType,
      volumeSizeGb: transformedStorage.volumeSizeGb,
    });

    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(callbackUrl, jobId, stepId, { appliedStorage: [transformedStorage] }, 1, retryMetadata, STEP_NAME);

    logger.log(`Apply processing completed successfully!`);
  } catch (error) {
    logger.error(`Apply processing failed:`, error);
    await sendFailureCallback(callbackUrl, jobId, stepId, error as Error, retryMetadata, STEP_NAME);
    (error as any).callbackSent = true;
    throw error;
  }
}

function parseMessage(record: SQSRecord): ProcessingWorkMessage {
  try {
    const body = JSON.parse(record.body) as unknown;
    if (typeof body !== "object" || body === null) throw new Error("Message body is not an object");
    const bodyObj = body as Record<string, unknown>;
    if (!bodyObj.jobId || !bodyObj.stepId || !bodyObj.input || !bodyObj.callbackUrl) {
      throw new Error("Missing required fields: jobId, stepId, input, or callbackUrl");
    }
    return bodyObj as unknown as ProcessingWorkMessage;
  } catch (error) {
    console.error(`[${STEP_NAME}] Failed to parse message:`, error);
    throw new Error(`Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  const recordCount = event.Records ? event.Records.length : 0;
  console.log(`[${STEP_NAME}] Lambda invoked with`, recordCount, "record(s)");
  console.log(`[${STEP_NAME}] Request ID:`, context.awsRequestId);

  const batchItemFailures: { itemIdentifier: string }[] = [];
  if (recordCount === 0) return { batchItemFailures: [] };

  try {
    for (const record of event.Records) {
      let message: ProcessingWorkMessage | null = null;
      const processingStartTime = Date.now();
      const sqsAttributes = getSQSMessageAttributes(record);

      try {
        message = parseMessage(record);
        const logger = createLogger(message.correlationId, STEP_NAME);
        const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
        await processApplyWork(message, retryMetadata, logger);
        logger.log(`Message ${record.messageId} processed successfully`);
      } catch (error) {
        const errorLogger = createLogger(undefined, STEP_NAME);
        errorLogger.error(`Message ${record.messageId} processing failed:`, error);

        if (message && !(error as any).callbackSent) {
          const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
          try {
            await sendFailureCallback(message.callbackUrl, message.jobId, message.stepId, error as Error, retryMetadata, STEP_NAME);
          } catch (callbackError) {
            errorLogger.error(`Failed to send failure callback:`, callbackError);
          }
        }
        batchItemFailures.push(createBatchItemFailure(record.messageId));
      }
    }
    console.log(`[${STEP_NAME}] Batch processing complete:`, { total: event.Records.length, failed: batchItemFailures.length });
  } catch (error) {
    console.error(`[${STEP_NAME}] FATAL: Top-level error in handler:`, error);
    for (const record of event.Records) {
      batchItemFailures.push(createBatchItemFailure(record.messageId));
    }
  }

  return { batchItemFailures };
}

export default handler;
