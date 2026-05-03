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
  createInfraProductDataSource,
  destroyInfraProductDataSource,
} from "../../../product-db/src/config/datasource";
import { ProcessedJob } from "../../../product-db/src/entities/processed-job.entity";
import { ProvisionedEnvironment } from "../../../product-db/src/entities/provisioned-environment.entity";
import { ProvisionedNetwork } from "../../../product-db/src/entities/provisioned-network.entity";
import { ProvisionedCompute } from "../../../product-db/src/entities/provisioned-compute.entity";
import { ProvisionedStorage } from "../../../product-db/src/entities/provisioned-storage.entity";
import { ProvisionedDns } from "../../../product-db/src/entities/provisioned-dns.entity";
import { ProvisionedCertificate } from "../../../product-db/src/entities/provisioned-certificate.entity";
import { ProvisionedLoadBalancer } from "../../../product-db/src/entities/provisioned-load-balancer.entity";

/**
 * Record Provisioned Infra Worker Lambda Handler
 *
 * Final step in the infra-provisioning workflow. Reads all provisioned
 * infrastructure data from dependency outputs and writes a complete record
 * to the infra_provisioning_product_db.
 *
 * Does NOT require ACK — sends success callback directly after DB write.
 */

const STEP_NAME = "Record Provisioned Infra";

async function processRecordWork(
  message: ProcessingWorkMessage,
  retryMetadata: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
  },
  logger: WorkerLogger,
): Promise<void> {
  const { jobId, stepId, input, callbackUrl } = message;

  logger.log(`Processing record work`, {
    jobId,
    stepId,
    inputKeys: Object.keys(input),
  });

  await sendInProgressCallback(callbackUrl, jobId, stepId, retryMetadata, STEP_NAME);

  const depData = input.dependencyData as Record<string, Record<string, unknown>> | undefined;

  // Extract data from dependency step outputs
  const appliedEnvironments = (depData?.["ApplyEnvironment"]?.appliedEnvironments as any[]) || [];
  const appliedNetworks = (depData?.["ApplyNetwork"]?.appliedNetworks as any[]) || [];
  const appliedStorage = (depData?.["ApplyStorage"]?.appliedStorage as any[]) || [];
  const appliedDNS = (depData?.["ApplyDNS"]?.appliedDNS as any[]) || [];
  const appliedCertificates = (depData?.["ApplyCertificate"]?.appliedCertificates as any[]) || [];
  const appliedLoadBalancers = (depData?.["ApplyLoadBalancer"]?.appliedLoadBalancers as any[]) || [];
  // Compute is fan-out — ApplyCompute output is per-child; approximate count from DiscoverCompute
  const computeCount = (depData?.["ApplyCompute"]?.appliedCompute as any[])?.length || 0;

  logger.log(`Extracted dependency data`, {
    environmentCount: appliedEnvironments.length,
    networkCount: appliedNetworks.length,
    computeCount,
    storageCount: appliedStorage.length,
    dnsCount: appliedDNS.length,
    certificateCount: appliedCertificates.length,
    loadBalancerCount: appliedLoadBalancers.length,
  });

  const ds = await createInfraProductDataSource();

  try {
    await ds.transaction(async (manager) => {
      // Create the processed job record
      const job = manager.create(ProcessedJob, {
        jobId,
        workflowName: "infra-provisioning",
        completedAt: new Date(),
        environmentCount: appliedEnvironments.length,
        networkCount: appliedNetworks.length,
        computeCount,
        storageCount: appliedStorage.length,
        dnsCount: appliedDNS.length,
        certificateCount: appliedCertificates.length,
        loadBalancerCount: appliedLoadBalancers.length,
      });
      await manager.save(job);

      // Record environments
      for (const e of appliedEnvironments) {
        await manager.save(
          manager.create(ProvisionedEnvironment, {
            jobId,
            sourceEnvId: e.sourceEnvironmentId || null,
            externalEnvId: e.externalEnvironmentId || null,
            name: e.environmentName || e.name || null,
            cloudProvider: e.awsRegion ? "aws" : null,
            region: e.awsRegion || null,
          }),
        );
      }

      // Record networks
      for (const n of appliedNetworks) {
        await manager.save(
          manager.create(ProvisionedNetwork, {
            jobId,
            sourceNetworkId: n.sourceNetworkId || null,
            externalNetworkId: n.externalNetworkId || null,
            externalEnvId: n.externalEnvironmentId || null,
            cidr: n.vpcCidr || n.cidr || null,
          }),
        );
      }

      // Record compute (if available as array)
      const computeArray = (depData?.["ApplyCompute"]?.appliedCompute as any[]) || [];
      for (const c of computeArray) {
        await manager.save(
          manager.create(ProvisionedCompute, {
            jobId,
            sourceComputeId: c.sourceComputeId || null,
            externalComputeId: c.externalComputeId || null,
            externalNetworkId: c.externalNetworkId || c.sourceNetworkId || null,
            instanceType: c.instanceType || null,
            instanceCount: 1,
          }),
        );
      }

      // Record storage
      for (const s of appliedStorage) {
        await manager.save(
          manager.create(ProvisionedStorage, {
            jobId,
            sourceStorageId: s.sourceVolumeId || s.sourceStorageId || null,
            externalStorageId: s.externalStorageId || null,
            externalComputeId: s.externalComputeId || null,
            storageType: s.volumeType || s.storageType || null,
            sizeGb: s.sizeGb ?? null,
          }),
        );
      }

      // Record DNS
      for (const d of appliedDNS) {
        await manager.save(
          manager.create(ProvisionedDns, {
            jobId,
            sourceDnsId: d.sourceRecordId || d.sourceDnsId || null,
            externalDnsId: d.externalDnsId || null,
            externalNetworkId: d.externalNetworkId || d.sourceNetworkId || null,
            zone: d.hostname || d.zone || null,
            recordCount: 1,
          }),
        );
      }

      // Record certificates
      for (const cert of appliedCertificates) {
        await manager.save(
          manager.create(ProvisionedCertificate, {
            jobId,
            sourceCertId: cert.sourceCertificateId || cert.sourceCertId || null,
            externalCertId: cert.externalCertId || null,
            externalDnsId: cert.externalDnsId || null,
            domain: cert.domain || null,
            issuer: cert.issuer || null,
          }),
        );
      }

      // Record load balancers
      for (const lb of appliedLoadBalancers) {
        await manager.save(
          manager.create(ProvisionedLoadBalancer, {
            jobId,
            sourceLbId: lb.sourceLbId || null,
            externalLbId: lb.externalLbId || null,
            externalNetworkId: lb.externalNetworkId || lb.sourceNetworkId || null,
            lbType: lb.lbType || lb.type || null,
            endpoint: lb.endpoint || null,
          }),
        );
      }

      logger.log(`Record transaction committed`, { jobId });
    });

    await sendSuccessCallback(
      callbackUrl,
      jobId,
      stepId,
      {
        recordedJobId: jobId,
        environmentCount: appliedEnvironments.length,
        networkCount: appliedNetworks.length,
        computeCount,
        storageCount: appliedStorage.length,
        dnsCount: appliedDNS.length,
        certificateCount: appliedCertificates.length,
        loadBalancerCount: appliedLoadBalancers.length,
      },
      appliedEnvironments.length + appliedNetworks.length + appliedStorage.length + appliedDNS.length + appliedCertificates.length + appliedLoadBalancers.length,
      retryMetadata,
      STEP_NAME,
    );

    logger.log(`Record processing completed successfully!`);
  } catch (error) {
    logger.error(`Record processing failed:`, error);

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
    await destroyInfraProductDataSource();
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
        await processRecordWork(message, retryMetadata, logger);
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
