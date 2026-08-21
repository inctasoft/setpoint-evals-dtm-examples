/**
 * SE-04: Acknowledgement Delays
 *
 * Tests WAITING_FOR_ACK status and variable ack delay durations.
 * SubmitCustomer has 2s ack delay, SubmitOrder has 3s ack delay.
 * Verifies that steps transition through WAITING_FOR_ACK and that the
 * orchestrator waits for all acknowledgements before completing the job.
 *
 * Mirrors: setpoint-evals/SE-04-ack-delays/test.sh
 *
 * Expected duration: ~8s
 * Expected outcome: Job COMPLETES after all acks received
 */

import { test, expect } from '../fixtures';
import { pollUntilTerminal } from '../helpers/polling';
import { ackDelaysPayload } from '../helpers/payloads';

test.describe('SE-04: Acknowledgement Delays', () => {
  test.setTimeout(95_000);

  test('handles WAITING_FOR_ACK status and variable ack delays', async ({ dtmApi, dtmDb, env }) => {
    // Step 1: Initiate job with ack delays
    const payload = ackDelaysPayload();
    const { jobId } = await test.step('Initiate job with ack delay config', async () => {
      return dtmApi.initiateJob(payload, 'order-processing');
    });

    // Step 2: Poll until terminal
    const finalStatus = await test.step('Poll until terminal state', async () => {
      return pollUntilTerminal(
        (id) => dtmApi.getJobStatus(id),
        jobId,
        {
          maxSeconds: 80,
          intervalMs: 3000,
          additionalTimeoutMs: env.ADDITIONAL_TIMEOUT * 1000,
        },
      );
    });

    // Step 3: Verify job completed
    await test.step('Verify job status is COMPLETED', () => {
      expect(finalStatus.status.toLowerCase()).toBe('completed');
    });

    // Step 4: Verify Transform steps went through Kafka publish (WAITING_FOR_ACK)
    await test.step('Verify Transform steps published to Kafka', async () => {
      const tcPublished = await dtmDb.wasKafkaPublished(jobId, 'SubmitCustomer');
      expect(tcPublished, 'SubmitCustomer should have kafka_published_at set').toBe(true);

      const toPublished = await dtmDb.wasKafkaPublished(jobId, 'SubmitOrder');
      expect(toPublished, 'SubmitOrder should have kafka_published_at set').toBe(true);
    });

    // Step 5: Verify acknowledgements were received
    await test.step('Verify acknowledgements received', async () => {
      const tcAck = await dtmDb.wasAckReceived(jobId, 'SubmitCustomer');
      expect(tcAck, 'SubmitCustomer should have ack_received_at set').toBe(true);

      const toAck = await dtmDb.wasAckReceived(jobId, 'SubmitOrder');
      expect(toAck, 'SubmitOrder should have ack_received_at set').toBe(true);
    });

    // Step 6: Verify ack delay durations (±2s tolerance)
    await test.step('Verify ack delay durations', async () => {
      const tcDelay = await dtmDb.getAckDelaySeconds(jobId, 'SubmitCustomer');
      expect(tcDelay, 'SubmitCustomer ack delay should be ~2s').toBeGreaterThanOrEqual(1.0);
      expect(tcDelay).toBeLessThanOrEqual(4.0);

      const toDelay = await dtmDb.getAckDelaySeconds(jobId, 'SubmitOrder');
      expect(toDelay, 'SubmitOrder ack delay should be ~3s').toBeGreaterThanOrEqual(2.0);
      expect(toDelay).toBeLessThanOrEqual(5.0);
    });

    // Step 7: Verify job waited for all acks (total duration >= 6s)
    await test.step('Verify job waited for all acks before completing', async () => {
      const duration = await dtmDb.getJobDurationSeconds(jobId);
      expect(duration, 'Job should take at least 6s (ack delays + processing)').toBeGreaterThanOrEqual(6.0);
    });

    // Step 8: Verify job-level statistics
    await test.step('Verify job-level statistics', async () => {
      const status = await dtmApi.getJobStatus(jobId);
      expect(status.result).not.toBeNull();
      expect(status.result!.totalRecords).toBe(2);
      expect(status.result!.stepsCompleted).toBe(4);
    });
  });
});
