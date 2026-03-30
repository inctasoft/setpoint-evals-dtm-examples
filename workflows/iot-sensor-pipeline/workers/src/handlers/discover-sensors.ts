import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  IotSensorDataSource,
  Sensor,
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
 * Discover Sensors Worker Lambda Handler (Fan-Out Pattern)
 *
 * This is a LIGHTWEIGHT discovery lambda that returns ONLY sensor IDs.
 * It does NOT fetch full sensor data - that's the job of CalibrateSensor.
 *
 * PURPOSE: Enable fan-out pattern for one-to-many relationships.
 * The orchestrator will create individual CalibrateSensor steps for each ID returned.
 *
 * Flow:
 * 1. Query source database for sensor IDs matching device_id
 * 2. Return array of sensor IDs (NOT full data)
 * 3. Orchestrator creates child steps: CalibrateSensor(1), CalibrateSensor(2), etc.
 *
 * Output (sent to orchestrator via callback):
 * {
 *   "sensorIds": ["sensor-001", "sensor-002", "sensor-003"],
 *   "count": 3
 * }
 */

const STEP_NAME = "Discover Sensors";

/**
 * Discover sensor IDs from the source database (lightweight query - IDs only)
 */
async function discoverSensorIds(
  deviceId: string,
  logger: WorkerLogger,
): Promise<string[]> {
  if (!IotSensorDataSource.isInitialized) {
    logger.log(`Initializing iot-sensor-pipeline database connection...`);
    await IotSensorDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = IotSensorDataSource.getRepository(Sensor);

  // LIGHTWEIGHT QUERY: Only select sensor_id, not full records
  logger.log(`Discovering sensor IDs for device_id ${deviceId}...`);
  const sensors = await repository.find({
    select: ["sensorId"],
    where: { deviceId },
  });

  const sensorIds = sensors.map((s) => String(s.sensorId));
  logger.log(
    `Discovered ${sensorIds.length} sensor(s) for device ${deviceId}`,
    {
      deviceId,
      sensorIds,
    },
  );

  return sensorIds;
}

/**
 * Process a single discovery work message with retry tracking
 */
async function processDiscoveryWork(
  message: SourceWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing discovery work`, {
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

  // Extract filter field
  const deviceId = input.deviceId as string | undefined;

  if (!deviceId) {
    throw new Error(
      "deviceId is required in input for sensor discovery",
    );
  }

  logger.log(`Discovery parameters:`, { deviceId });

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
    // DISCOVER: Query source database for sensor IDs only
    logger.log(`Discovering sensors from source database...`);
    const sensorIds = await discoverSensorIds(deviceId, logger);

    // NOTE: Empty result is valid - some devices may have no sensors
    // The orchestrator will handle this gracefully (childCount: 0)

    // CALLBACK: Send sensor IDs to orchestrator
    logger.log(`Sending discovery results to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      {
        sensorIds,
        count: sensorIds.length,
      },
      sensorIds.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Discovery completed: ${sensorIds.length} sensor(s) found`);
  } catch (error) {
    logger.error(`Discovery failed:`, error);

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

        await processDiscoveryWork(message, retryMetadata, logger);

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
