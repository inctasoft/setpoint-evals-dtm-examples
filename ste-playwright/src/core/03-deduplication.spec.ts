/**
 * STE-03: Deduplication
 *
 * Tests per-request deduplication (enableDeduplication: true):
 * 1. First request → 201 Created
 * 2. Identical request → 409 Conflict
 * 3. Different deduplicationKey → 201 Created
 * 4. Wait for both jobs to complete
 * 5. Retry first request after completion → 409 (dedup persists)
 *
 * Mirrors: ste/03-deduplication/test.sh
 *
 * Expected duration: ~30s
 * Expected outcome: Deduplication correctly rejects duplicate requests
 */

import { test, expect } from '../fixtures';
import { pollUntilTerminal } from '../helpers/polling';
import { deduplicationPayload, deduplicationDifferentPayload } from '../helpers/payloads';

test.describe('STE-03: Deduplication', () => {
  test.setTimeout(95_000);

  test('rejects duplicate requests with 409 Conflict', async ({ dtmApi, dtmDb, env }) => {
    const dedupKey1 = crypto.randomUUID();
    const dedupKey2 = crypto.randomUUID();

    // Pre-test cleanup: remove any existing jobs for these deduplication keys
    await test.step('Pre-test cleanup', async () => {
      await dtmDb.deleteJobsByDeduplicationKey(dedupKey1);
      await dtmDb.deleteJobsByDeduplicationKey(dedupKey2);
    });

    // Test 1: First request should succeed (201)
    const { jobId: jobId1 } = await test.step('First request accepted (201)', async () => {
      const payload = deduplicationPayload(dedupKey1);
      const result = await dtmApi.initiateJob(payload, 'order-processing');
      return result;
    });

    expect(jobId1).toBeTruthy();

    // Small pause to let the job register
    await new Promise((r) => setTimeout(r, 1000));

    // Test 2: Duplicate request should be rejected (409)
    await test.step('Duplicate request rejected (409)', async () => {
      const payload = deduplicationPayload(dedupKey1);
      const { status } = await dtmApi.initiateJobRaw(payload, 'order-processing');
      expect(status, 'Duplicate request should return 409 Conflict').toBe(409);
    });

    // Test 3: Different deduplicationKey should succeed (201)
    const { jobId: jobId2 } = await test.step('Different request accepted (201)', async () => {
      const payload = deduplicationDifferentPayload(dedupKey2);
      return dtmApi.initiateJob(payload, 'order-processing');
    });

    expect(jobId2).toBeTruthy();

    // Test 4: Wait for both jobs to complete
    await test.step('Wait for Job 1 to complete', async () => {
      const result = await pollUntilTerminal(
        (id) => dtmApi.getJobStatus(id),
        jobId1,
        { maxSeconds: 60, intervalMs: 3000, additionalTimeoutMs: env.ADDITIONAL_TIMEOUT * 1000 },
      );
      expect(result.status.toLowerCase()).toBe('completed');
    });

    await test.step('Wait for Job 2 to complete', async () => {
      const result = await pollUntilTerminal(
        (id) => dtmApi.getJobStatus(id),
        jobId2,
        { maxSeconds: 40, intervalMs: 3000, additionalTimeoutMs: env.ADDITIONAL_TIMEOUT * 1000 },
      );
      expect(result.status.toLowerCase()).toBe('completed');
    });

    // Verify job statistics for both
    await test.step('Verify Job 1 statistics', async () => {
      const status = await dtmApi.getJobStatus(jobId1);
      expect(status.result).not.toBeNull();
      expect(status.result!.totalRecords).toBe(2);
      expect(status.result!.stepsCompleted).toBe(4);
    });

    await test.step('Verify Job 2 statistics', async () => {
      const status = await dtmApi.getJobStatus(jobId2);
      expect(status.result).not.toBeNull();
      expect(status.result!.totalRecords).toBe(2);
      expect(status.result!.stepsCompleted).toBe(4);
    });

    // Test 5: Retry after completion should still be rejected (409)
    await test.step('Retry after completion still rejected (409)', async () => {
      const payload = deduplicationPayload(dedupKey1);
      const { status } = await dtmApi.initiateJobRaw(payload, 'order-processing');
      expect(status, 'Deduplication should persist even after job completes').toBe(409);
    });
  });
});
