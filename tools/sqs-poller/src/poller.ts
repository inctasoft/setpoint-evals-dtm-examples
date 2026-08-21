/**
 * Custom SQS Poller for LocalStack
 *
 * Polls SQS queues and invokes Lambda functions - simulates AWS Event Source Mappings
 *
 * This provides reliable SQS → Lambda triggering in LocalStack Community Edition
 * where Event Source Mapping auto-polling is unreliable.
 *
 * DEBUG-SERVER MODE:
 * When DEBUG_SERVER_MODE=true, the poller runs Lambda handlers in-process
 * instead of invoking them via LocalStack. This enables:
 * - Full breakpoint debugging in VS Code
 * - No Lambda timeout constraints
 * - Faster iteration during development
 */

import "reflect-metadata";

import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { SQSEvent, Context } from "aws-lambda";

// Debug-server mode configuration
const DEBUG_SERVER_MODE = process.env.DEBUG_SERVER_MODE === "true";

// Conditional imports for debug-server mode (loaded dynamically)
let handlerRegistry: Record<
  string,
  (event: SQSEvent, context: Context) => Promise<unknown>
> | null = null;
let createMockContext: ((functionName: string) => Context) | null = null;

// Configuration from environment variables
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "000000000000";
const SQS_ENDPOINT = process.env.AWS_SQS_ENDPOINT || "http://localstack:4566"; // Docker internal port
const LAMBDA_ENDPOINT =
  process.env.AWS_LAMBDA_ENDPOINT || "http://localstack:4566"; // Docker internal port
// The hostname used by the orchestrator when constructing queue URLs for SendMessage.
// LocalStack uses the full QueueUrl (including hostname) to identify queues, so the
// poller must use the SAME hostname as the orchestrator. The SDK connects via SQS_ENDPOINT
// regardless of the QueueUrl hostname.
const SQS_QUEUE_HOST =
  process.env.AWS_SQS_QUEUE_HOST || "http://localstack:4566";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "1000", 10);
const MAX_MESSAGES_PER_POLL = parseInt(
  process.env.MAX_MESSAGES_PER_POLL || "1",
  10,
);
const WAIT_TIME_SECONDS = parseInt(process.env.WAIT_TIME_SECONDS || "5", 10);

// Initialize AWS clients
const sqsClient = new SQSClient({
  region: AWS_REGION,
  endpoint: SQS_ENDPOINT,
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
});

const lambdaClient = new LambdaClient({
  region: AWS_REGION,
  endpoint: LAMBDA_ENDPOINT,
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test",
  },
});

// Dynamic queue discovery from all registered workflow configs
// Each workflow config defines queueName for each step — we collect all unique queue names
import { discoverQueuesFromWorkflows } from "./queue-discovery";

const QUEUES = discoverQueuesFromWorkflows();

// Cache for resolved queue URLs (queue name → canonical SQS URL)
const resolvedQueueUrls = new Map<string, string>();

/**
 * Resolve a queue name to its SQS URL.
 *
 * IMPORTANT: LocalStack matches queues by their full QueueUrl including hostname.
 * The orchestrator sends messages using SQS_QUEUE_HOST (e.g., http://localstack:4566),
 * so we must construct queue URLs with the SAME hostname. The AWS SDK always connects
 * to SQS_ENDPOINT regardless of the hostname in QueueUrl.
 */
async function resolveQueueUrl(queueName: string): Promise<string> {
  const cached = resolvedQueueUrls.get(queueName);
  if (cached) return cached;

  // Use the same hostname the orchestrator uses when sending messages.
  // The SDK sends HTTP requests to SQS_ENDPOINT, but passes this URL as
  // the QueueUrl parameter so LocalStack can match the correct queue.
  const url = `${SQS_QUEUE_HOST}/${AWS_ACCOUNT_ID}/${queueName}`;
  resolvedQueueUrls.set(queueName, url);
  return url;
}

// Statistics tracking
const stats = {
  totalPolls: 0,
  totalMessages: 0,
  totalInvocations: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  startTime: new Date(),
};

/**
 * Initialize debug-server mode by loading handler registry
 */
async function initDebugServerMode(): Promise<void> {
  if (!DEBUG_SERVER_MODE) return;

  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   🔬 DEBUG-SERVER MODE ENABLED                 ║");
  console.log("║   Handlers will run IN-PROCESS (debuggable)   ║");
  console.log("╚════════════════════════════════════════════════╝");
  console.log("");

  // CRITICAL: Globally disable DataSource.destroy() BEFORE loading any handlers.
  // In debug-server mode, all handlers share the same process and DataSource connections.
  // Each handler's finally block calls destroy(), which tears down shared connections.
  // Patching the prototype ensures ALL DataSource instances (regardless of module
  // resolution path — source .ts vs compiled dist/) have destroy() as a no-op.
  try {
    const { DataSource } = await import("typeorm");
    DataSource.prototype.destroy = async function () {
      // no-op in debug-server mode — connections are shared across handlers
    };
    console.log(
      "✅ DataSource.prototype.destroy patched (connections persist across handlers)",
    );
  } catch (error) {
    console.warn(
      "⚠️  Could not patch DataSource.prototype.destroy:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    // Dynamic import of handler registry
    const registry = await import("./handler-registry");
    handlerRegistry = registry.handlerRegistry;
    createMockContext = registry.createMockContext;

    console.log(
      `✅ Loaded ${Object.keys(handlerRegistry).length} handlers for in-process execution`,
    );
    console.log("   Set breakpoints in handler code and they will be hit!");
    console.log("");

    // Pre-initialize DataSources to prevent race conditions in concurrent handlers
    await registry.initDataSourcesForDebugMode();
    console.log("");
  } catch (error) {
    console.error("❌ Failed to load handler registry:", error);
    console.error("   Make sure lambda-workers package is built");
    process.exit(1);
  }
}

/**
 * Invoke handler in debug-server mode (in-process)
 */
async function invokeHandlerInProcess(
  functionName: string,
  lambdaEvent: SQSEvent,
): Promise<{ success: boolean; response?: unknown; error?: string }> {
  if (!handlerRegistry || !createMockContext) {
    return { success: false, error: "Handler registry not initialized" };
  }

  const handler = handlerRegistry[functionName];
  if (!handler) {
    return { success: false, error: `No handler found for ${functionName}` };
  }

  try {
    const context = createMockContext(functionName);
    const result = await handler(lambdaEvent, context);
    return { success: true, response: result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Invoke handler via LocalStack Lambda (normal mode)
 */
async function invokeHandlerViaLocalStack(
  functionName: string,
  lambdaEvent: SQSEvent,
): Promise<{
  success: boolean;
  response?: unknown;
  error?: string;
  functionError?: string;
}> {
  try {
    const invokeResponse = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(lambdaEvent)),
      }),
    );

    if (invokeResponse.FunctionError) {
      const payload = invokeResponse.Payload
        ? JSON.parse(Buffer.from(invokeResponse.Payload).toString())
        : null;
      return {
        success: false,
        functionError: invokeResponse.FunctionError,
        error: JSON.stringify(payload),
      };
    }

    const response = invokeResponse.Payload
      ? JSON.parse(Buffer.from(invokeResponse.Payload).toString())
      : {};

    return { success: true, response };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Poll a single SQS queue for messages
 */
async function pollQueue(queueName: string): Promise<void> {
  const queueUrl = await resolveQueueUrl(queueName);
  // Queue name matches Lambda function name
  const functionName = queueName;

  try {
    // Receive messages from SQS
    // DataSource.prototype.destroy is globally patched in debug-server mode,
    // making parallel handler execution safe (connections are never torn down).
    const receiveResponse = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: MAX_MESSAGES_PER_POLL,
        WaitTimeSeconds: WAIT_TIME_SECONDS,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    );

    const messages = receiveResponse.Messages || [];

    if (messages.length > 0) {
      console.log(`[${queueName}] Received ${messages.length} message(s)`);
      stats.totalMessages += messages.length;

      // Log message payloads for debugging
      messages.forEach((msg, idx) => {
        try {
          const body = JSON.parse(msg.Body || "{}");
          console.log(
            `[${queueName}] Message ${idx + 1} full payload:`,
            JSON.stringify(body, null, 2),
          );
        } catch (e) {
          console.log(
            `[${queueName}] Message ${idx + 1} body (parse failed):`,
            msg.Body?.substring(0, 500),
          );
        }
      });

      // Format messages as Lambda SQS event
      // Using 'as unknown as SQSEvent' because SQS SDK types don't perfectly match Lambda types
      const lambdaEvent = {
        Records: messages.map((msg) => ({
          messageId: msg.MessageId!,
          receiptHandle: msg.ReceiptHandle!,
          body: msg.Body!,
          attributes: {
            ApproximateReceiveCount:
              msg.Attributes?.ApproximateReceiveCount || "1",
            SentTimestamp:
              msg.Attributes?.SentTimestamp || Date.now().toString(),
            SenderId: msg.Attributes?.SenderId || "local",
            ApproximateFirstReceiveTimestamp:
              msg.Attributes?.ApproximateFirstReceiveTimestamp ||
              Date.now().toString(),
          },
          messageAttributes: {},
          md5OfBody: msg.MD5OfBody!,
          eventSource: "aws:sqs",
          eventSourceARN: `arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${queueName}`,
          awsRegion: AWS_REGION,
        })),
      } as unknown as SQSEvent;

      // Invoke handler (either in-process or via LocalStack)
      try {
        stats.totalInvocations++;

        let invokeResult: {
          success: boolean;
          response?: unknown;
          error?: string;
          functionError?: string;
        };

        if (DEBUG_SERVER_MODE) {
          console.log(
            `[${queueName}] 🔬 Invoking handler IN-PROCESS (debug mode)`,
          );
          invokeResult = await invokeHandlerInProcess(
            functionName,
            lambdaEvent,
          );
        } else {
          invokeResult = await invokeHandlerViaLocalStack(
            functionName,
            lambdaEvent,
          );
        }

        // Check if invocation was successful
        if (!invokeResult.success) {
          if (invokeResult.functionError) {
            console.error(
              `[${queueName}] ❌ Lambda error:`,
              invokeResult.functionError,
            );
          }
          console.error(`[${queueName}] Error details:`, invokeResult.error);
          stats.totalFailures++;

          // Don't delete messages on error - they'll become visible again
          return;
        }

        const lambdaResponse =
          (invokeResult.response as Record<string, unknown>) || {};

        console.log(
          `[${queueName}] ✅ ${DEBUG_SERVER_MODE ? "Handler executed" : "Lambda invoked"} successfully`,
        );

        // Check for partial batch failures (AWS Lambda standard)
        const batchItemFailures = (lambdaResponse.batchItemFailures ||
          []) as Array<{ itemIdentifier: string }>;
        let failedMessageIds = new Set(
          batchItemFailures.map((item) => item.itemIdentifier),
        );

        if (failedMessageIds.size > 0) {
          console.log(
            `[${queueName}] ⚠️  ${failedMessageIds.size} message(s) marked for retry`,
          );
          stats.totalFailures += failedMessageIds.size;
          stats.totalSuccesses += messages.length - failedMessageIds.size;
        } else {
          stats.totalSuccesses += messages.length;
        }

        // In debug-server mode, force-delete messages that have exceeded max retries.
        // There is no DLQ in LocalStack, so without this, failed messages retry forever.
        // The handler already sends failure callbacks to the orchestrator, so the
        // orchestrator knows about the failure regardless of SQS retry behavior.
        const DEBUG_MAX_RECEIVE_COUNT = 3;
        if (DEBUG_SERVER_MODE && failedMessageIds.size > 0) {
          for (const message of messages) {
            if (failedMessageIds.has(message.MessageId!)) {
              const receiveCount = parseInt(
                message.Attributes?.ApproximateReceiveCount || "1",
                10,
              );
              if (receiveCount >= DEBUG_MAX_RECEIVE_COUNT) {
                console.log(
                  `[${queueName}] 🗑️  Force-deleting message ${message.MessageId} after ${receiveCount} receives (debug mode, no DLQ)`,
                );
                failedMessageIds.delete(message.MessageId!);
              }
            }
          }
        }

        // Delete only successfully processed messages (not in batchItemFailures)
        let deletedCount = 0;
        let skippedCount = 0;

        for (const message of messages) {
          const messageId = message.MessageId;

          if (failedMessageIds.has(messageId!)) {
            console.log(
              `[${queueName}] 🔄 Keeping message ${messageId} for retry`,
            );
            skippedCount++;
            // Don't delete - let visibility timeout expire for SQS retry
            continue;
          }

          // Delete successfully processed message
          await sqsClient.send(
            new DeleteMessageCommand({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
          deletedCount++;
        }

        console.log(
          `[${queueName}] 🗑️  Deleted ${deletedCount} message(s), kept ${skippedCount} for retry`,
        );
      } catch (handlerError) {
        console.error(
          `[${queueName}] ❌ Failed to invoke handler:`,
          handlerError,
        );
        stats.totalFailures++;
        // Don't delete messages - they'll become visible again
      }
    }

    stats.totalPolls++;
  } catch (error) {
    console.error(`[${queueName}] ❌ Polling error:`, error);
  }
}

/**
 * Get queue statistics
 */
async function getQueueStats(
  queueName: string,
): Promise<{ available: number; inFlight: number }> {
  const queueUrl = await resolveQueueUrl(queueName);

  try {
    const response = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
        ],
      }),
    );

    return {
      available: parseInt(
        response.Attributes?.ApproximateNumberOfMessages || "0",
        10,
      ),
      inFlight: parseInt(
        response.Attributes?.ApproximateNumberOfMessagesNotVisible || "0",
        10,
      ),
    };
  } catch (error) {
    return { available: 0, inFlight: 0 };
  }
}

/**
 * Print statistics
 */
function printStats(): void {
  const uptime = Math.floor((Date.now() - stats.startTime.getTime()) / 1000);
  const successRate =
    stats.totalInvocations > 0
      ? ((stats.totalSuccesses / stats.totalInvocations) * 100).toFixed(1)
      : "0.0";

  console.log("\n" + "=".repeat(80));
  console.log(
    `📊 POLLER STATISTICS ${DEBUG_SERVER_MODE ? "(DEBUG-SERVER MODE)" : ""}`,
  );
  console.log("=".repeat(80));
  console.log(`⏱️  Uptime:          ${uptime}s`);
  console.log(`🔄 Total Polls:      ${stats.totalPolls}`);
  console.log(`📨 Messages Received: ${stats.totalMessages}`);
  console.log(
    `🚀 ${DEBUG_SERVER_MODE ? "Handler Executions" : "Lambda Invocations"}: ${stats.totalInvocations}`,
  );
  console.log(`✅ Successes:        ${stats.totalSuccesses} (${successRate}%)`);
  console.log(`❌ Failures:         ${stats.totalFailures}`);
  console.log("=".repeat(80) + "\n");
}

/**
 * Main polling loop
 */
async function main(): Promise<void> {
  // Initialize debug-server mode if enabled
  await initDebugServerMode();

  if (!DEBUG_SERVER_MODE) {
    console.log("╔════════════════════════════════════════════════╗");
    console.log("║   Custom SQS Poller for LocalStack            ║");
    console.log("╚════════════════════════════════════════════════╝");
  }

  console.log("");
  console.log("Configuration:");
  console.log(
    `  Mode:               ${DEBUG_SERVER_MODE ? "🔬 DEBUG-SERVER (in-process)" : "🚀 NORMAL (LocalStack Lambda)"}`,
  );
  console.log(`  SQS Endpoint:       ${SQS_ENDPOINT}`);
  if (!DEBUG_SERVER_MODE) {
    console.log(`  Lambda Endpoint:    ${LAMBDA_ENDPOINT}`);
  }
  console.log(`  Poll Interval:      ${POLL_INTERVAL_MS}ms`);
  console.log(`  Max Messages/Poll:  ${MAX_MESSAGES_PER_POLL}`);
  console.log(`  Wait Time:          ${WAIT_TIME_SECONDS}s (long polling)`);
  console.log(`  Queues:             ${QUEUES.length}`);
  console.log("");

  // Pre-resolve all queue URLs (LocalStack uses domain-based URLs)
  console.log("Resolving queue URLs...");
  await Promise.all(QUEUES.map((q) => resolveQueueUrl(q)));
  console.log(`  Resolved ${resolvedQueueUrls.size} queue URLs`);
  // Log first resolved URL as a sample
  const sampleEntry = resolvedQueueUrls.entries().next().value;
  if (sampleEntry) {
    console.log(`  Sample: ${sampleEntry[0]} → ${sampleEntry[1]}`);
  }
  console.log("");
  console.log("🚀 Starting polling...");
  console.log("");

  // Print statistics every 30 seconds
  setInterval(() => {
    printStats();
  }, 30000);

  // Main polling loop
  // All queues polled in parallel. In debug-server mode, DataSource.prototype.destroy
  // is globally patched to no-op, making concurrent handler execution safe.
  while (true) {
    try {
      await Promise.all(QUEUES.map((queue) => pollQueue(queue)));

      // Wait before next poll cycle
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      console.error("❌ Polling cycle error:", error);
      // Wait a bit longer on error
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 2));
    }
  }
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n📊 Final Statistics:");
  printStats();
  console.log("👋 Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\n📊 Final Statistics:");
  printStats();
  console.log("👋 Shutting down gracefully...");
  process.exit(0);
});

// Start the poller
main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
