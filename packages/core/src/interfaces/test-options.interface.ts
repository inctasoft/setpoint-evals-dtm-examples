/**
 * Test Options Interfaces
 *
 * Task-type-keyed test options for controlling step execution during testing.
 * Each step can have its own TestOptionSet that controls delays, failures,
 * and ACK behavior.
 *
 * Usage in job creation payload:
 * ```json
 * {
 *   "workflowVariant": "default",
 *   "input": { "customerId": "CUST-1000" },
 *   "testOptions": {
 *     "ValidateCustomer": { "simDelay": 500 },
 *     "SubmitCustomer": { "failOnAttempts": [1, 2] },
 *     "SubmitOrder": { "ackDelay": 2000 }
 *   }
 * }
 * ```
 *
 * Security: testOptions only work when ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true.
 * In production, this env var is absent and all testOptions are ignored.
 */

/**
 * Test option set for a single step.
 * All fields are optional — omitted fields mean "use default (real) behavior".
 */
export interface TestOptionSet {
  /**
   * Simulated delay (ms) before the worker starts processing.
   * Useful for testing timeout handling and race conditions.
   */
  simDelay?: number;

  /**
   * Simulated delay (ms) after processing but before callback.
   * Useful for testing "worker completed but callback delayed" scenarios.
   */
  failureAfter?: number;

  /**
   * Attempt numbers on which the worker should simulate failure.
   * 1-indexed: [1] = fail first attempt, [1, 2] = fail first two attempts.
   * After listed attempts, worker succeeds normally (tests retry recovery).
   */
  failOnAttempts?: number[];

  /**
   * Item IDs for which the worker should simulate failure.
   * Only applies to fan-out child steps processing specific items.
   * Example: ["ORD-001", "ORD-003"] = fail processing for these two items.
   */
  failForItemIds?: string[];

  /**
   * Simulated delay (ms) before the ACK simulator sends the Kafka ACK.
   * Only relevant for steps with requiresAcknowledgement: true.
   */
  ackDelay?: number;

  /**
   * If true, the ACK simulator will NOT send an ACK for this step.
   * Tests stuck-in-WAITING_FOR_ACK recovery.
   */
  skipAck?: boolean;

  /**
   * If true, simulates a crash between worker completion and ACK arrival.
   * The worker completes, but the ACK is never delivered (lost in transit).
   */
  crashBeforeAck?: boolean;

  /**
   * Custom ACK payload to return instead of the default.
   * Overrides the ACK simulator's default payload generation.
   */
  ackPayload?: Record<string, unknown>;
}
