import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  ProcessingWorkMessage,
  sendInProgressCallback,
  sendSuccessCallback,
  sendFailureCallback,
  getSQSMessageAttributes,
  createBatchItemFailure,
  buildRetryMetadata,
  SQSBatchResponse,
  createLogger,
  WorkerLogger,
} from "@dtm/worker-sdk";
import {
  createOrderProductDataSource,
  destroyOrderProductDataSource,
} from "../../../product-db/src/config/datasource";
import { ProcessedJob } from "../../../product-db/src/entities/processed-job.entity";
import { ProcessedCustomer } from "../../../product-db/src/entities/processed-customer.entity";
import { ProcessedOrder } from "../../../product-db/src/entities/processed-order.entity";
import { ProcessedPayment } from "../../../product-db/src/entities/processed-payment.entity";
import { ProcessedShipment } from "../../../product-db/src/entities/processed-shipment.entity";

/**
 * Archive Processed Order Worker Lambda Handler
 *
 * Final step in the order-processing workflow. Reads all processed data
 * from dependency outputs and writes a complete archive record to the
 * order_processing_product_db.
 *
 * Does NOT require ACK — sends success callback directly after DB write.
 */

const STEP_NAME = "Archive Processed Order";

async function processArchiveWork(
  message: ProcessingWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing archive work`, {
    jobId,
    stepId,
    inputKeys: Object.keys(input),
  });

  await sendInProgressCallback(callbackUrl, jobId, stepId, retryMetadata, STEP_NAME);

  const depData = input.dependencyData as Record<string, Record<string, unknown>> | undefined;

  // Extract data from dependency step outputs
  const submittedCustomers = (depData?.["SubmitCustomer"]?.submittedCustomers as any[]) || [];
  const submittedOrders = (depData?.["SubmitOrder"]?.submittedOrders as any[]) || [];
  const lineItemCount = (depData?.["DiscoverLineItems"]?.childCount as number) || 0;
  const submittedPayments = (depData?.["SubmitPayment"]?.submittedPayments as any[]) || [];
  const submittedShipments = (depData?.["SubmitShipment"]?.submittedShipments as any[]) || [];

  logger.log(`Extracted dependency data`, {
    customerCount: submittedCustomers.length,
    orderCount: submittedOrders.length,
    lineItemCount,
    paymentCount: submittedPayments.length,
    shipmentCount: submittedShipments.length,
  });

  const ds = await createOrderProductDataSource();

  try {
    await ds.transaction(async (manager) => {
      // Create the processed job record
      const job = manager.create(ProcessedJob, {
        jobId,
        workflowName: "order-processing",
        completedAt: new Date(),
        customerCount: submittedCustomers.length,
        orderCount: submittedOrders.length,
        lineItemCount,
        paymentCount: submittedPayments.length,
        shipmentCount: submittedShipments.length,
      });
      await manager.save(job);

      // Archive customers
      for (const c of submittedCustomers) {
        await manager.save(
          manager.create(ProcessedCustomer, {
            jobId,
            sourceCustomerId: c.sourceCustomerId ?? 0,
            externalCustomerId: c.externalCustomerId || null,
            fullName: c.fullName || null,
            emailAddress: c.emailAddress || null,
            phoneNumber: c.phoneNumber || null,
          }),
        );
      }

      // Archive orders
      for (const o of submittedOrders) {
        await manager.save(
          manager.create(ProcessedOrder, {
            jobId,
            sourceOrderId: o.sourceOrderId ?? 0,
            externalOrderId: o.externalOrderId || null,
            externalCustomerId: o.externalCustomerId || null,
            totalAmount: o.totalAmount ?? null,
          }),
        );
      }

      // Archive payments
      for (const p of submittedPayments) {
        await manager.save(
          manager.create(ProcessedPayment, {
            jobId,
            sourcePaymentId: p.sourcePaymentId ?? 0,
            externalPaymentId: p.externalPaymentId || null,
            externalOrderId: p.externalOrderId || null,
            paymentMethod: p.paymentMethod || null,
            amount: p.amount ?? null,
            status: p.status || null,
          }),
        );
      }

      // Archive shipments
      for (const s of submittedShipments) {
        await manager.save(
          manager.create(ProcessedShipment, {
            jobId,
            sourceShipmentId: s.sourceShipmentId ?? 0,
            externalShipmentId: s.externalShipmentId || null,
            externalOrderId: s.externalOrderId || null,
            carrier: s.carrier || null,
            trackingNumber: s.trackingNumber || null,
            status: s.status || null,
          }),
        );
      }

      logger.log(`Archive transaction committed`, { jobId });
    });

    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      {
        archivedJobId: jobId,
        customerCount: submittedCustomers.length,
        orderCount: submittedOrders.length,
        lineItemCount,
        paymentCount: submittedPayments.length,
        shipmentCount: submittedShipments.length,
      },
      submittedCustomers.length + submittedOrders.length + submittedPayments.length + submittedShipments.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Archive processing completed successfully!`);
  } catch (error) {
    logger.error(`Archive processing failed:`, error);

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
  } finally {
    await destroyOrderProductDataSource();
  }
}

function parseMessage(record: SQSRecord): ProcessingWorkMessage {
  try {
    const body = JSON.parse(record.body) as unknown;
    if (typeof body !== "object" || body === null) {
      throw new Error("Message body is not an object");
    }
    const bodyObj = body as Record<string, unknown>;
    if (!bodyObj.jobId || !bodyObj.stepId || !bodyObj.input || !bodyObj.callbackUrl) {
      throw new Error("Missing required fields: jobId, stepId, input, or callbackUrl");
    }
    return bodyObj as unknown as ProcessingWorkMessage;
  } catch (error) {
    console.error(`[${STEP_NAME}] Failed to parse message:`, error);
    throw new Error(
      `Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  const recordCount = event.Records ? event.Records.length : 0;
  console.log(`[${STEP_NAME}] Lambda invoked with`, recordCount, "record(s)");
  console.log(`[${STEP_NAME}] Request ID:`, context.awsRequestId);

  const batchItemFailures: { itemIdentifier: string }[] = [];

  if (recordCount === 0) {
    console.log(`[${STEP_NAME}] Empty event received (likely warmup), returning success`);
    return { batchItemFailures: [] };
  }

  try {
    for (const record of event.Records) {
      let message: ProcessingWorkMessage | null = null;
      const processingStartTime = Date.now();
      const sqsAttributes = getSQSMessageAttributes(record);

      console.log(`[${STEP_NAME}] Processing message (attempt ${sqsAttributes.receiveCount})`);

      try {
        message = parseMessage(record);
        const logger = createLogger(message.correlationId, STEP_NAME);
        const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
        await processArchiveWork(message, retryMetadata, logger);
        logger.log(`Message ${record.messageId} processed successfully`);
      } catch (error) {
        const errorLogger = createLogger(undefined, STEP_NAME);
        errorLogger.error(`Message ${record.messageId} processing failed:`, error);
        errorLogger.error("Record body:", record.body);

        if (message && !(error as any).callbackSent) {
          const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
          try {
            await sendFailureCallback(
              message.callbackUrl,
              message.jobId,
              message.stepId,
              error as Error,
              retryMetadata,
              STEP_NAME,
            );
            errorLogger.log(`Failure callback sent for message ${record.messageId}`);
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
    console.log(`[${STEP_NAME}] Batch processing complete:`, { total, succeeded, failed: batchItemFailures.length });
  } catch (error) {
    console.error(`[${STEP_NAME}] FATAL: Top-level error in handler:`, error);
    for (const record of event.Records) {
      batchItemFailures.push(createBatchItemFailure(record.messageId));
    }
  }

  return { batchItemFailures };
}

export default handler;
