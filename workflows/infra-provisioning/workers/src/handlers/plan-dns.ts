import "reflect-metadata";
import { SQSEvent, SQSRecord, Context } from "aws-lambda";
import {
  InfraProvisioningDataSource,
  DnsRecord,
} from "@dtm-workflows/infra-provisioning-typeorm";
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
 * Plan DNS Worker Lambda Handler
 *
 * Plans DNS record configuration from the infra-provisioning source database
 * by dns_record_id and sends it to the orchestrator via HTTP callback.
 */

const STEP_NAME = "Plan DNS";

async function readDnsData(
  dnsRecordId: string,
  logger: WorkerLogger,
): Promise<DnsRecord | null> {
  if (!InfraProvisioningDataSource.isInitialized) {
    logger.log(`Initializing infra-provisioning database connection...`);
    await InfraProvisioningDataSource.initialize();
    logger.log(`Database connected`);
  }

  const repository = InfraProvisioningDataSource.getRepository(DnsRecord);

  logger.log(`Querying dns_records by record_id:`, dnsRecordId);
  const dnsRecord = await repository.findOne({
    where: { recordId: dnsRecordId },
  });

  if (!dnsRecord) {
    logger.warn(`DNS record not found:`, dnsRecordId);
    return null;
  }

  logger.log(`DNS record found:`, {
    recordId: dnsRecord.recordId,
    networkId: dnsRecord.networkId,
    instanceId: dnsRecord.instanceId,
    hostname: dnsRecord.hostname,
    recordType: dnsRecord.recordType,
  });

  return dnsRecord;
}

async function processPlanWork(
  message: SourceWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, sourceConfig, callbackUrl } = message;

  logger.log(`Processing plan work`, { jobId, stepId, sourceConfig, inputKeys: Object.keys(input) });

  await sendInProgressCallback(callbackUrl, jobId, stepId, retryMetadata, STEP_NAME);

  if (!sourceConfig) {
    throw new Error("Source configuration is required for plan action");
  }

  const filterValue = input[sourceConfig.filterKey];
  if (!filterValue) {
    throw new Error(`Missing filter value for key '${sourceConfig.filterKey}'`);
  }

  const dnsRecordId = String(filterValue);

  logger.log(`Extracted filter value:`, { filterKey: sourceConfig.filterKey, dnsRecordId });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(stepOpts?.failureAfter, stepOpts?.failOnAttempts, retryMetadata.sqsReceiveCount, STEP_NAME);
  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Reading from infra-provisioning database...`);
    const dnsData = await readDnsData(dnsRecordId, logger);

    if (!dnsData) {
      throw new Error(`DNS record ${dnsRecordId} not found in source database`);
    }

    logger.log(`Sending data to orchestrator...`);
    await sendSuccessCallback(callbackUrl, jobId, stepId, { dnsRecord: dnsData }, 1, retryMetadata, STEP_NAME);

    logger.log(`Plan processing completed successfully!`);
  } catch (error) {
    logger.error(`Plan processing failed:`, error);
    await sendFailureCallback(callbackUrl, jobId, stepId, error as Error, retryMetadata, STEP_NAME);
    (error as any).callbackSent = true;
    throw error;
  }
}

function parseMessage(record: SQSRecord): SourceWorkMessage {
  try {
    const body = JSON.parse(record.body) as unknown;
    if (typeof body !== "object" || body === null) throw new Error("Message body is not an object");
    const bodyObj = body as Record<string, unknown>;
    if (!bodyObj.jobId || !bodyObj.stepId || !bodyObj.input || !bodyObj.callbackUrl) {
      throw new Error("Missing required fields: jobId, stepId, input, or callbackUrl");
    }
    if (!bodyObj.sourceConfig) throw new Error("Source worker requires sourceConfig");
    return bodyObj as unknown as SourceWorkMessage;
  } catch (error) {
    console.error(`[${STEP_NAME}] Failed to parse message:`, error);
    throw new Error(`Invalid message format: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function handler(event: SQSEvent, context: Context): Promise<SQSBatchResponse> {
  const recordCount = event.Records ? event.Records.length : 0;
  console.log(`[${STEP_NAME}] Lambda invoked with`, recordCount, "record(s)");
  console.log(`[${STEP_NAME}] Request ID:`, context.awsRequestId);

  const batchItemFailures: { itemIdentifier: string }[] = [];
  if (recordCount === 0) return { batchItemFailures: [] };

  try {
    for (const record of event.Records) {
      let message: SourceWorkMessage | null = null;
      const processingStartTime = Date.now();
      const sqsAttributes = getSQSMessageAttributes(record);

      try {
        message = parseMessage(record);
        const logger = createLogger(message.correlationId, STEP_NAME);
        const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
        await processPlanWork(message, retryMetadata, logger);
        logger.log(`Message ${record.messageId} processed successfully`);
      } catch (error) {
        const errorLogger = createLogger(undefined, STEP_NAME);
        errorLogger.error(`Message ${record.messageId} processing failed:`, error);

        if (message && !(error as any).callbackSent) {
          const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
          try {
            await sendFailureCallback(message.callbackUrl, message.jobId, message.stepId, error as Error, retryMetadata, STEP_NAME);
          } catch (callbackError) {
            errorLogger.error(`Failed to send failure callback:`, callbackError);
          }
        }
        batchItemFailures.push(createBatchItemFailure(record.messageId));
      }
    }
    console.log(`[${STEP_NAME}] Batch processing complete:`, { total: event.Records.length, failed: batchItemFailures.length });
  } catch (error) {
    console.error(`[${STEP_NAME}] FATAL: Top-level error in handler:`, error);
    for (const record of event.Records) {
      batchItemFailures.push(createBatchItemFailure(record.messageId));
    }
  } finally {
    if (InfraProvisioningDataSource.isInitialized) {
      try { await InfraProvisioningDataSource.destroy(); } catch (error) {
        console.error(`[${STEP_NAME}] Failed to close database connection:`, error);
      }
    }
  }

  return { batchItemFailures };
}

export default handler;
