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
 * Provision Device Worker Lambda Handler
 *
 * This lambda receives device data from the orchestrator, provisions the device
 * configuration to the IoT platform by converting from source format to target
 * (New Platform Database) format, and sends the provisioned data back via HTTP callback.
 *
 * Transformation mappings (Source -> Target):
 *   - deviceId -> sourceDeviceId
 *   - name -> deviceName
 *   - type -> deviceType
 *   - location -> installationLocation
 *   - firmwareVersion -> currentFirmware
 *   - status -> operationalStatus
 *   - registeredAt -> registrationDate
 *   - lastSeenAt -> lastCommunicationDate
 *
 * Flow:
 * 1. Receive: Get device data from input.dependencyData.RegisterDevice
 * 2. Provision: Convert to target schema with field renaming and normalization
 * 3. Callback: Send provisioned data back to orchestrator via HTTP
 */

const STEP_NAME = "Provision Device";

/**
 * Source device shape (from RegisterDevice)
 */
interface SourceDevice {
  deviceId: string;
  name: string;
  type: string;
  location: string;
  firmwareVersion: string;
  status: string;
  registeredAt: string;
  lastSeenAt: string | null;
}

/**
 * Target device shape (target format)
 */
interface TargetDevice {
  sourceDeviceId: string;
  deviceName: string;
  deviceType: string;
  installationLocation: string;
  currentFirmware: string;
  operationalStatus: string;
  registrationDate: string;
  lastCommunicationDate: string | null;
  transformedAt: string;
}

/**
 * Transform source device data to target format
 */
function transformDeviceData(source: SourceDevice): TargetDevice {
  return {
    sourceDeviceId: source.deviceId,
    deviceName: source.name,
    deviceType: source.type.toUpperCase(),
    installationLocation: source.location,
    currentFirmware: source.firmwareVersion,
    operationalStatus: source.status.toUpperCase(),
    registrationDate: source.registeredAt,
    lastCommunicationDate: source.lastSeenAt || null,
    transformedAt: new Date().toISOString(),
  };
}

/**
 * Process a single provision work message with retry tracking
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

  logger.log(`Processing provision work`, {
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

  // Extract device data from dependency data
  const dependencyData = input.dependencyData as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!dependencyData) {
    throw new Error("Missing dependencyData in input");
  }

  const registerDeviceData = dependencyData["RegisterDevice"] as
    | Record<string, unknown>
    | undefined;
  if (!registerDeviceData) {
    throw new Error(
      "Missing RegisterDevice data in dependencyData (check step dependencies)",
    );
  }

  const deviceData = registerDeviceData.device as SourceDevice;
  if (!deviceData) {
    throw new Error("Missing device field in RegisterDevice data");
  }

  logger.log(`Extracted device data:`, {
    deviceId: deviceData.deviceId,
    name: deviceData.name,
    type: deviceData.type,
    status: deviceData.status,
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
    // PROVISION: Convert source format to target format
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedDevice: TargetDevice = transformDeviceData(deviceData);

    logger.log(`Provisioned to target format:`, {
      deviceName: transformedDevice.deviceName,
      deviceType: transformedDevice.deviceType,
      operationalStatus: transformedDevice.operationalStatus,
    });

    // CALLBACK: Send provisioned data to orchestrator
    logger.log(`Sending provisioned data to orchestrator...`);
    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      { provisionedDevices: [transformedDevice] },
      1,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Provision processing completed successfully!`);
  } catch (error) {
    logger.error(`Provision processing failed:`, error);

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
