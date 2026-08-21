/**
 * Handler Registry for Simulator Mode
 *
 * Dynamically loads Lambda handler maps and DataSources from environment variables
 * instead of hardcoded imports. This enables the SQS poller simulator to work with
 * any workflow's handlers mounted at runtime.
 *
 * Environment variables:
 *   HANDLER_MAP_PATHS  - Comma-separated paths to compiled handler map modules
 *                        Each must export `handlerMap: Record<queueName, handler>`
 *   DATASOURCE_PATHS   - Comma-separated paths to compiled DataSource modules
 *                        Each exports one or more TypeORM DataSource instances
 */

import "reflect-metadata";

import type { SQSEvent, Context, SQSBatchResponse } from "aws-lambda";
import type { DataSource } from "typeorm";

/**
 * Type for Lambda handler functions
 */
export type LambdaHandler = (
  event: SQSEvent,
  context: Context,
) => Promise<SQSBatchResponse | void>;

/**
 * Registry mapping queue/function names to their handler implementations.
 * Dynamically populated from HANDLER_MAP_PATHS.
 */
export const handlerRegistry: Record<string, LambdaHandler> = {};

/**
 * All workflow DataSources for debug-server mode.
 * Dynamically populated from DATASOURCE_PATHS.
 */
const allDataSources: { name: string; ds: DataSource }[] = [];

// ─── Dynamic Handler Loading ─────────────────────────────────────────────────

const handlerPaths = (process.env.HANDLER_MAP_PATHS || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

for (const handlerPath of handlerPaths) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(handlerPath);
    const map = mod.handlerMap || mod.default || mod;

    if (typeof map === 'object' && map !== null) {
      const count = Object.keys(map).length;
      Object.assign(handlerRegistry, map);
      console.log(`[Handler Registry] Loaded ${count} handler(s) from ${handlerPath}`);
    } else {
      console.warn(`[Handler Registry] No handlerMap found in ${handlerPath}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Handler Registry] Failed to load handlers from ${handlerPath}: ${message}`);
  }
}

// ─── Dynamic DataSource Loading ──────────────────────────────────────────────

const dsPaths = (process.env.DATASOURCE_PATHS || '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

for (const dsPath of dsPaths) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(dsPath);

    for (const [name, val] of Object.entries(mod)) {
      if (
        val &&
        typeof val === 'object' &&
        'isInitialized' in (val as Record<string, unknown>)
      ) {
        allDataSources.push({ name, ds: val as DataSource });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Handler Registry] Failed to load DataSource from ${dsPath}: ${message}`);
  }
}

console.log(
  `[Handler Registry] Loaded ${Object.keys(handlerRegistry).length} handlers, ${allDataSources.length} DataSource(s) for simulator mode`,
);

/**
 * Create a mock Lambda context for in-process handler invocation
 */
export function createMockContext(functionName: string): Context {
  const requestId = `sim-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const startTime = Date.now();

  return {
    callbackWaitsForEmptyEventLoop: true,
    functionName,
    functionVersion: "$LATEST",
    invokedFunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`,
    memoryLimitInMB: "512",
    awsRequestId: requestId,
    logGroupName: `/aws/lambda/${functionName}`,
    logStreamName: `sim-stream-${requestId}`,
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
 * Initialize all DataSources and disable destroy() for debug-server mode.
 */
export async function initDataSourcesForDebugMode(): Promise<void> {
  console.log(
    "[Handler Registry] Pre-initializing DataSources for simulator mode...",
  );

  for (const { name, ds } of allDataSources) {
    try {
      if (!ds.isInitialized) {
        await ds.initialize();
      }
      ds.destroy = async () => {
        /* no-op in simulator mode */
      };
      console.log(`  ✅ ${name} DataSource initialized (destroy disabled)`);
    } catch (error) {
      console.warn(
        `  ⚠️  ${name} DataSource init failed (handlers may initialize on demand): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
