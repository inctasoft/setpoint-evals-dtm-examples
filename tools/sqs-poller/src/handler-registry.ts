/**
 * Handler Registry for Debug-Server Mode
 *
 * This module provides a registry of all Lambda handlers that can be invoked
 * directly in-process when running in DEBUG_SERVER_MODE.
 *
 * Instead of invoking Lambda functions via LocalStack, the poller can
 * call these handlers directly, enabling:
 * - Full breakpoint debugging in VS Code
 * - No Lambda timeout constraints
 * - Faster iteration during development
 *
 * Multi-Workflow Support:
 * Each workflow exports a `handlerMap` (Record<queueName, handler>) that maps
 * SQS queue names to handler functions. This registry merges all handler maps
 * from all registered workflows.
 *
 * Adding a new workflow:
 * 1. Create handlers in workflows/&lt;name&gt;/workers/src/handlers/
 * 2. Export a `handlerMap` from workflows/&lt;name&gt;/workers/src/index.ts
 * 3. Import and spread it into the registry below
 */

// Must import reflect-metadata before any TypeORM entity decorators are evaluated
import "reflect-metadata";

import type { SQSEvent, Context, SQSBatchResponse } from "aws-lambda";

// Import handler maps from all workflow packages
// Each workflow exports a handlerMap: Record<queueName, handler>
import { handlerMap as orderProcessingHandlers } from "@dtm-workflows/order-processing-workers";
import { handlerMap as iotSensorPipelineHandlers } from "@dtm-workflows/iot-sensor-pipeline-workers";
import { handlerMap as infraProvisioningHandlers } from "@dtm-workflows/infra-provisioning-workers";

// Import DataSources for debug-server mode pre-initialization
import { OrderProcessingDataSource } from "@dtm-workflows/order-processing-typeorm";
import { IotSensorDataSource } from "@dtm-workflows/iot-sensor-pipeline-typeorm";
import { InfraProvisioningDataSource } from "@dtm-workflows/infra-provisioning-typeorm";
import type { DataSource } from "typeorm";

/**
 * Type for Lambda handler functions
 */
export type LambdaHandler = (
  event: SQSEvent,
  context: Context,
) => Promise<SQSBatchResponse | void>;

/**
 * Registry mapping queue/function names to their handler implementations
 *
 * Dynamically built from all workflow handler maps.
 * The queue name in SQS matches the Lambda function name.
 */
export const handlerRegistry: Record<string, LambdaHandler> = {
  // order-processing handlers
  ...orderProcessingHandlers,

  // iot-sensor-pipeline handlers
  ...iotSensorPipelineHandlers,

  // infra-provisioning handlers
  ...infraProvisioningHandlers,
};

/**
 * Create a mock Lambda context for in-process handler invocation
 *
 * This provides a Context object that satisfies the Lambda handler signature
 * but with extended timeouts suitable for debugging.
 *
 * @param functionName - The name of the Lambda function being invoked
 * @returns A mock Context object
 */
export function createMockContext(functionName: string): Context {
  const requestId = `debug-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const startTime = Date.now();

  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName,
    functionVersion: "$LATEST",
    invokedFunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`,
    memoryLimitInMB: "512",
    awsRequestId: requestId,
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: `debug-stream-${requestId}`,

    // 15 minutes remaining time (no timeout constraint for debugging)
    getRemainingTimeInMillis: () =>
      Math.max(0, 900000 - (Date.now() - startTime)),

    // Callback-style handlers (not used in async handlers, but required by interface)
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
 * Check if a function name has a registered handler
 */
export function hasHandler(functionName: string): boolean {
  return functionName in handlerRegistry;
}

/**
 * Get handler for a function name, or undefined if not found
 */
export function getHandler(functionName: string): LambdaHandler | undefined {
  return handlerRegistry[functionName];
}

/**
 * Get list of all registered function names
 */
export function getRegisteredFunctionNames(): string[] {
  return Object.keys(handlerRegistry);
}

/**
 * All workflow DataSources for debug-server mode.
 * In debug-server mode, all handlers run in the same process and share DataSources.
 * We pre-initialize them and disable destroy() to prevent race conditions
 * where one handler destroys the DataSource while another is using it.
 */
const allDataSources: { name: string; ds: DataSource }[] = [
  { name: "OrderProcessing", ds: OrderProcessingDataSource },
  { name: "IotSensor", ds: IotSensorDataSource },
  { name: "InfraProvisioning", ds: InfraProvisioningDataSource },
];

/**
 * Initialize all DataSources and disable destroy() for debug-server mode.
 * This prevents race conditions when multiple handlers share the same DataSource.
 */
export async function initDataSourcesForDebugMode(): Promise<void> {
  console.log(
    "[Handler Registry] Pre-initializing DataSources for debug-server mode...",
  );

  for (const { name, ds } of allDataSources) {
    try {
      if (!ds.isInitialized) {
        await ds.initialize();
      }
      // Override destroy to prevent handlers from tearing down shared connections
      ds.destroy = async () => {
        /* no-op in debug-server mode */
      };
      console.log(`  ✅ ${name} DataSource initialized (destroy disabled)`);
    } catch (error) {
      console.warn(
        `  ⚠️  ${name} DataSource init failed (handlers may initialize on demand): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

console.log(
  `[Handler Registry] Loaded ${Object.keys(handlerRegistry).length} handlers for debug-server mode`,
);
