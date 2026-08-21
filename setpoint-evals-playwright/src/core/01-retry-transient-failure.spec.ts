/**
 * SE-01: Transient Failure Recovery
 *
 * Tests the retry mechanism: ValidateCustomer and SubmitOrder fail on attempts
 * 1 & 2, then succeed on attempt 3. SQS manages retries via 30s visibility timeout.
 *
 * Mirrors: setpoint-evals/SE-01-retry-transient-failure/test.sh
 *
 * Expected duration: ~134s (2 phases × 2 retries × 30s SQS visibility)
 * Expected outcome: Job COMPLETES after retries
 */

import { test, expect } from '../fixtures';
import { pollUntilTerminal } from '../helpers/polling';
import { retryTransientFailurePayload } from '../helpers/payloads';

test.describe('SE-01: Transient Failure Recovery', () => {
  test.setTimeout(185_000);

  test('recovers from transient failures via SQS retries', async ({ dtmApi, dtmDb, env }) => {
    // Step 1: Initiate job with transient failure config
    const payload = retryTransientFailurePayload();
    const { jobId } = await test.step('Initiate job with failOnAttempts config', async () => {
      return dtmApi.initiateJob(payload, 'order-processing');
    });

    expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Step 2: Poll until terminal state
    const finalStatus = await test.step('Poll until terminal state', async () => {
      return pollUntilTerminal(
        (id) => dtmApi.getJobStatus(id),
        jobId,
        {
          maxSeconds: 170,
          intervalMs: 2000,
          additionalTimeoutMs: env.ADDITIONAL_TIMEOUT * 1000,
        },
      );
    });

    // Step 3: Verify job completed
    await test.step('Verify job status is COMPLETED', () => {
      expect(finalStatus.status.toLowerCase()).toBe('completed');
    });

    // Step 4: Verify retry counts via database
    // NOTE: retry_count stores ATTEMPT NUMBER (1-based), not number of retries
    // failOnAttempts: [1, 2] → succeed on attempt 3 → retry_count = 3
    await test.step('Verify retry counts in database', async () => {
      const ecRetry = await dtmDb.getStepRetryCount(jobId, 'ValidateCustomer');
      expect(ecRetry, 'ValidateCustomer should have 3 attempts (failed 1,2 succeeded 3)').toBe(3);

      const tcRetry = await dtmDb.getStepRetryCount(jobId, 'SubmitCustomer');
      expect(tcRetry, 'SubmitCustomer should succeed on first attempt').toBe(1);

      const toRetry = await dtmDb.getStepRetryCount(jobId, 'SubmitOrder');
      expect(toRetry, 'SubmitOrder should have 3 attempts (failed 1,2 succeeded 3)').toBe(3);
    });

    // Step 5: Verify error fields cleared after successful retry
    await test.step('Verify error fields cleared after recovery', async () => {
      const ecCleared = await dtmDb.isStepErrorCleared(jobId, 'ValidateCustomer');
      expect(ecCleared, 'ValidateCustomer error should be NULL after success').toBe(true);

      const toCleared = await dtmDb.isStepErrorCleared(jobId, 'SubmitOrder');
      expect(toCleared, 'SubmitOrder error should be NULL after success').toBe(true);
    });

    // Step 6: Verify execution history entries
    await test.step('Verify execution history recorded', async () => {
      const ecHistory = await dtmDb.getExecutionHistoryLength(jobId, 'ValidateCustomer');
      expect(ecHistory, 'ValidateCustomer should have 3 execution history entries').toBe(3);

      const toHistory = await dtmDb.getExecutionHistoryLength(jobId, 'SubmitOrder');
      expect(toHistory, 'SubmitOrder should have 3 execution history entries').toBe(3);
    });

    // Step 7: Verify job-level statistics
    await test.step('Verify job-level statistics', async () => {
      const status = await dtmApi.getJobStatus(jobId);
      expect(status.result).not.toBeNull();
      expect(status.result!.totalRecords).toBe(2);
      expect(status.result!.stepsCompleted).toBe(4);
    });
  });
});
