import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  OrderProcessingDataSource,
  Shipment,
} from "@dtm-workflows/order-processing-typeorm";
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
 * Validate Shipment Worker Lambda Handler
 *
 * This lambda validates that shipment data exists in the order-processing source database
 * by order_id and sends it to the orchestrator via HTTP callback.
 *
 * Flow:
 * 1. Validate: Read shipment records using TypeORM by order_id
 * 2. Callback: Send shipment data to orchestrator via HTTP
 */

const STEP_NAME = "Validate Shipment";

/**
 * Validate and fetch shipment data from the order-processing source database
 */
async function extractShipmentData(
  orderId: number,
  logger: WorkerLogger,
): Promise<Shipment[]> {
  if (!OrderProcessingDataSource.isInitialized) {
    logger.log(`Initializing order-processing database connection...`);
    await OrderProcessingDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = OrderProcessingDataSource.getRepository(Shipment);

  logger.log(`Querying shipments for order_id:`, orderId);
  const shipments = await repository.find({
    where: { orderId },
  });

  if (shipments.length === 0) {
    logger.warn(`No shipments found for order_id:`, orderId);
    return [];
  }

  logger.log(`Found ${shipments.length} shipment(s):`, {
    orderId,
    shipmentIds: shipments.map((s) => s.shipmentId),
  });

  return shipments;
}

/**
 * Process a single validate work message with retry tracking
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

  logger.log(`Processing validate work`, {
    jobId,
    stepId,
    sourceConfig,
    inputKeys: Object.keys(input),
  });

  await sendInProgressCallback(
    callbackUrl,
    jobId,
    stepId,
    retryMetadata,
    STEP_NAME,
  );

  if (!sourceConfig) {
    throw new Error("Source configuration is required for validate action");
  }

  const filterValue = input[sourceConfig.filterKey];
  if (!filterValue) {
    throw new Error(
      `Missing filter value for key '${sourceConfig.filterKey}'`,
    );
  }

  const orderId =
    typeof filterValue === "string"
      ? parseInt(filterValue, 10)
      : (filterValue as number);

  if (isNaN(orderId) || typeof orderId !== "number") {
    throw new Error(
      `Invalid filter value for key '${sourceConfig.filterKey}': got ${JSON.stringify(filterValue)} (type: ${typeof filterValue})`,
    );
  }

  logger.log(`Extracted filter value:`, {
    filterKey: sourceConfig.filterKey,
    orderId,
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
    logger.log(`Validating shipment in order-processing database...`);
    const shipments = await extractShipmentData(orderId, logger);

    if (shipments.length === 0) {
      throw new Error(`No shipments found for order ${orderId} in source database`);
    }

    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { shipments, count: shipments.length },
      shipments.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Validate processing completed successfully!`);
  } catch (error) {
    logger.error(`Validate processing failed:`, error);

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
    if (OrderProcessingDataSource.isInitialized) {
      try {
        await OrderProcessingDataSource.destroy();
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
