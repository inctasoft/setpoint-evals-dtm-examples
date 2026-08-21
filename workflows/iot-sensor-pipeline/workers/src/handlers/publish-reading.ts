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
 * Publish Reading Worker Lambda Handler (Nested Fan-Out Child)
 *
 * This lambda receives reading data from the orchestrator, publishes the
 * normalized reading to the analytics platform by converting from source format
 * to target format, and sends the published data back via HTTP callback.
 *
 * Dependencies: IngestReading
 *
 * Transformation mappings (Source -> Target):
 *   - readingId -> sourceReadingId
 *   - sensorId -> sourceSensorId
 *   - value -> calibratedValue (parsed to number)
 *   - rawValue -> rawMeasurement (parsed to number)
 *   - timestamp -> readingTimestamp
 *   - quality -> qualityIndicator
 */

const STEP_NAME = "Publish Reading";

/**
 * Source reading shape (from IngestReading)
 */
interface SourceReading {
  readingId: number;
  sensorId: string;
  value: string;
  timestamp: string;
  quality: string;
  rawValue: string | null;
}

/**
 * Target reading shape (target format)
 */
interface TargetReading {
  sourceReadingId: number;
  sourceSensorId: string;
  calibratedValue: number;
  rawMeasurement: number | null;
  readingTimestamp: string;
  qualityIndicator: string;
  transformedAt: string;
}

/**
 * Transform source reading data to target format
 */
function transformReadingData(source: SourceReading): TargetReading {
  return {
    sourceReadingId: source.readingId,
    sourceSensorId: source.sensorId,
    calibratedValue: Number(source.value),
    rawMeasurement: source.rawValue ? Number(source.rawValue) : null,
    readingTimestamp: source.timestamp,
    qualityIndicator: source.quality.toUpperCase(),
    transformedAt: new Date().toISOString(),
  };
}

/**
 * Process a single publish work message with retry tracking
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

  logger.log(`Processing publish work`, {
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

  // Extract reading data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const ingestReadingData = dependencyData["IngestReading"] as
    | Record<string, unknown>
    | undefined;
  if (!ingestReadingData) {
    throw new Error(
      "Missing IngestReading data in dependencyData (check step dependencies)",
    );
  }

  const readingData = ingestReadingData.reading as SourceReading;
  if (!readingData) {
    throw new Error("Missing reading field in IngestReading data");
  }

  logger.log(`Extracted reading data:`, {
    readingId: readingData.readingId,
    sensorId: readingData.sensorId,
    value: readingData.value,
    quality: readingData.quality,
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
    const transformedReading: TargetReading = transformReadingData(readingData);

    logger.log(`Published to target format:`, {
      sourceReadingId: transformedReading.sourceReadingId,
      calibratedValue: transformedReading.calibratedValue,
      qualityIndicator: transformedReading.qualityIndicator,
    });

    logger.log(`Sending published data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { publishedReadings: [transformedReading] },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Publish processing completed successfully!`);
  } catch (error) {
    logger.error(`Publish processing failed:`, error);

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
