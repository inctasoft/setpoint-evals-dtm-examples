import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  IotSensorDataSource,
  Alert,
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
 * Evaluate Alert Worker Lambda Handler
 *
 * This lambda evaluates threshold conditions against readings to detect
 * anomalies by extracting alert data from the iot-sensor-pipeline source
 * database and sending it to the orchestrator via HTTP callback.
 *
 * Alerts are derived from readings that exceed sensor thresholds.
 * This step queries all alerts associated with a given device_id.
 *
 * Input:
 *   { deviceId: "device-001" }
 *
 * Output:
 *   { alerts: [ ... array of alert records ... ], count: N }
 */

const STEP_NAME = "Evaluate Alert";

/**
 * Extract alert data from the iot-sensor-pipeline source database
 */
async function extractAlertData(
  deviceId: string,
  logger: WorkerLogger,
): Promise<Alert[]> {
  if (!IotSensorDataSource.isInitialized) {
    logger.log(`Initializing iot-sensor-pipeline database connection...`);
    await IotSensorDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = IotSensorDataSource.getRepository(Alert);

  logger.log(`Querying alerts for device_id:`, deviceId);
  const alerts = await repository.find({
    where: { deviceId },
  });

  logger.log(`Found ${alerts.length} alert(s) for device ${deviceId}`);

  if (alerts.length > 0) {
    logger.log(`Alert summary:`, alerts.map((a) => ({
      alertId: a.alertId,
      severity: a.severity,
      triggeredAt: a.triggeredAt,
    })));
  }

  return alerts;
}

/**
 * Process a single evaluate work message with retry tracking
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

  logger.log(`Processing evaluate work`, {
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

  // Extract filter value — alerts are queried by device_id
  const deviceId = input.deviceId as string | undefined;
  if (!deviceId) {
    throw new Error("deviceId is required in input for alert evaluation");
  }

  logger.log(`Extracted filter value:`, { deviceId });

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
    // EVALUATE: Read from source database
    logger.log(`Evaluating alerts from iot-sensor-pipeline database...`);
    const alerts = await extractAlertData(deviceId, logger);

    // CALLBACK: Send data to orchestrator with retry metadata
    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { alerts, count: alerts.length },
      alerts.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Evaluate processing completed successfully!`);
  } catch (error) {
    logger.error(`Evaluate processing failed:`, error);

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
