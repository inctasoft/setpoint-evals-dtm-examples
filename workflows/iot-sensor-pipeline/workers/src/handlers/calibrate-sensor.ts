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
 * Calibrate Sensor Worker Lambda Handler (Fan-Out Child)
 *
 * This lambda calibrates a single sensor by extracting it from the source
 * database and validating its measurement parameters.
 * It is invoked as a child step from DiscoverSensors fan-out.
 *
 * Input:
 *   { sensorId: "sensor-001" } - single sensor from discovery
 *
 * Output:
 *   { sensor: { ... full sensor data ... } }
 */

const STEP_NAME = "Calibrate Sensor";

/**
 * Extract a single sensor from the source database
 */
async function extractSensorData(
  sensorId: string,
  logger: WorkerLogger,
): Promise<Sensor | null> {
  if (!IotSensorDataSource.isInitialized) {
    logger.log(`Initializing iot-sensor-pipeline database connection...`);
    await IotSensorDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = IotSensorDataSource.getRepository(Sensor);

  logger.log(`Querying sensor_id:`, sensorId);
  const sensor = await repository.findOne({
    where: { sensorId },
  });

  if (!sensor) {
    logger.warn(`Sensor not found:`, sensorId);
    return null;
  }

  logger.log(`Sensor found:`, {
    sensorId: sensor.sensorId,
    deviceId: sensor.deviceId,
    type: sensor.type,
    unit: sensor.unit,
    status: sensor.status,
  });

  return sensor;
}

/**
 * Process a single calibrate work message with retry tracking
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
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing calibrate work`, {
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

  // Extract sensor ID from input (fan-out child receives this from discovery)
  const sensorIdRaw = input.sensorId as string | undefined;
  if (!sensorIdRaw) {
    throw new Error("sensorId is required in input for sensor calibration");
  }

  const sensorId = String(sensorIdRaw);

  // Log fan-out context if available
  const fanOutContext = input._fanOut as
    | { parentStepId: string; childIndex: number; totalChildren: number }
    | undefined;
  if (fanOutContext) {
    logger.log(`Fan-out context:`, fanOutContext);
  }

  logger.log(`Extracted filter value:`, { sensorId });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(
    stepOpts?.failureAfter,
    stepOpts?.failOnAttempts,
    retryMetadata.sqsReceiveCount,
    STEP_NAME,
  );

  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Calibrating sensor from iot-sensor-pipeline database...`);
    const sensorData = await extractSensorData(sensorId, logger);

    if (!sensorData) {
      throw new Error(`Sensor ${sensorId} not found in source database`);
    }

    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { sensor: sensorData },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Calibrate processing completed successfully!`);
  } catch (error) {
    logger.error(`Calibrate processing failed:`, error);

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
