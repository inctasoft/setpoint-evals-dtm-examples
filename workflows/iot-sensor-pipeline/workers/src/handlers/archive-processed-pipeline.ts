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
  createIotProductDataSource,
  destroyIotProductDataSource,
} from "../../../product-db/src/config/datasource";
import { ProcessedJob } from "../../../product-db/src/entities/processed-job.entity";
import { RegisteredDevice } from "../../../product-db/src/entities/registered-device.entity";
import { DispatchedAlert } from "../../../product-db/src/entities/dispatched-alert.entity";
import { PublishedAggregate } from "../../../product-db/src/entities/published-aggregate.entity";

/**
 * Archive Processed Pipeline Worker Lambda Handler
 *
 * Final step in the iot-sensor-pipeline workflow. Reads all processed data
 * from dependency outputs and writes a complete archive record to the
 * iot_sensor_pipeline_product_db.
 *
 * Does NOT require ACK — sends success callback directly after DB write.
 */

const STEP_NAME = "Archive Processed Pipeline";

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
  const provisionedDevices = (depData?.["ProvisionDevice"]?.provisionedDevices as any[]) || [];
  const sensorCount = (depData?.["DiscoverReadings"]?.childCount as number) || 0;
  const readingCount = (depData?.["DiscoverReadings"]?.childCount as number) || 0;
  const dispatchedAlerts = (depData?.["DispatchAlert"]?.dispatchedAlerts as any[]) || [];
  const publishedAggregates = (depData?.["PublishAggregate"]?.publishedAggregates as any[]) || [];

  logger.log(`Extracted dependency data`, {
    deviceCount: provisionedDevices.length,
    sensorCount,
    readingCount,
    alertCount: dispatchedAlerts.length,
    aggregateCount: publishedAggregates.length,
  });

  const ds = await createIotProductDataSource();

  try {
    await ds.transaction(async (manager) => {
      // Create the processed job record
      const job = manager.create(ProcessedJob, {
        jobId,
        workflowName: "iot-sensor-pipeline",
        completedAt: new Date(),
        deviceCount: provisionedDevices.length,
        sensorCount,
        readingCount,
        alertCount: dispatchedAlerts.length,
        aggregateCount: publishedAggregates.length,
      });
      await manager.save(job);

      // Archive devices
      for (const d of provisionedDevices) {
        await manager.save(
          manager.create(RegisteredDevice, {
            jobId,
            sourceDeviceId: d.sourceDeviceId || d.deviceId || "",
            externalDeviceId: d.externalDeviceId || null,
            deviceType: d.deviceType || d.type || null,
            location: d.installationLocation || d.location || null,
          }),
        );
      }

      // Archive alerts
      for (const a of dispatchedAlerts) {
        await manager.save(
          manager.create(DispatchedAlert, {
            jobId,
            sourceAlertId: String(a.sourceAlertId || a.alertId || ""),
            externalAlertId: a.externalAlertId || null,
            externalDeviceId: a.externalDeviceId || null,
            severity: a.severity || null,
            message: a.message || null,
          }),
        );
      }

      // Archive aggregates
      for (const ag of publishedAggregates) {
        await manager.save(
          manager.create(PublishedAggregate, {
            jobId,
            sourceAggregateId: String(ag.sourceAggregateId || ag.aggregateId || ""),
            externalAggregateId: ag.externalAggregateId || null,
            externalSensorId: ag.externalSensorId || null,
            metric: ag.metric || ag.aggregationType || null,
            value: ag.value ?? null,
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
        deviceCount: provisionedDevices.length,
        sensorCount,
        readingCount,
        alertCount: dispatchedAlerts.length,
        aggregateCount: publishedAggregates.length,
      },
      provisionedDevices.length + dispatchedAlerts.length + publishedAggregates.length,
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
    await destroyIotProductDataSource();
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
