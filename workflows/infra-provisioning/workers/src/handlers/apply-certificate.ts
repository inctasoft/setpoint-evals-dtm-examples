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
 * Apply Certificate Worker Lambda Handler
 *
 * Receives TLS certificate data from the orchestrator, applies transformations
 * to convert from source format to target provisioning format.
 *
 * Dependencies: PlanCertificate
 *
 * Transformation mappings (Source -> Target):
 *   - certificateId -> sourceCertificateId
 *   - dnsRecordId -> sourceDnsRecordId
 *   - domain -> certificateDomain
 *   - issuer -> certificateAuthority
 *   - status -> provisioningStatus
 *   - issuedAt -> sourceIssuedAt
 *   - expiresAt -> expirationDate
 */

const STEP_NAME = "Apply Certificate";

interface SourceCertificate {
  certificateId: string;
  dnsRecordId: string;
  domain: string;
  issuer: string;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface TargetCertificate {
  sourceCertificateId: string;
  sourceDnsRecordId: string;
  certificateDomain: string;
  certificateAuthority: string;
  provisioningStatus: string;
  sourceIssuedAt: string | null;
  expirationDate: string | null;
  sourceCreatedAt: string;
  transformedAt: string;
}

function transformCertificateData(source: SourceCertificate): TargetCertificate {
  return {
    sourceCertificateId: source.certificateId,
    sourceDnsRecordId: source.dnsRecordId,
    certificateDomain: source.domain.toLowerCase(),
    certificateAuthority: source.issuer,
    provisioningStatus: source.status,
    sourceIssuedAt: source.issuedAt,
    expirationDate: source.expiresAt,
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

  const planCertificateData = dependencyData["PlanCertificate"] as Record<string, unknown> | undefined;
  if (!planCertificateData) {
    throw new Error("Missing PlanCertificate data in dependencyData (check step dependencies)");
  }

  const certificateData = planCertificateData.certificate as SourceCertificate;
  if (!certificateData) throw new Error("Missing certificate field in PlanCertificate data");

  logger.log(`Extracted certificate data:`, {
    certificateId: certificateData.certificateId,
    domain: certificateData.domain,
    issuer: certificateData.issuer,
    status: certificateData.status,
  });

  const stepOpts = getMyTestOptions(message);
  await simulateFailure(stepOpts?.failureAfter, stepOpts?.failOnAttempts, retryMetadata.sqsReceiveCount, STEP_NAME);
  await simulateWork(stepOpts?.simDelay, STEP_NAME);

  try {
    logger.log(`Applying transformations (Source -> Target)...`);
    const transformedCertificate: TargetCertificate = transformCertificateData(certificateData);

    logger.log(`Transformed to target format:`, {
      certificateDomain: transformedCertificate.certificateDomain,
      certificateAuthority: transformedCertificate.certificateAuthority,
    });

    logger.log(`Sending transformed data to orchestrator...`);
    await sendSuccessCallback(callbackUrl, jobId, stepId, { appliedCertificates: [transformedCertificate] }, 1, retryMetadata, STEP_NAME);

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
