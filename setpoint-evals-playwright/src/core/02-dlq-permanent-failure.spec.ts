/**
 * SE-02: DLQ Permanent Failure
 *
 * Tests SQS Dead Letter Queue routing when SubmitOrder exhausts all retry
 * attempts (failOnAttempts: [1,2,3,4,5,6,7] — always fails). After SQS
 * maxReceiveCount (3), the message is routed to DLQ and the step is marked FAILED.
 *
 * Mirrors: setpoint-evals/SE-02-dlq-permanent-failure/test.sh
 *
 * Architecture: Orchestrator does NOT re-delegate. SQS handles all retries.
 * Expected duration: ~120s (SQS visibility timeouts × 3 attempts)
 * Expected outcome: Job FAILS (SubmitOrder → DLQ)
 */

import { test, expect } from '../fixtures';
import { pollUntilTerminal } from '../helpers/polling';
import { dlqPermanentFailurePayload } from '../helpers/payloads';

test.describe('SE-02: DLQ Permanent Failure', () => {
  test.setTimeout(335_000);

  test('routes permanently failing step to DLQ', async ({ dtmApi, dtmDb, env }) => {
    // Step 1: Initiate job with permanent failure for SubmitOrder
    const payload = dlqPermanentFailurePayload();
    const { jobId } = await test.step('Initiate job with permanent failure config', async () => {
      return dtmApi.initiateJob(payload, 'order-processing');
    });

    expect(jobId).toMatch(/^[0-9a-f]{8}-/);

    // Step 2: Poll until terminal (expecting FAILED)
    const finalStatus = await test.step('Poll until terminal state', async () => {
      return pollUntilTerminal(
        (id) => dtmApi.getJobStatus(id),
        jobId,
        {
          maxSeconds: 300,
          intervalMs: 3000,
          additionalTimeoutMs: env.ADDITIONAL_TIMEOUT * 1000,
          terminalStatuses: ['completed', 'failed', 'partial_success'],
        },
      );
    });

    // Step 3: Verify job FAILED (not completed)
    await test.step('Verify job status is FAILED', () => {
      expect(finalStatus.status.toLowerCase()).toBe('failed');
    });

    // Step 4: Verify individual step statuses
    await test.step('Verify ValidateCustomer is COMPLETED', () => {
      const step = finalStatus.steps.find((s) => s.stepNumber === 'ValidateCustomer');
      expect(step, 'ValidateCustomer step should exist').toBeDefined();
      expect(step!.status.toLowerCase()).toBe('completed');
    });

    await test.step('Verify SubmitCustomer is COMPLETED', () => {
      const step = finalStatus.steps.find((s) => s.stepNumber === 'SubmitCustomer');
      expect(step, 'SubmitCustomer step should exist').toBeDefined();
      expect(step!.status.toLowerCase()).toBe('completed');
    });

    await test.step('Verify SubmitOrder is FAILED', () => {
      const step = finalStatus.steps.find((s) => s.stepNumber === 'SubmitOrder');
      expect(step, 'SubmitOrder step should exist').toBeDefined();
      expect(step!.status.toLowerCase()).toBe('failed');
    });

    await test.step('Verify DiscoverLineItems is SKIPPED or absent', () => {
      const step = finalStatus.steps.find((s) => s.stepNumber === 'DiscoverLineItems');
      if (step) {
        // If present, should be SKIPPED (cascade failure) or PENDING
        expect(['skipped', 'pending']).toContain(step.status.toLowerCase());
      }
      // If absent, quick-order variant doesn't include it — that's fine
    });

    // Step 5: Verify job-level statistics
    await test.step('Verify job-level statistics', async () => {
      const status = await dtmApi.getJobStatus(jobId);
      expect(status.result).not.toBeNull();
      // Expected: 3-4 steps completed (EC, EP, TC complete; TO fails)
      expect(status.result!.stepsCompleted).toBeGreaterThanOrEqual(3);
      expect(status.result!.stepsCompleted).toBeLessThanOrEqual(4);
    });
  });
});
