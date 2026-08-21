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
 * Submit Shipment Worker Lambda Handler
 *
 * This lambda receives shipment data from the orchestrator, applies transformations
 * to convert from source format to target format, and sends the transformed data
 * back via HTTP callback.
 *
 * Dependencies: ValidateShipment, SubmitOrder
 *
 * Transformation mappings (Source -> Target):
 *   - shipmentId -> sourceShipmentId
 *   - orderId -> sourceOrderId
 *   - carrier -> carrierName
 *   - trackingNumber -> trackingId
 *   - shippedDate -> shippedAt
 *   - estimatedDelivery -> estimatedDeliveryAt
 *   - status -> shipmentStatus (normalized)
 *   - SubmitOrder.sourceOrderId -> extOrderId (reference)
 */

const STEP_NAME = "Submit Shipment";

/**
 * Source shipment shape (from ValidateShipment)
 */
interface SourceShipment {
  shipmentId: number;
  orderId: number;
  carrier: string;
  trackingNumber: string | null;
  shippedDate: string | null;
  estimatedDelivery: string | null;
  status: string;
}

/**
 * Target shipment shape (target format)
 */
interface TargetShipment {
  sourceShipmentId: number;
  sourceOrderId: number;
  extOrderId: number | null;
  carrierName: string;
  trackingId: string | null;
  shippedAt: string | null;
  estimatedDeliveryAt: string | null;
  shipmentStatus: string;
  transformedAt: string;
}

/**
 * Normalize shipment status
 */
function normalizeShipmentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "PENDING",
    shipped: "IN_TRANSIT",
    in_transit: "IN_TRANSIT",
    delivered: "DELIVERED",
    returned: "RETURNED",
    cancelled: "CANCELLED",
  };
  return statusMap[status.toLowerCase()] || status.toUpperCase();
}

/**
 * Transform source shipment data to target format
 */
function transformShipmentData(
  source: SourceShipment,
  extOrderId: number | null,
): TargetShipment {
  return {
    sourceShipmentId: source.shipmentId,
    sourceOrderId: source.orderId,
    extOrderId,
    carrierName: source.carrier,
    trackingId: source.trackingNumber || null,
    shippedAt: source.shippedDate || null,
    estimatedDeliveryAt: source.estimatedDelivery || null,
    shipmentStatus: normalizeShipmentStatus(source.status),
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

  // Get shipment data from ValidateShipment
  const validateShipmentData = dependencyData["ValidateShipment"] as
    | Record<string, unknown>
    | undefined;
  if (!validateShipmentData) {
    throw new Error(
      "Missing ValidateShipment data in dependencyData (check step dependencies)",
    );
  }

  const shipmentsData = validateShipmentData.shipments as SourceShipment[];
  if (!shipmentsData || !Array.isArray(shipmentsData)) {
    throw new Error("Missing or invalid shipments array in ValidateShipment data");
  }

  // Get order reference from SubmitOrder (optional dependency)
  const submitOrderData = dependencyData["SubmitOrder"] as
    | Record<string, unknown>
    | undefined;
  const extOrderId = (submitOrderData?.submittedOrders as any)?.[0]
    ? ((submitOrderData?.submittedOrders as any)?.[0] as { sourceOrderId?: number })?.sourceOrderId || null
    : null;

  logger.log(`Extracted ${shipmentsData.length} shipment(s)`, {
    extOrderId: extOrderId || "(not available)",
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
    logger.log(
      `Applying transformations (Source -> Target) to ${shipmentsData.length} shipment(s)...`,
    );
    const transformedShipments: TargetShipment[] = shipmentsData.map((s) =>
      transformShipmentData(s, extOrderId),
    );

    logger.log(`Transformed to target format:`, {
      count: transformedShipments.length,
      shipmentIds: transformedShipments.map((s) => s.sourceShipmentId),
    });

    logger.log(`Sending submitted data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { submittedShipments: transformedShipments },
      transformedShipments.length,
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
