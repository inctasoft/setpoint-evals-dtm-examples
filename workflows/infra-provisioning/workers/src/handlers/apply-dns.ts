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
 * Apply DNS Worker Lambda Handler
 *
 * Receives DNS record data from the orchestrator, applies transformations
 * to convert from source format to target provisioning format.
 *
 * Dependencies: PlanDNS
 *
 * Transformation mappings (Source -> Target):
 *   - recordId -> sourceRecordId
 *   - networkId -> sourceNetworkId
 *   - instanceId -> sourceInstanceId
 *   - hostname -> fqdn
 *   - recordType -> dnsRecordType
 *   - value -> recordValue
 *   - ttl -> ttlSeconds
 *   - status -> provisioningStatus
 */

const STEP_NAME = "Apply DNS";

interface SourceDnsRecord {
  recordId: string;
  networkId: string;
  instanceId: string;
  hostname: string;
  recordType: string;
  value: string;
  ttl: number;
  status: string;
  createdAt: string;
}

interface TargetDnsRecord {
  sourceRecordId: string;
  sourceNetworkId: string;
  sourceInstanceId: string;
  fqdn: string;
  dnsRecordType: string;
  recordValue: string;
  ttlSeconds: number;
  provisioningStatus: string;
  sourceCreatedAt: string;
  transformedAt: string;
}

function transformDnsData(source: SourceDnsRecord): TargetDnsRecord {
  return {
    sourceRecordId: source.recordId,
    sourceNetworkId: source.networkId,
    sourceInstanceId: source.instanceId,
    fqdn: source.hostname.toLowerCase(),
    dnsRecordType: source.recordType.toUpperCase(),
    recordValue: source.value,
    ttlSeconds: source.ttl,
    provisioningStatus: source.status,
    sourceCreatedAt: source.createdAt,
    transformedAt: new Date().toISOString(),
  };
}

async function processApplyWork(
  message: ProcessingWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing apply work`, { jobId, stepId, inputKeys: Object.keys(input) });

  await sendInProgressCallback(callbackUrl, jobId, stepId, retryMetadata, STEP_NAME);

  const dependencyData = input.dependencyData as Record<string, Record<string, unknown>> | undefined;
  if (!dependencyData) throw new Error("Missing dependencyData in input");

  const planDnsData = dependencyData["PlanDNS"] as Record<string, unknown> | undefined;
  if (!planDnsData) {
    throw new Error("Missing PlanDNS data in dependencyData (check step dependencies)");
  }

  const dnsData = planDnsData.dnsRecord as SourceDnsRecord;
  if (!dnsData) throw new Error("Missing dnsRecord field in PlanDNS data");

  logger.log(`Extracted DNS data:`, {
    recordId: dnsData.recordId,
    hostname: dnsData.hostname,
    recordType: dnsData.recordType,
    ttl: dnsData.ttl,
  });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(stepOpts?.failureAfter, stepOpts?.failOnAttempts, retryMetadata.sqsReceiveCount, STEP_NAME);
  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedDns: TargetDnsRecord = transformDnsData(dnsData);

    logger.log(`Transformed to target format:`, {
      fqdn: transformedDns.fqdn,
      dnsRecordType: transformedDns.dnsRecordType,
      ttlSeconds: transformedDns.ttlSeconds,
    });

    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(callbackUrl, jobId, stepId, { appliedDNS: [transformedDns] }, 1, retryMetadata, STEP_NAME);

    logger.log(`Apply processing completed successfully!`);
  } catch (error) {
    logger.error(`Apply processing failed:`, error);
    await sendFailureCallback(callbackUrl, jobId, stepId, error as Error, retryMetadata, STEP_NAME);
    (error as any).callbackSent = true;
    throw error;
  }
}

function parseMessage(record: SQSRecord): ProcessingWorkMessage {
  try {
    const body = JSON.parse(record.body) as unknown;
    if (typeof body !== "object" || body === null) throw new Error("Message body is not an object");
    const bodyObj = body as Record<string, unknown>;
    if (!bodyObj.jobId || !bodyObj.stepId || !bodyObj.input || !bodyObj.callbackUrl) {
      throw new Error("Missing required fields: jobId, stepId, input, or callbackUrl");
    }
    return bodyObj as unknown as ProcessingWorkMessage;
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
      let message: ProcessingWorkMessage | null = null;
      const processingStartTime = Date.now();
      const sqsAttributes = getSQSMessageAttributes(record);

      try {
        message = parseMessage(record);
        const logger = createLogger(message.correlationId, STEP_NAME);
        const retryMetadata = buildRetryMetadata(sqsAttributes, processingStartTime);
        await processApplyWork(message, retryMetadata, logger);
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
  }

  return { batchItemFailures };
}

export default handler;
