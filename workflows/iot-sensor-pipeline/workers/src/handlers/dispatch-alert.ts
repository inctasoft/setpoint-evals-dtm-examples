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
 * Dispatch Alert Worker Lambda Handler
 *
 * This lambda receives alert data from the orchestrator, dispatches alert
 * notifications by converting from source format to target format, and sends
 * the dispatched data back via HTTP callback.
 *
 * Dependencies: EvaluateAlert, ProvisionDevice
 *
 * Transformation mappings (Source -> Target):
 *   - alertId -> sourceAlertId
 *   - deviceId -> sourceDeviceId
 *   - sensorId -> sourceSensorId
 *   - severity -> alertSeverity (UPPERCASED)
 *   - message -> alertDescription
 *   - triggeredAt -> triggerTimestamp
 *   - acknowledgedAt -> acknowledgementTimestamp
 *   - resolvedAt -> resolutionTimestamp
 */

const STEP_NAME = "Dispatch Alert";

/**
 * Source alert shape (from EvaluateAlert)
 */
interface SourceAlert {
  alertId: number;
  deviceId: string;
  sensorId: string | null;
  severity: string;
  message: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

/**
 * Target alert shape (target format)
 */
interface TargetAlert {
  sourceAlertId: number;
  sourceDeviceId: string;
  sourceSensorId: string | null;
  alertSeverity: string;
  alertDescription: string;
  triggerTimestamp: string;
  acknowledgementTimestamp: string | null;
  resolutionTimestamp: string | null;
  isResolved: boolean;
  transformedAt: string;
}

/**
 * Transform source alert data to target format
 */
function transformAlertData(source: SourceAlert): TargetAlert {
  return {
    sourceAlertId: source.alertId,
    sourceDeviceId: source.deviceId,
    sourceSensorId: source.sensorId || null,
    alertSeverity: source.severity.toUpperCase(),
    alertDescription: source.message,
    triggerTimestamp: source.triggeredAt,
    acknowledgementTimestamp: source.acknowledgedAt || null,
    resolutionTimestamp: source.resolvedAt || null,
    isResolved: source.resolvedAt !== null,
    transformedAt: new Date().toISOString(),
  };
}

/**
 * Process a single dispatch work message with retry tracking
 */
async function processProcessingWork(
  message: ProcessingWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing dispatch work`, {
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

  // Extract alert data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const evaluateAlertData = dependencyData["EvaluateAlert"] as
    | Record<string, unknown>
    | undefined;
  if (!evaluateAlertData) {
    throw new Error(
      "Missing EvaluateAlert data in dependencyData (check step dependencies)",
    );
  }

  const alertsRaw = evaluateAlertData.alerts as SourceAlert[];
  if (!alertsRaw || !Array.isArray(alertsRaw)) {
    throw new Error("Missing or invalid alerts field in EvaluateAlert data");
  }

  logger.log(`Extracted ${alertsRaw.length} alert(s) for dispatching`);

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
    const transformedAlerts: TargetAlert[] = alertsRaw.map(transformAlertData);

    logger.log(`Dispatched ${transformedAlerts.length} alert(s) to target format`);

    logger.log(`Sending dispatched data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { dispatchedAlerts: transformedAlerts, count: transformedAlerts.length },
      transformedAlerts.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Dispatch processing completed successfully!`);
  } catch (error) {
    logger.error(`Dispatch processing failed:`, error);

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

        await processProcessingWork(message, retryMetadata, logger);

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
