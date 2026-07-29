/**
 * Handler Registry — zmq-worker-host
 *
 * Resolves the handlerMap and DataSources for the ONE workflow this host
 * serves (WORKFLOW_NAME). Mirrors the sqs-poller's debug-server mode: the
 * SAME workflow-exported `handlerMap` (Record<queueName, handler>) is invoked
 * in-process, DataSources are pre-initialized, and DataSource.destroy() is
 * neutralized so concurrent handlers never tear down shared connections.
 */

// Must import reflect-metadata before any TypeORM entity decorators are evaluated
import "reflect-metadata";

import type { SQSEvent, Context, SQSBatchResponse } from "aws-lambda";
import type { DataSource } from "typeorm";

import { handlerMap as orderProcessingHandlers } from "@dtm-workflows/order-processing-workers";
import { handlerMap as iotSensorPipelineHandlers } from "@dtm-workflows/iot-sensor-pipeline-workers";
import { handlerMap as infraProvisioningHandlers } from "@dtm-workflows/infra-provisioning-workers";

import { OrderProcessingDataSource } from "@dtm-workflows/order-processing-typeorm";
import { IotSensorDataSource } from "@dtm-workflows/iot-sensor-pipeline-typeorm";
import { InfraProvisioningDataSource } from "@dtm-workflows/infra-provisioning-typeorm";

export type LambdaHandler = (
  event: SQSEvent,
  context: Context,
) => Promise<SQSBatchResponse | void>;

const HANDLER_MAPS: Record<string, Record<string, LambdaHandler>> = {
  "order-processing": orderProcessingHandlers,
  "iot-sensor-pipeline": iotSensorPipelineHandlers,
  "infra-provisioning": infraProvisioningHandlers,
};

const WORKFLOW_DATA_SOURCES: Record<string, { name: string; ds: DataSource }> =
  {
    "order-processing": {
      name: "OrderProcessing",
      ds: OrderProcessingDataSource,
    },
    "iot-sensor-pipeline": { name: "IotSensor", ds: IotSensorDataSource },
    "infra-provisioning": {
      name: "InfraProvisioning",
      ds: InfraProvisioningDataSource,
    },
  };

/**
 * Handler map for one workflow. Throws on an unknown name (fail fast at boot).
 */
export function getHandlerMapForWorkflow(
  workflowName: string,
): Record<string, LambdaHandler> {
  const handlerMap = HANDLER_MAPS[workflowName];
  if (!handlerMap) {
    throw new Error(
      `No handler map for workflow '${workflowName}'. Registered: ${Object.keys(HANDLER_MAPS).sort().join(", ")}`,
    );
  }
  return handlerMap;
}

/**
 * Mock Lambda context for in-process handler invocation
 * (same shape the sqs-poller debug-server mode uses).
 */
export function createMockContext(functionName: string): Context {
  const requestId = `zmq-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const startTime = Date.now();

  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName,
    functionVersion: "$LATEST",
    invokedFunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`,
    memoryLimitInMB: "512",
    awsRequestId: requestId,
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: `zmq-stream-${requestId}`,

    getRemainingTimeInMillis: () =>
      Math.max(0, 900000 - (Date.now() - startTime)),

    done: (error?: Error, result?: unknown) => {
      if (error) console.error("Lambda done with error:", error);
      else console.log("Lambda done:", result);
    },
    fail: (error: Error | string) => {
      console.error("Lambda failed:", error);
    },
    succeed: (messageOrObject: unknown) => {
      console.log("Lambda succeeded:", messageOrObject);
    },
  };
}

/**
 * Pre-initialize the workflow's DataSource and neutralize destroy().
 * Handlers call destroy() in their finally blocks (written for one-shot
 * Lambda executions); in a long-lived in-process host that would tear down
 * the shared connection mid-flight for sibling handlers.
 */
export async function initWorkflowDataSource(
  workflowName: string,
): Promise<void> {
  const entry = WORKFLOW_DATA_SOURCES[workflowName];
  if (!entry) {
    throw new Error(`No DataSource registered for workflow '${workflowName}'`);
  }

  try {
    if (!entry.ds.isInitialized) {
      await entry.ds.initialize();
    }
    entry.ds.destroy = async () => {
      /* no-op in the long-lived worker host */
    };
    console.log(`  ✅ ${entry.name} DataSource initialized (destroy disabled)`);
  } catch (error) {
    console.warn(
      `  ⚠️  ${entry.name} DataSource init failed (handlers may initialize on demand): ${error instanceof Error ? error.message : error}`,
    );
  }
}
