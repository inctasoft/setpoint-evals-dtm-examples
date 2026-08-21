import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  OrderProcessingDataSource,
  OrderItem,
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
 * Validate Line Item Worker Lambda Handler (Fan-Out Child)
 *
 * This lambda validates a single line item from the source database.
 * It is invoked as a child step from DiscoverLineItems fan-out.
 *
 * Input:
 *   { orderItemId: "1001" } - single line item from discovery
 *
 * Output:
 *   { orderItem: { ... full line item data ... } }
 */

const STEP_NAME = "Validate Line Item";

/**
 * Validate and fetch a single line item from the source database
 */
async function extractOrderItemData(
  orderItemId: number,
  logger: WorkerLogger,
): Promise<OrderItem | null> {
  if (!OrderProcessingDataSource.isInitialized) {
    logger.log(`Initializing order-processing database connection...`);
    await OrderProcessingDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = OrderProcessingDataSource.getRepository(OrderItem);

  logger.log(`Querying order_item_id:`, orderItemId);
  const orderItem = await repository.findOne({
    where: { orderItemId },
  });

  if (!orderItem) {
    logger.warn(`Line item not found:`, orderItemId);
    return null;
  }

  logger.log(`Line item found:`, {
    orderItemId: orderItem.orderItemId,
    orderId: orderItem.orderId,
    productId: orderItem.productId,
    quantity: orderItem.quantity,
    subtotal: orderItem.subtotal,
  });

  return orderItem;
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
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing validate work`, {
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

  // Extract line item ID from input (fan-out child receives this from discovery)
  const orderItemIdRaw = input.orderItemId as string | number | undefined;
  if (!orderItemIdRaw) {
    throw new Error("orderItemId is required in input for line item validation");
  }

  const orderItemId =
    typeof orderItemIdRaw === "string"
      ? parseInt(orderItemIdRaw, 10)
      : orderItemIdRaw;

  if (isNaN(orderItemId)) {
    throw new Error(`Invalid orderItemId: ${orderItemIdRaw}`);
  }

  // Log fan-out context if available
  const fanOutContext = input._fanOut as
    | { parentStepId: string; childIndex: number; totalChildren: number }
    | undefined;
  if (fanOutContext) {
    logger.log(`Fan-out context:`, fanOutContext);
  }

  logger.log(`Extracted filter value:`, { orderItemId });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(
    stepOpts?.failureAfter,
    stepOpts?.failOnAttempts,
    retryMetadata.sqsReceiveCount,
    STEP_NAME,
  );

  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Validating line item in order-processing database...`);
    const orderItemData = await extractOrderItemData(orderItemId, logger);

    if (!orderItemData) {
      throw new Error(`Line item ${orderItemId} not found in source database`);
    }

    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { orderItem: orderItemData },
      1,
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
