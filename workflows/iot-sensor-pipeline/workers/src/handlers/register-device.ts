import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  IotSensorDataSource,
  Device,
} from "@dtm-workflows/iot-sensor-pipeline-typeorm";
import {
  SourceWorkMessage,
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
 * Register Device Worker Lambda Handler
 *
 * This lambda registers an IoT device by extracting device registration data
 * from the iot-sensor-pipeline source database and validating device
 * identity/firmware, then sends it to the orchestrator via HTTP callback.
 *
 * Flow:
 * 1. Register: Read device data using TypeORM by device_id
 * 2. Callback: Send full device data to orchestrator via HTTP
 *
 * Input SQS Message Format (from orchestrator):
 * {
 *   "jobId": "uuid",
 *   "stepId": "uuid",
 *   "stepValue": "RegisterDevice",
 *   "input": {
 *     "deviceId": "device-001"
 *   },
 *   "callbackUrl": "http://orchestrator:3000/api/v1/callback/step-progress",
 *   "sourceConfig": {
 *     "sourceDatabase": "iot_sensor_pipeline",
 *     "sourceTable": "dbo.devices",
 *     "filterKey": "deviceId"
 *   }
 * }
 */

const STEP_NAME = "Register Device";

/**
 * Extract device data from the iot-sensor-pipeline source database
 */
async function extractDeviceData(
  deviceId: string,
  logger: WorkerLogger,
): Promise<Device | null> {
  if (!IotSensorDataSource.isInitialized) {
    logger.log(`Initializing iot-sensor-pipeline database connection...`);
    await IotSensorDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = IotSensorDataSource.getRepository(Device);

  logger.log(`Querying device_id:`, deviceId);
  const device = await repository.findOne({
    where: { deviceId },
  });

  if (!device) {
    logger.warn(`Device not found:`, deviceId);
    return null;
  }

  logger.log(`Device found:`, {
    deviceId: device.deviceId,
    name: device.name,
    type: device.type,
    location: device.location,
    status: device.status,
  });

  return device;
}

/**
 * Process a single register work message with retry tracking
 */
async function processSourceWork(
  message: SourceWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, sourceConfig, callbackUrl } = message;

  logger.log(`Processing register work`, {
    jobId,
    stepId,
    sourceConfig,
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

  // Validate source configuration
  if (!sourceConfig) {
    throw new Error("Source configuration is required for register action");
  }

  // Extract the filter value from input using the filterKey
  const filterValue = input[sourceConfig.filterKey];
  if (!filterValue) {
    throw new Error(
      `Missing filter value for key '${sourceConfig.filterKey}'`,
    );
  }

  const deviceId = String(filterValue);

  logger.log(`Extracted filter value:`, {
    filterKey: sourceConfig.filterKey,
    deviceId,
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
    // REGISTER: Read from source database
    logger.log(`Registering device from iot-sensor-pipeline database...`);
    const deviceData = await extractDeviceData(deviceId, logger);

    if (!deviceData) {
      throw new Error(`Device ${deviceId} not found in source database`);
    }

    // CALLBACK: Send full data to orchestrator with retry metadata
    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { device: deviceData },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Register processing completed successfully!`);
  } catch (error) {
    logger.error(`Register processing failed:`, error);

    // Send failure callback with retry metadata
    await sendFailureCallback(
      callbackUrl,
      jobId,
      stepId,
      error as Error,
      retryMetadata,
      STEP_NAME,
    );

    // Re-throw to mark Lambda execution as failed
    (error as any).callbackSent = true;
    throw error;
  }
}

/**
 * Parse SQS record body to extract work message
 */
function parseMessage(record: SQSRecord): SourceWorkMessage {
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

    if (!bodyObj.sourceConfig) {
      throw new Error("Source worker requires sourceConfig");
    }

    return bodyObj as unknown as SourceWorkMessage;
  } catch (error) {
    console.error(`[${STEP_NAME}] Failed to parse message:`, error);
    throw new Error(
      `Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Main Lambda Handler
 *
 * Processes SQS messages containing register work requests.
 * Handles batch processing with partial failure tracking.
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
      let message: SourceWorkMessage | null = null;
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

        await processSourceWork(message, retryMetadata, logger);

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
  } finally {
    if (IotSensorDataSource.isInitialized) {
      try {
        await IotSensorDataSource.destroy();
        console.log(`[${STEP_NAME}] Database connection closed`);
      } catch (error) {
        console.error(
          `[${STEP_NAME}] Failed to close database connection:`,
          error,
        );
      }
    }
  }

  return { batchItemFailures };
}

export default handler;
