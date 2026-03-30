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
 * Submit Order Worker Lambda Handler
 *
 * This lambda receives order data from the orchestrator, applies transformations
 * to convert from source format to target format, and sends the transformed data
 * back via HTTP callback.
 *
 * Dependencies: ValidateOrder, SubmitCustomer
 *
 * Transformation mappings (Source -> Target):
 *   - orderId -> sourceOrderId
 *   - customerId -> sourceCustomerId
 *   - orderDate -> orderPlacedAt
 *   - status -> orderStatus (normalized)
 *   - totalAmount -> totalValue
 *   - shippingAddress -> deliveryAddress
 *   - SubmitCustomer.fullName -> customerName
 */

const STEP_NAME = "Submit Order";

/**
 * Source order shape (from ValidateOrder)
 */
interface SourceOrder {
  orderId: number;
  customerId: number;
  orderDate: string;
  status: string;
  totalAmount: number;
  shippingAddress: string | null;
}

/**
 * Target order shape (target format)
 */
interface TargetOrder {
  sourceOrderId: number;
  sourceCustomerId: number;
  customerName: string | null;
  orderPlacedAt: string;
  orderStatus: string;
  totalValue: number;
  currency: string;
  deliveryAddress: string | null;
  transformedAt: string;
}

/**
 * Normalize order status from source to target format
 */
function normalizeOrderStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "PENDING",
    processing: "PROCESSING",
    shipped: "SHIPPED",
    delivered: "DELIVERED",
    cancelled: "CANCELLED",
    refunded: "REFUNDED",
  };
  return statusMap[status.toLowerCase()] || status.toUpperCase();
}

/**
 * Transform source order data to target format
 */
function transformOrderData(
  source: SourceOrder,
  customerName: string | null,
): TargetOrder {
  return {
    sourceOrderId: source.orderId,
    sourceCustomerId: source.customerId,
    customerName,
    orderPlacedAt: source.orderDate,
    orderStatus: normalizeOrderStatus(source.status),
    totalValue: Number(source.totalAmount),
    currency: "USD",
    deliveryAddress: source.shippingAddress || null,
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

  // Extract dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  // Get order data from ValidateOrder
  const validateOrderData = dependencyData["ValidateOrder"] as
    | Record<string, unknown>
    | undefined;
  if (!validateOrderData) {
    throw new Error(
      "Missing ValidateOrder data in dependencyData (check step dependencies)",
    );
  }

  const orderData = validateOrderData.order as SourceOrder;
  if (!orderData) {
    throw new Error("Missing order field in ValidateOrder data");
  }

  // Get customer name from SubmitCustomer (optional dependency)
  const submitCustomerData = dependencyData["SubmitCustomer"] as
    | Record<string, unknown>
    | undefined;
  const customerName = (submitCustomerData?.submittedCustomers as any)?.[0]
    ? ((submitCustomerData?.submittedCustomers as any)?.[0] as { fullName?: string })?.fullName || null
    : null;

  logger.log(`Extracted order data:`, {
    orderId: orderData.orderId,
    customerId: orderData.customerId,
    status: orderData.status,
    customerName: customerName || "(not available)",
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
    const transformedOrder: TargetOrder = transformOrderData(orderData, customerName);

    logger.log(`Transformed to target format:`, {
      sourceOrderId: transformedOrder.sourceOrderId,
      orderStatus: transformedOrder.orderStatus,
      totalValue: transformedOrder.totalValue,
    });

    logger.log(`Sending submitted data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { submittedOrders: [transformedOrder] },
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
