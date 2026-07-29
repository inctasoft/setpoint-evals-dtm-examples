/**
 * Handler Registry — zmq-worker-host
 *
 * Resolves the handlerMap and DataSource for the ONE workflow this host
 * serves (WORKFLOW_NAME). Mirrors the sqs-poller's debug-server mode: the
 * SAME workflow-exported `handlerMap` (Record<queueName, handler>) is invoked
 * in-process, the workflow DataSource is pre-initialized, and
 * DataSource.destroy() is neutralized so concurrent handlers never tear down
 * shared connections.
 *
 * ISOLATION: each host container bind-mounts ONLY its own workflow's
 * packages (config, workers, source-db typeorm) into /app/node_modules.
 * Every workflow package resolution here is therefore a LAZY require inside
 * the switch body — static imports would force every host to resolve every
 * workflow at load time and crash-loop the container.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: lazy
 * per-case require() is the isolation mechanism documented above. */

// Must import reflect-metadata before any TypeORM entity decorators are evaluated
import "reflect-metadata";

import type { SQSEvent, Context, SQSBatchResponse } from "aws-lambda";
import type { DataSource } from "typeorm";

export type LambdaHandler = (
  event: SQSEvent,
  context: Context,
) => Promise<SQSBatchResponse | void>;

const REGISTERED_WORKFLOW_NAMES = [
  "infra-provisioning",
  "iot-sensor-pipeline",
  "order-processing",
];

function unknownWorkflow(workflowName: string, what: string): Error {
  return new Error(
    `No ${what} for workflow '${workflowName}'. Registered: ${REGISTERED_WORKFLOW_NAMES.join(", ")}`,
  );
}

/**
 * Handler map for ONE workflow, loaded lazily (fail fast on unknown name).
 */
export function getHandlerMapForWorkflow(
  workflowName: string,
): Record<string, LambdaHandler> {
  switch (workflowName) {
    case "order-processing": {
      const { handlerMap } = require("@dtm-workflows/order-processing-workers");
      return handlerMap;
    }
    case "iot-sensor-pipeline": {
      const {
        handlerMap,
      } = require("@dtm-workflows/iot-sensor-pipeline-workers");
      return handlerMap;
    }
    case "infra-provisioning": {
      const {
        handlerMap,
      } = require("@dtm-workflows/infra-provisioning-workers");
      return handlerMap;
    }
    default:
      throw unknownWorkflow(workflowName, "handler map");
  }
}

/** The served workflow's source-db DataSource, loaded lazily. */
function getDataSourceForWorkflow(workflowName: string): {
  name: string;
  ds: DataSource;
} {
  switch (workflowName) {
    case "order-processing": {
      const {
        OrderProcessingDataSource,
      } = require("@dtm-workflows/order-processing-typeorm");
      return { name: "OrderProcessing", ds: OrderProcessingDataSource };
    }
    case "iot-sensor-pipeline": {
      const {
        IotSensorDataSource,
      } = require("@dtm-workflows/iot-sensor-pipeline-typeorm");
      return { name: "IotSensor", ds: IotSensorDataSource };
    }
    case "infra-provisioning": {
      const {
        InfraProvisioningDataSource,
      } = require("@dtm-workflows/infra-provisioning-typeorm");
      return { name: "InfraProvisioning", ds: InfraProvisioningDataSource };
    }
    default:
      throw unknownWorkflow(workflowName, "DataSource");
  }
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
 * Pre-initialize the SERVED workflow's DataSource (only that one) and
 * neutralize destroy(). Handlers call destroy() in their finally blocks
 * (written for one-shot Lambda executions); in a long-lived in-process host
 * that would tear down the shared connection mid-flight for sibling handlers.
 */
export async function initWorkflowDataSource(
  workflowName: string,
): Promise<void> {
  const { name, ds } = getDataSourceForWorkflow(workflowName);

  try {
    if (!ds.isInitialized) {
      await ds.initialize();
    }
    ds.destroy = async () => {
      /* no-op in the long-lived worker host */
    };
    console.log(`  ✅ ${name} DataSource initialized (destroy disabled)`);
  } catch (error) {
    console.warn(
      `  ⚠️  ${name} DataSource init failed (handlers may initialize on demand): ${error instanceof Error ? error.message : error}`,
    );
  }
}
