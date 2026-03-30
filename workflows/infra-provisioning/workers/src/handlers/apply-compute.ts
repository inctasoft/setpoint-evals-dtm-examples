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
 * Apply Compute Worker Lambda Handler (Fan-Out Child, Long ACK Timeout)
 *
 * Receives compute instance data from the orchestrator, applies transformations
 * to convert from source format to target provisioning format.
 *
 * This step has a long ACK timeout (600000ms / 10 minutes) configured in
 * workflow.config.ts metadata to simulate lengthy compute provisioning operations.
 *
 * Dependencies: PlanCompute
 *
 * Transformation mappings (Source -> Target):
 *   - instanceId -> sourceInstanceId
 *   - networkId -> sourceNetworkId
 *   - name -> instanceName
 *   - instanceType -> ec2InstanceType
 *   - amiId -> sourceAmiId
 *   - publicIp -> publicIpAddress
 *   - privateIp -> privateIpAddress
 *   - status -> provisioningStatus
 */

const STEP_NAME = "Apply Compute";

interface SourceComputeInstance {
  instanceId: string;
  networkId: string;
  name: string;
  instanceType: string;
  amiId: string;
  status: string;
  publicIp: string | null;
  privateIp: string;
  createdAt: string;
}

interface TargetComputeInstance {
  sourceInstanceId: string;
  sourceNetworkId: string;
  instanceName: string;
  ec2InstanceType: string;
  sourceAmiId: string;
  publicIpAddress: string | null;
  privateIpAddress: string;
  provisioningStatus: string;
  securityGroupAssignment: string;
  sourceCreatedAt: string;
  transformedAt: string;
}

function transformComputeData(source: SourceComputeInstance): TargetComputeInstance {
  return {
    sourceInstanceId: source.instanceId,
    sourceNetworkId: source.networkId,
    instanceName: source.name,
    ec2InstanceType: source.instanceType,
    sourceAmiId: source.amiId,
    publicIpAddress: source.publicIp || null,
    privateIpAddress: source.privateIp,
    provisioningStatus: source.status,
    securityGroupAssignment: `sg-${source.networkId}-default`,
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

  const planComputeData = dependencyData["PlanCompute"] as
    | Record<string, unknown>
    | undefined;
  if (!planComputeData) {
    throw new Error(
      "Missing PlanCompute data in dependencyData (check step dependencies)",
    );
  }

  const computeData = planComputeData.computeInstance as SourceComputeInstance;
  if (!computeData) {
    throw new Error("Missing computeInstance field in PlanCompute data");
  }

  logger.log(`Extracted compute data:`, {
    instanceId: computeData.instanceId,
    name: computeData.name,
    instanceType: computeData.instanceType,
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
    const transformedCompute: TargetComputeInstance = transformComputeData(computeData);

    logger.log(`Transformed to target format:`, {
      instanceName: transformedCompute.instanceName,
      ec2InstanceType: transformedCompute.ec2InstanceType,
      securityGroupAssignment: transformedCompute.securityGroupAssignment,
    });

    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { appliedCompute: [transformedCompute] },
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
