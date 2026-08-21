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
 * Apply Network Worker Lambda Handler
 *
 * Receives network data from the orchestrator, applies transformations
 * to convert from source format to target provisioning format.
 *
 * Dependencies: PlanNetwork
 *
 * Transformation mappings (Source -> Target):
 *   - networkId -> sourceNetworkId
 *   - environmentId -> sourceEnvironmentId
 *   - name -> vpcName
 *   - vpcCidr -> vpcCidrBlock
 *   - subnetCidr -> subnetCidrBlock
 *   - availabilityZone -> az
 *   - status -> provisioningStatus
 */

const STEP_NAME = "Apply Network";

interface SourceNetwork {
  networkId: string;
  environmentId: string;
  name: string;
  vpcCidr: string;
  subnetCidr: string;
  availabilityZone: string;
  status: string;
  createdAt: string;
}

interface TargetNetwork {
  sourceNetworkId: string;
  sourceEnvironmentId: string;
  vpcName: string;
  vpcCidrBlock: string;
  subnetCidrBlock: string;
  az: string;
  provisioningStatus: string;
  sourceCreatedAt: string;
  transformedAt: string;
}

function transformNetworkData(source: SourceNetwork): TargetNetwork {
  return {
    sourceNetworkId: source.networkId,
    sourceEnvironmentId: source.environmentId,
    vpcName: source.name,
    vpcCidrBlock: source.vpcCidr,
    subnetCidrBlock: source.subnetCidr,
    az: source.availabilityZone,
    provisioningStatus: source.status,
    sourceCreatedAt: source.createdAt,
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

  logger.log(`Processing apply work`, {
    jobId,
    stepId,
    inputKeys: Object.keys(input),
  });

  await sendInProgressCallback(
    callbackUrl,
    jobId,
    stepId,
    retryMetadata,
    STEP_NAME,
  );

  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const planNetworkData = dependencyData["PlanNetwork"] as
    | Record<string, unknown>
    | undefined;
  if (!planNetworkData) {
    throw new Error(
      "Missing PlanNetwork data in dependencyData (check step dependencies)",
    );
  }

  const networkData = planNetworkData.network as SourceNetwork;
  if (!networkData) {
    throw new Error("Missing network field in PlanNetwork data");
  }

  logger.log(`Extracted network data:`, {
    networkId: networkData.networkId,
    name: networkData.name,
    vpcCidr: networkData.vpcCidr,
  });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(
    stepOpts?.failureAfter,
    stepOpts?.failOnAttempts,
    retryMetadata.sqsReceiveCount,
    STEP_NAME,
  );

  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedNetwork: TargetNetwork = transformNetworkData(networkData);

    logger.log(`Transformed to target format:`, {
      vpcName: transformedNetwork.vpcName,
      vpcCidrBlock: transformedNetwork.vpcCidrBlock,
      az: transformedNetwork.az,
    });

    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { appliedNetworks: [transformedNetwork] },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Apply processing completed successfully!`);
  } catch (error) {
    logger.error(`Apply processing failed:`, error);

    await sendFailureCallback(
      callbackUrl,
      jobId,
      stepId,
      error as Error,
      retryMetadata,
      STEP_NAME,
    );

    (error as any).callbackSent = true;
    throw error;
  }
}

function parseMessage(record: SQSRecord): ProcessingWorkMessage {
  try {
    const body = JSON.parse(record.body) as unknown;

    if (typeof body !== "object" || body === null) {
      throw new Error("Message body is not an object");
    }

    const bodyObj = body as Record<string, unknown>;

    if (
      !bodyObj.jobId ||
      !bodyObj.stepId ||
      !bodyObj.input ||
      !bodyObj.callbackUrl
    ) {
      throw new Error(
        "Missing required fields: jobId, stepId, input, or callbackUrl",
      );
    }

    return bodyObj as unknown as ProcessingWorkMessage;
  } catch (error) {
    console.error(`[${STEP_NAME}] Failed to parse message:`, error);
    throw new Error(
      `Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<SQSBatchResponse> {
  const recordCount = event.Records ? event.Records.length : 0;
  console.log(`[${STEP_NAME}] Lambda invoked with`, recordCount, "record(s)");
  console.log(`[${STEP_NAME}] Request ID:`, context.awsRequestId);

  const batchItemFailures: { itemIdentifier: string }[] = [];

  if (recordCount === 0) {
    console.log(
      `[${STEP_NAME}] Empty event received (likely warmup), returning success`,
    );
    return { batchItemFailures: [] };
  }

  try {
    for (const record of event.Records) {
      let message: ProcessingWorkMessage | null = null;
      const processingStartTime = Date.now();

      const sqsAttributes = getSQSMessageAttributes(record);

      console.log(
        `[${STEP_NAME}] Processing message (attempt ${sqsAttributes.receiveCount})`,
      );

      try {
        message = parseMessage(record);

        const logger = createLogger(message.correlationId, STEP_NAME);

        const retryMetadata = buildRetryMetadata(
          sqsAttributes,
          processingStartTime,
        );

        await processApplyWork(message, retryMetadata, logger);

        logger.log(`Message ${record.messageId} processed successfully`);
      } catch (error) {
        const errorLogger = createLogger(undefined, STEP_NAME);

        errorLogger.error(
          `Message ${record.messageId} processing failed:`,
          error,
        );
        errorLogger.error("Record body:", record.body);

        if (message && !(error as any).callbackSent) {
          const retryMetadata = buildRetryMetadata(
            sqsAttributes,
            processingStartTime,
          );

          try {
            await sendFailureCallback(
              message.callbackUrl,
              message.jobId,
              message.stepId,
              error as Error,
              retryMetadata,
              STEP_NAME,
            );
            errorLogger.log(
              `Failure callback sent for message ${record.messageId}`,
            );
          } catch (callbackError) {
            errorLogger.error(
              `Failed to send failure callback for message ${record.messageId}:`,
              callbackError,
            );
          }
        }

        batchItemFailures.push(createBatchItemFailure(record.messageId));
      }
    }

    const total = event.Records.length;
    const succeeded = total - batchItemFailures.length;

    console.log(`[${STEP_NAME}] Batch processing complete:`, {
      total,
      succeeded,
      failed: batchItemFailures.length,
    });
  } catch (error) {
    console.error(
      `[${STEP_NAME}] FATAL: Top-level error in handler:`,
      error,
    );

    for (const record of event.Records) {
      batchItemFailures.push(createBatchItemFailure(record.messageId));
    }
  }

  return { batchItemFailures };
}

export default handler;
