/**
 * Demo: Order Processing Workflow
 *
 * Records a video of the DTM dashboard showing the order-processing
 * workflow executing end-to-end with retry behavior.
 *
 * Uses quick-order variant (4 steps) with transient failures
 * to demonstrate retry recovery in real-time.
 */

import { test, expect } from '../fixtures/dashboard.fixture';
import { runDemoRecording } from './helpers';
import { retryTransientFailurePayload } from '../helpers/payloads';

test.describe('Demo: Order Processing', () => {
  test.setTimeout(200_000);

  test('records order-processing workflow with retries', async ({ dashboardPage, dtmApi }) => {
    const { finalStatus } = await runDemoRecording({
      page: dashboardPage,
      dtmApi,
      workflow: 'order-processing',
      payload: retryTransientFailurePayload(),
      maxPollSeconds: 180,
    });

    expect(finalStatus).toBe('completed');
  });
});
