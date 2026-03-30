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
 * Submit Line Item Worker Lambda Handler
 *
 * This lambda receives line item data from the orchestrator, applies transformations
 * to convert from source format to target format, and sends the transformed data
 * back via HTTP callback.
 *
 * Dependencies: ValidateLineItem
 *
 * Transformation mappings (Source -> Target):
 *   - orderItemId -> sourceOrderItemId
 *   - orderId -> sourceOrderId
 *   - productId -> sourceProductId
 *   - quantity -> quantity
 *   - unitPrice -> unitPrice
 *   - subtotal -> lineTotal
 */

const STEP_NAME = "Submit Line Item";

/**
 * Source line item shape (from ValidateLineItem)
 */
interface SourceOrderItem {
  orderItemId: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

/**
 * Target line item shape (target format)
 */
interface TargetOrderItem {
  sourceOrderItemId: number;
  sourceOrderId: number;
  sourceProductId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  transformedAt: string;
}

/**
 * Transform source line item data to target format
 */
function transformOrderItemData(source: SourceOrderItem): TargetOrderItem {
  return {
    sourceOrderItemId: source.orderItemId,
    sourceOrderId: source.orderId,
    sourceProductId: source.productId,
    quantity: source.quantity,
    unitPrice: Number(source.unitPrice),
    lineTotal: Number(source.subtotal),
    transformedAt: new Date().toISOString(),
  };
}

/**
 * Process a single submit work message with retry tracking
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

  logger.log(`Processing submit work`, {
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

  // Extract line item data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const validateLineItemData = dependencyData["ValidateLineItem"] as
    | Record<string, unknown>
    | undefined;
  if (!validateLineItemData) {
    throw new Error(
      "Missing ValidateLineItem data in dependencyData (check step dependencies)",
    );
  }

  const orderItemData = validateLineItemData.orderItem as SourceOrderItem;
  if (!orderItemData) {
    throw new Error("Missing orderItem field in ValidateLineItem data");
  }

  logger.log(`Extracted line item data:`, {
    orderItemId: orderItemData.orderItemId,
    orderId: orderItemData.orderId,
    productId: orderItemData.productId,
    quantity: orderItemData.quantity,
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
    const transformedOrderItem: TargetOrderItem = transformOrderItemData(orderItemData);

    logger.log(`Transformed to target format:`, {
      sourceOrderItemId: transformedOrderItem.sourceOrderItemId,
      lineTotal: transformedOrderItem.lineTotal,
    });

    logger.log(`Sending submitted data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { submittedLineItems: [transformedOrderItem] },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Submit processing completed successfully!`);
  } catch (error) {
    logger.error(`Submit processing failed:`, error);

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
