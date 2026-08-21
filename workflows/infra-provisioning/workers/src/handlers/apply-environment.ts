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
 * Apply Environment Worker Lambda Handler
 *
 * This lambda receives environment data from the orchestrator, applies transformations
 * to convert from source format to target system format,
 * and sends the transformed data back via HTTP callback.
 *
 * Transformation mappings (Source -> Target):
 *   - environmentId -> sourceEnvironmentId
 *   - name -> environmentName
 *   - type -> environmentTier
 *   - region -> awsRegion
 *   - accountId -> awsAccountId
 *   - status -> provisioningStatus
 *   - createdAt -> sourceCreatedAt
 *
 * Flow:
 * 1. Receive: Get environment data from input.dependencyData.PlanEnvironment
 * 2. Transform: Convert to target schema with field renaming and normalization
 * 3. Callback: Send transformed data back to orchestrator via HTTP
 */

const STEP_NAME = "Apply Environment";

/**
 * Source environment shape (from PlanEnvironment)
 */
interface SourceEnvironment {
  environmentId: string;
  name: string;
  type: string;
  region: string;
  accountId: string;
  status: string;
  createdAt: string;
}

/**
 * Target environment shape (target format)
 */
interface TargetEnvironment {
  sourceEnvironmentId: string;
  environmentName: string;
  environmentTier: string;
  awsRegion: string;
  awsAccountId: string;
  provisioningStatus: string;
  sourceCreatedAt: string;
  transformedAt: string;
}

/**
 * Transform source environment data to target format
 */
function transformEnvironmentData(source: SourceEnvironment): TargetEnvironment {
  return {
    sourceEnvironmentId: source.environmentId,
    environmentName: source.name,
    environmentTier: source.type.toUpperCase(),
    awsRegion: source.region,
    awsAccountId: source.accountId,
    provisioningStatus: source.status,
    sourceCreatedAt: source.createdAt,
    transformedAt: new Date().toISOString(),
  };
}

/**
 * Process a single apply work message with retry tracking
 */
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

  // Send in-progress callback FIRST to signal work has started
  await sendInProgressCallback(
    callbackUrl,
    jobId,
    stepId,
    retryMetadata,
    STEP_NAME,
  );

  // Extract environment data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const planEnvironmentData = dependencyData["PlanEnvironment"] as
    | Record<string, unknown>
    | undefined;
  if (!planEnvironmentData) {
    throw new Error(
      "Missing PlanEnvironment data in dependencyData (check step dependencies)",
    );
  }

  const environmentData = planEnvironmentData.environment as SourceEnvironment;
  if (!environmentData) {
    throw new Error("Missing environment field in PlanEnvironment data");
  }

  logger.log(`Extracted environment data:`, {
    environmentId: environmentData.environmentId,
    name: environmentData.name,
    type: environmentData.type,
    region: environmentData.region,
  });

  // Check for simulated failure FIRST (before delay)
  const stepOpts = getMyTestOptions(message);
  await simulateFailure(
    stepOpts?.failureAfter,
    stepOpts?.failOnAttempts,
    retryMetadata.sqsReceiveCount,
    STEP_NAME,
  );

  // Simulate work if delay is provided (for testing/demo)
  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    // APPLY: Convert source format to target format
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedEnvironment: TargetEnvironment = transformEnvironmentData(environmentData);

    logger.log(`Transformed to target format:`, {
      environmentName: transformedEnvironment.environmentName,
      environmentTier: transformedEnvironment.environmentTier,
      awsRegion: transformedEnvironment.awsRegion,
    });

    // CALLBACK: Send transformed data to orchestrator
    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { appliedEnvironments: [transformedEnvironment] },
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

/**
 * Parse SQS record body to extract work message
 */
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

/**
 * Main Lambda Handler
 */
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
