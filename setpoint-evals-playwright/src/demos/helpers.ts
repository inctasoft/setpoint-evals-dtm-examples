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
 * Caption overlay (Phase 5 — subtitled demo videos).
 *
 * A fixed-position band appended as a `document.body` child (a sibling of the
 * Preact root, so app re-renders never touch it) — anchored to the TOP of the
 * frame. Deliberate: video-player scrub/nav chrome overlays the BOTTOM, so a
 * bottom-anchored caption gets clipped or hidden while a viewer scrubs.
 * High-contrast (white on near-opaque black) for legibility over any part of
 * the dashboard, at both 1280x900 and a phone-width preview.
 *
 * Text is stakeholder language — the business promise a scenario keeps or
 * breaks ("the contract says a failed payment may not sink the order") —
 * never mechanics (no queue/topic/enum names). The UI itself shows the
 * status codes; the caption narrates what they mean to the business.
 */
const CAPTION_OVERLAY_ID = 'dtm-demo-caption-band';

async function ensureCaptionOverlay(page: Page): Promise<void> {
  await page.evaluate((id) => {
    if (document.getElementById(id)) return;
    const band = document.createElement('div');
    band.id = id;
    band.setAttribute('data-testid', 'demo-caption-band');
    band.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'min-height:38px',
      'padding:12px 28px',
      'background:rgba(6,8,12,0.92)',
      'border-bottom:3px solid #ffcc33',
      'color:#ffffff',
      'font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      'font-weight:600',
      'font-size:20px',
      'line-height:1.35',
      'text-align:center',
      'text-shadow:0 1px 3px rgba(0,0,0,0.9)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(band);
  }, CAPTION_OVERLAY_ID);
}

async function setCaptionText(page: Page, text: string): Promise<void> {
  await page.evaluate(
    ({ id, text }) => {
      const band = document.getElementById(id);
      if (band) band.textContent = text;
    },
    { id: CAPTION_OVERLAY_ID, text },
  );
}

/**
 * Show a caption cue on the top band, then hold so a viewer (and the
 * recording) can read it before the next UI action starts. Call once per
 * "beat" of the on-screen journey — each call is one caption cue.
 */
export async function caption(page: Page, text: string, holdMs = 2600): Promise<void> {
  await ensureCaptionOverlay(page);
  await setCaptionText(page, text);
  await page.waitForTimeout(holdMs);
}

/** Clear the caption band (e.g. right before a long unnarrated wait). */
export async function clearCaption(page: Page): Promise<void> {
  await setCaptionText(page, '');
}

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
