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
 * Publish Aggregate Worker Lambda Handler
 *
 * This lambda receives aggregate data from the orchestrator, publishes
 * aggregated metrics to the analytics platform by converting from source format
 * to target format, and sends the published data back via HTTP callback.
 *
 * Dependencies: ComputeAggregate, ActivateSensor
 *
 * Transformation mappings (Source -> Target):
 *   - aggregateId -> sourceAggregateId
 *   - sensorId -> sourceSensorId
 *   - periodStart -> windowStart
 *   - periodEnd -> windowEnd
 *   - minValue -> minimumReading
 *   - maxValue -> maximumReading
 *   - avgValue -> averageReading
 *   - sampleCount -> numberOfSamples
 *   - aggregationType -> rollupType
 */

const STEP_NAME = "Publish Aggregate";

/**
 * Source aggregate shape (from ComputeAggregate)
 */
interface SourceAggregate {
  aggregateId: number;
  sensorId: string;
  periodStart: string;
  periodEnd: string;
  minValue: string;
  maxValue: string;
  avgValue: string;
  sampleCount: number;
  aggregationType: string;
}

/**
 * Target aggregate shape (target format)
 */
interface TargetAggregate {
  sourceAggregateId: number;
  sourceSensorId: string;
  windowStart: string;
  windowEnd: string;
  minimumReading: number;
  maximumReading: number;
  averageReading: number;
  numberOfSamples: number;
  rollupType: string;
  valueRange: number;
  transformedAt: string;
}

/**
 * Transform source aggregate data to target format
 */
function transformAggregateData(source: SourceAggregate): TargetAggregate {
  const minVal = Number(source.minValue);
  const maxVal = Number(source.maxValue);

  return {
    sourceAggregateId: source.aggregateId,
    sourceSensorId: source.sensorId,
    windowStart: source.periodStart,
    windowEnd: source.periodEnd,
    minimumReading: minVal,
    maximumReading: maxVal,
    averageReading: Number(source.avgValue),
    numberOfSamples: source.sampleCount,
    rollupType: source.aggregationType.toUpperCase(),
    valueRange: maxVal - minVal,
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

  // Extract aggregate data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const computeAggregateData = dependencyData["ComputeAggregate"] as
    | Record<string, unknown>
    | undefined;
  if (!computeAggregateData) {
    throw new Error(
      "Missing ComputeAggregate data in dependencyData (check step dependencies)",
    );
  }

  const aggregatesRaw = computeAggregateData.aggregates as SourceAggregate[];
  if (!aggregatesRaw || !Array.isArray(aggregatesRaw)) {
    throw new Error("Missing or invalid aggregates field in ComputeAggregate data");
  }

  logger.log(`Extracted ${aggregatesRaw.length} aggregate(s) for publishing`);

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
    const transformedAggregates: TargetAggregate[] = aggregatesRaw.map(transformAggregateData);

    logger.log(`Published ${transformedAggregates.length} aggregate(s) to target format`);

    logger.log(`Sending published data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { publishedAggregates: transformedAggregates, count: transformedAggregates.length },
      transformedAggregates.length,
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
