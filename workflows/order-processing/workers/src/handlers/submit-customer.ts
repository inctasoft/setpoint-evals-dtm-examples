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
 * Submit Customer Worker Lambda Handler
 *
 * This lambda receives customer data from the orchestrator, applies transformations
 * to convert from source format to target system format,
 * and sends the transformed data back via HTTP callback.
 *
 * Transformation mappings (Source -> Target):
 *   - firstName + lastName -> fullName
 *   - firstName -> firstName
 *   - lastName -> lastName
 *   - email -> emailAddress
 *   - phone -> phoneNumber
 *   - address -> mailingAddress
 *   - createdAt -> registrationDate
 *
 * Flow:
 * 1. Receive: Get customer data from input.dependencyData.ValidateCustomer
 * 2. Transform: Convert to target schema with field renaming and normalization
 * 3. Callback: Send transformed data back to orchestrator via HTTP
 */

const STEP_NAME = "Submit Customer";

/**
 * Source customer shape (from ValidateCustomer)
 */
interface SourceCustomer {
  customerId: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  createdAt: string;
}

/**
 * Target customer shape (target format)
 */
interface TargetCustomer {
  sourceCustomerId: number;
  fullName: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  phoneNumber: string | null;
  mailingAddress: string | null;
  registrationDate: string;
  transformedAt: string;
}

/**
 * Transform source customer data to target format
 */
function transformCustomerData(source: SourceCustomer): TargetCustomer {
  return {
    sourceCustomerId: source.customerId,
    fullName: `${source.firstName} ${source.lastName}`.trim(),
    firstName: source.firstName,
    lastName: source.lastName,
    emailAddress: source.email.toLowerCase(),
    phoneNumber: source.phone || null,
    mailingAddress: source.address || null,
    registrationDate: source.createdAt,
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

  // Send in-progress callback FIRST to signal work has started
  await sendInProgressCallback(
    callbackUrl,
    jobId,
    stepId,
    retryMetadata,
    STEP_NAME,
  );

  // Extract customer data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const validateCustomerData = dependencyData["ValidateCustomer"] as
    | Record<string, unknown>
    | undefined;
  if (!validateCustomerData) {
    throw new Error(
      "Missing ValidateCustomer data in dependencyData (check step dependencies)",
    );
  }

  const customerData = validateCustomerData.customer as SourceCustomer;
  if (!customerData) {
    throw new Error("Missing customer field in ValidateCustomer data");
  }

  logger.log(`Extracted customer data:`, {
    customerId: customerData.customerId,
    firstName: customerData.firstName,
    lastName: customerData.lastName,
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
    // TRANSFORM: Convert source format to target format
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedCustomer: TargetCustomer = transformCustomerData(customerData);

    logger.log(`Transformed to target format:`, {
      fullName: transformedCustomer.fullName,
      emailAddress: transformedCustomer.emailAddress,
    });

    // CALLBACK: Send transformed data to orchestrator
    logger.log(`Sending submitted data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { submittedCustomers: [transformedCustomer] },
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
