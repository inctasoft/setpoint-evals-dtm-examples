/**
 * Shared helpers for demo video specs.
 *
 * Each demo follows the same pattern:
 *   1. Dashboard page is open and recording
 *   2. Trigger a workflow via the API
 *   3. Watch the job appear and progress in the UI
 *   4. Wait for terminal state
 *   5. Hold the final frame briefly for the recording
 */

import type { Page } from '@playwright/test';
import type { DtmApiClient } from '../fixtures/api-client.fixture';
import { pollUntilTerminal } from '../helpers/polling';

/**
 * Wait for a job card to appear in the dashboard's job list.
 * Looks for the job ID prefix in the UI.
 */
export async function waitForJobInUI(page: Page, jobId: string, timeoutMs = 20_000): Promise<void> {
  const prefix = jobId.slice(0, 12);
  await page.waitForSelector(`.job-item:has-text("${prefix}")`, { timeout: timeoutMs });
}

/**
 * Click on a job card in the job list to select it.
 */
export async function selectJobInUI(page: Page, jobId: string): Promise<void> {
  const prefix = jobId.slice(0, 12);
  await page.click(`.job-item:has-text("${prefix}")`);
}

/**
 * Run a full demo recording cycle:
 *   - Trigger the job
 *   - Watch it appear in the dashboard
 *   - Poll until terminal
 *   - Hold the final frame
 */
export async function runDemoRecording(opts: {
  page: Page;
  dtmApi: DtmApiClient;
  workflow: string;
  payload: Record<string, unknown>;
  maxPollSeconds?: number;
  holdFinalFrameMs?: number;
}): Promise<{ jobId: string; finalStatus: string }> {
  const {
    page,
    dtmApi,
    workflow,
    payload,
    maxPollSeconds = 120,
    holdFinalFrameMs = 3000,
  } = opts;

  // 1. Trigger the workflow
  const { jobId } = await dtmApi.initiateJob(payload, workflow);

  // 2. Wait for it to show up in the dashboard
  await waitForJobInUI(page, jobId);
  await selectJobInUI(page, jobId);

  // 3. Poll until terminal — the dashboard updates live via WebSocket
  const result = await pollUntilTerminal(
    (id) => dtmApi.getJobStatus(id),
    jobId,
    {
      maxSeconds: maxPollSeconds,
      intervalMs: 2000,
    },
  );

  // 4. Hold the final frame so the video shows the end state clearly
  await page.waitForTimeout(holdFinalFrameMs);

  return { jobId, finalStatus: result.status.toLowerCase() };
}
