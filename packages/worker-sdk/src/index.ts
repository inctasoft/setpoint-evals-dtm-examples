/**
 * Lambda Worker Utilities
 *
 * Shared utilities for all Lambda workers to ensure consistency
 * and reduce code duplication across Source and Processing workers.
 *
 * Features:
 * - Simulation utilities (delays, failures) for testing/demo
 * - Callback utilities for communicating with orchestrator
 * - SQS utilities for retry tracking and batch processing
 * - Shared TypeScript types and interfaces
 */

// Export all types
export * from "./types";

// Export simulation utilities
export {
  simulateWork,
  simulateFailure,
  getSimulatedDelays,
  getMyTestOptions,
} from "./simulation";

// Export test option types
export type { TestOptionSet } from "./simulation";

// Export callback utilities
export {
  sendInProgressCallback,
  sendSuccessCallback,
  sendFailureCallback,
} from "./callbacks";

// Export SQS utilities
export {
  getSQSMessageAttributes,
  createBatchItemFailure,
  buildRetryMetadata,
} from "./sqs-utils";

// Export logger
export { createLogger, WorkerLogger } from "./logger";
