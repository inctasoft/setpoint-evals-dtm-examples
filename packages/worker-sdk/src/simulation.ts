/**
 * Simulation utilities for testing/demonstration purposes
 *
 * Security: All simulation functions check ENABLE_REQUESTS_FOR_SIMULATED_DELAYS
 * to prevent potential abuse where clients could DOS the system with large delays
 * or cause failures in production.
 */

/**
 * Simulate work delay for testing/demonstration purposes
 *
 * @param delayMs - Delay in milliseconds (from testOptions in payload)
 * @param stepName - Name of the step being simulated
 *
 * Security: Only applies delays if ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
 * This prevents potential abuse where clients could DOS the system with large delays
 *
 * Validation: Delays are capped at 13 seconds to ensure they complete before Lambda timeout (15s)
 */
export async function simulateWork(
  delayMs: number | undefined,
  stepName: string,
): Promise<void> {
  // Security check: Only allow simulated delays if explicitly enabled via environment variable
  const isSimulationEnabled =
    process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS === "true";

  if (!isSimulationEnabled) {
    if (delayMs && delayMs > 0) {
      console.log(
        `[${stepName}] ⚠️ Simulated delay requested (${delayMs}ms) but ENABLE_REQUESTS_FOR_SIMULATED_DELAYS is not enabled - skipping`,
      );
    }
    return;
  }

  if (delayMs && delayMs > 0) {
    // Validate delay doesn't exceed safe limit (13s for 15s Lambda timeout)
    const MAX_SAFE_DELAY_MS = 13000; // 13 seconds (2s buffer for Lambda timeout of 15s)

    if (delayMs > MAX_SAFE_DELAY_MS) {
      throw new Error(
        `[${stepName}] ❌ INVALID SIMULATED DELAY: ${delayMs}ms exceeds maximum safe limit of ${MAX_SAFE_DELAY_MS}ms (Lambda timeout is 15s, need 2s buffer for processing)`,
      );
    }

    console.log(
      `[${stepName}] 🕐 Simulating work for ${delayMs}ms (for testing/demo purposes)...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    console.log(`[${stepName}] ✓ Simulated work completed`);
  }
}

/**
 * Simulate failure for testing purposes with retry-awareness
 *
 * @param failureAfterMs - Time to wait before throwing error (optional, defaults to 0)
 * @param failOnAttempts - Array of attempt numbers that should fail (1-indexed). If omitted, all attempts fail
 * @param currentAttempt - Current retry attempt number (from SQS ApproximateReceiveCount)
 * @param stepName - Name of the step being simulated
 *
 * Security: Only simulates failures if ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
 * This prevents potential abuse where clients could cause failures in production
 *
 * Usage Patterns:
 * 1. Specific attempts: { failOnAttempts: [1, 2, 3] }
 *    - Fails immediately on attempts 1, 2, 3
 *    - No delay parameter needed
 *
 * 2. Specific attempts with delay: { failureAfterMs: 100, failOnAttempts: [1, 2] }
 *    - Waits 100ms then fails on attempts 1 & 2
 *    - Succeeds on attempt 3
 *
 * 3. All attempts with delay: { failureAfterMs: 100 }
 *    - Waits 100ms then fails on ALL attempts (exhausts retries → DLQ)
 *
 * Example:
 *   failOnAttempts: [1, 2] → Fails on attempts 1 & 2, succeeds on attempt 3
 *   failOnAttempts: [1]    → Fails on attempt 1, succeeds on retry
 *   failOnAttempts: undefined → Fails on ALL attempts if failureAfterMs > 0
 */
export async function simulateFailure(
  failureAfterMs: number | undefined,
  failOnAttempts: number[] | undefined,
  currentAttempt: number,
  stepName: string,
): Promise<void> {
  // Security check: Only allow simulated failures if explicitly enabled via environment variable
  const isSimulationEnabled =
    process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS === "true";

  if (!isSimulationEnabled) {
    return;
  }

  // Determine if we should fail on this attempt
  let shouldFail = false;
  let delayMs = 0;

  if (failOnAttempts && failOnAttempts.length > 0) {
    // Pattern 1 & 2: Specific attempts specified
    if (failOnAttempts.includes(currentAttempt)) {
      shouldFail = true;
      // Use provided delay or default to 0 (immediate failure)
      delayMs = failureAfterMs && failureAfterMs > 0 ? failureAfterMs : 0;
    } else {
      // Not in the failure list for this attempt
      console.log(
        `[${stepName}] ℹ️ Attempt ${currentAttempt}: Skipping simulated failure (not in failOnAttempts: [${failOnAttempts.join(", ")}])`,
      );
      return;
    }
  } else if (failureAfterMs && failureAfterMs > 0) {
    // Pattern 3: No specific attempts, but delay specified → fail all attempts
    shouldFail = true;
    delayMs = failureAfterMs;
  } else {
    // No failure configuration
    return;
  }

  // Execute the simulated failure
  if (shouldFail) {
    if (delayMs > 0) {
      console.log(
        `[${stepName}] ⚠️ Attempt ${currentAttempt}: Will simulate failure after ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else {
      console.log(
        `[${stepName}] ⚠️ Attempt ${currentAttempt}: Simulating immediate failure`,
      );
    }

    // Max retries is 3 (configured in SQS queue settings)
    const maxAttempts = 3;
    throw new Error(
      `SIMULATED FAILURE [Attempt ${currentAttempt}/${maxAttempts}]: ${stepName}`,
    );
  }
}

/**
 * Per-step test options (step-keyed format).
 * Each step name in testOptions maps to one of these option sets.
 */
export interface TestOptionSet {
  simDelay?: number;
  failureAfter?: number;
  failOnAttempts?: number[];
  failForItemIds?: string[];
  ackDelay?: number;
  skipAck?: boolean;
  crashBeforeAck?: boolean;
  ackPayload?: Record<string, unknown>;
}

/**
 * Get test options for the current step from the step-keyed testOptions map.
 *
 * Uses `message.stepValue` (e.g., "ValidateCustomer", "SubmitOrder")
 * to look up this step's options from `message.input.testOptions`.
 *
 * @param message - The work message containing stepValue and input
 * @returns TestOptionSet for this step, or undefined if none configured
 */
export function getMyTestOptions(message: {
  stepValue: string;
  input: Record<string, unknown>;
}): TestOptionSet | undefined {
  const testOptions = message.input?.testOptions as
    | Record<string, TestOptionSet>
    | undefined;
  if (!testOptions) return undefined;
  return testOptions[message.stepValue];
}

/**
 * @deprecated Use getMyTestOptions(message) instead. This returns the raw flat testOptions object.
 */
export function getSimulatedDelays(
  input: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return input.testOptions as Record<string, unknown> | undefined;
}
