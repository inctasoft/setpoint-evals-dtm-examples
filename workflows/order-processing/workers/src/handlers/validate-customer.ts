import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  OrderProcessingDataSource,
  Customer,
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
 * Validate Customer Worker Lambda Handler
 *
 * This lambda validates that a customer exists in the order-processing source database
 * and sends the customer profile to the orchestrator via HTTP callback.
 *
 * Flow:
 * 1. Validate: Read customer data using TypeORM by customer_id
 * 2. Callback: Send full customer data to orchestrator via HTTP
 *
 * Input SQS Message Format (from orchestrator):
 * {
 *   "jobId": "uuid",
 *   "stepId": "uuid",
 *   "stepValue": "ValidateCustomer",
 *   "input": {
 *     "customerId": 12345
 *   },
 *   "callbackUrl": "http://orchestrator:3000/api/v1/callback/step-progress",
 *   "sourceConfig": {
 *     "sourceDatabase": "ecommerce",
 *     "sourceTable": "customers",
 *     "filterKey": "customerId"
 *   }
 * }
 */

const STEP_NAME = "Validate Customer";

/**
 * Validate and fetch customer data from the order-processing source database
 */
async function extractCustomerData(
  customerId: number,
  logger: WorkerLogger,
): Promise<Customer | null> {
  if (!OrderProcessingDataSource.isInitialized) {
    logger.log(`Initializing order-processing database connection...`);
    await OrderProcessingDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = OrderProcessingDataSource.getRepository(Customer);

  logger.log(`Querying customer_id:`, customerId);
  const customer = await repository.findOne({
    where: { customerId },
  });

  if (!customer) {
    logger.warn(`Customer not found:`, customerId);
    return null;
  }

  logger.log(`Customer found:`, {
    customerId: customer.customerId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
  });

  return customer;
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

  // Send in-progress callback FIRST to signal work has started
  await sendInProgressCallback(
    callbackUrl,
    jobId,
    stepId,
    retryMetadata,
    STEP_NAME,
  );

  // Validate source configuration
  if (!sourceConfig) {
    throw new Error("Source configuration is required for validate action");
  }

  // Extract the filter value from input using the filterKey
  const filterValue = input[sourceConfig.filterKey];
  if (!filterValue) {
    throw new Error(
      `Missing filter value for key '${sourceConfig.filterKey}'`,
    );
  }

  // Handle both string and number (data may come as string from JSONB/SQS)
  const customerId =
    typeof filterValue === "string"
      ? parseInt(filterValue, 10)
      : (filterValue as number);

  if (isNaN(customerId) || typeof customerId !== "number") {
    throw new Error(
      `Invalid filter value for key '${sourceConfig.filterKey}': got ${JSON.stringify(filterValue)} (type: ${typeof filterValue})`,
    );
  }

  logger.log(`Extracted filter value:`, {
    filterKey: sourceConfig.filterKey,
    customerId,
  });

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
    // VALIDATE: Read from source database
    logger.log(`Validating customer in order-processing database...`);
    const customerData = await extractCustomerData(customerId, logger);

    if (!customerData) {
      throw new Error(`Customer ${customerId} not found in source database`);
    }

    // CALLBACK: Send full data to orchestrator with retry metadata
    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { customer: customerData },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Validate processing completed successfully!`);
  } catch (error) {
    logger.error(`Validate processing failed:`, error);

    // Send failure callback with retry metadata
    await sendFailureCallback(
      callbackUrl,
      jobId,
      stepId,
      error as Error,
      retryMetadata,
      STEP_NAME,
    );

    // Re-throw to mark Lambda execution as failed
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
 *
 * Processes SQS messages containing validate work requests.
 * Handles batch processing with partial failure tracking.
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
