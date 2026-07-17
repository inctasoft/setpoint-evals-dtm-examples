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
 * Beat-synced captions (ux-storyboards.md §4 item 2 / DX NOTE item 3 — the F4 fix).
 *
 * v1's captions held for a fixed `holdMs` regardless of what the UI was actually
 * doing underneath — the fatal case was a caption frozen for 40-56s over a progress
 * bar with nothing narrating the retry/cascade drama that WAS the product. This
 * replaces the fixed hold with: show the caption, wait a minimum dwell so a viewer
 * can start reading it, then race a real UI-state condition (`waitFor`) against a
 * hard ceiling (`maxMs`) so a selector that never appears (flaky run, changed
 * timing) can never hang the recording — it just proceeds at the ceiling.
 *
 * Every call is logged to the beat recorder (if provided) so the same call site
 * that drives the caption ALSO produces the beat->timestamp manifest the
 * speed-ramp step and the PR body both consume — one source of truth, not a
 * caption script that drifts from a separately-hand-timed ffmpeg map.
 */
export async function captionBeat(
  page: Page,
  text: string,
  opts: {
    /** Beat label for the manifest (see BeatLog). Omit for pure narration cues with no distinct UI beat. */
    label?: string;
    mark?: (label: string) => void;
    /** Awaited AFTER the minimum dwell — typically page.waitForSelector(...).then(() => {}) or similar. */
    waitFor?: () => Promise<unknown>;
    /** Minimum time the caption is guaranteed to be on screen before racing waitFor. */
    minMs?: number;
    /** Hard ceiling — if waitFor hasn't resolved by here, proceed anyway (never hang a take). */
    maxMs?: number;
  } = {},
): Promise<void> {
  const { label, mark, waitFor, minMs = 1400, maxMs = 15_000 } = opts;
  await ensureCaptionOverlay(page);
  await setCaptionText(page, text);
  if (label && mark) mark(label);
  await page.waitForTimeout(minMs);
  if (waitFor) {
    // Race the real UI condition against the remaining ceiling — whichever comes first.
    // waitFor() is caught HERE, unconditionally — a call site's own `page.waitForSelector(...)`
    // (no wrapping .catch()) throws on ITS internal timeout, and an uncaught rejection inside
    // Promise.race propagates and fails the whole test. Catching centrally means every call
    // site gets "proceed at the ceiling" behavior for free — a call site CAN still add its own
    // .catch() for a custom fallback, but forgetting to is never fatal (found live: the iot
    // spec's first full-screen beat hit exactly this on a fast-completing job, dtm-video-v2
    // Lane C 2026-07-17).
    await Promise.race([
      waitFor().catch(() => {}),
      page.waitForTimeout(Math.max(0, maxMs - minMs)),
    ]);
  } else {
    // No UI condition to race — this is a pure narration beat (e.g. the opening line
    // before anything is on screen yet). Just hold long enough to read, capped by maxMs.
    const readingHoldMs = Math.min(Math.max(0, maxMs - minMs), 2600);
    await page.waitForTimeout(readingHoldMs);
  }
}

/**
 * Beat->timestamp manifest (ux-storyboards.md §4 item 5 — "ramp spans keyed to the
 * same beat selectors, not hardcoded seconds"). `mark(label)` is cheap and
 * synchronous; call it at every beat a downstream consumer (ffmpeg speed-ramp,
 * frame-verification, the PR body) needs a timestamp for. The demo-recording
 * fixture owns writing this to `<slug>.beats.json` at teardown, timed from the
 * SAME `recordingStart` the video itself starts from (both fixtures share the
 * `recordingStart` fixture — see demo-recording.fixture.ts).
 */
export interface BeatMark {
  label: string;
  t: number;
}

/**
 * Fake on-screen cursor + click ripple (ux-storyboards.md §4 item 4 — the F2 fix:
 * "the Run beat is a blink, not a performance"). Glides an injected cursor dot to
 * the target element's center, holds a hover glow so a viewer can see WHAT is about
 * to be clicked, then clicks and shows a brief ripple. One helper call replaces the
 * v1 pattern of `page.locator(sel).click()` with zero visual evidence anything
 * happened.
 */
const CURSOR_ID = 'dtm-demo-cursor';
const CURSOR_STYLE_ID = 'dtm-demo-cursor-style';

async function ensureCursorChrome(page: Page): Promise<void> {
  await page.evaluate(
    ({ cursorId, styleId }) => {
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          #${cursorId} {
            position: fixed;
            width: 18px;
            height: 18px;
            margin-left: -9px;
            margin-top: -9px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(255,204,51,0.95) 0%, rgba(255,204,51,0.55) 60%, rgba(255,204,51,0) 100%);
            border: 2px solid #ffcc33;
            box-shadow: 0 0 12px 2px rgba(255,204,51,0.85);
            pointer-events: none;
            z-index: 2147483646;
            transition: left 0.55s cubic-bezier(0.22,1,0.36,1), top 0.55s cubic-bezier(0.22,1,0.36,1);
            opacity: 0;
          }
          #${cursorId}.visible { opacity: 1; }
          #${cursorId}.hovering {
            box-shadow: 0 0 0 8px rgba(255,204,51,0.28), 0 0 16px 4px rgba(255,204,51,0.9);
            animation: dtm-demo-hover-pulse 1.1s ease-in-out infinite;
          }
          @keyframes dtm-demo-hover-pulse {
            0%, 100% { box-shadow: 0 0 0 6px rgba(255,204,51,0.22), 0 0 14px 4px rgba(255,204,51,0.85); }
            50% { box-shadow: 0 0 0 12px rgba(255,204,51,0.14), 0 0 20px 6px rgba(255,204,51,0.95); }
          }
          .dtm-demo-ripple {
            position: fixed;
            width: 10px;
            height: 10px;
            margin-left: -5px;
            margin-top: -5px;
            border-radius: 50%;
            border: 2px solid #ffcc33;
            pointer-events: none;
            z-index: 2147483646;
            animation: dtm-demo-ripple-anim 0.55s ease-out forwards;
          }
          @keyframes dtm-demo-ripple-anim {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(6); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }
      if (!document.getElementById(cursorId)) {
        const dot = document.createElement('div');
        dot.id = cursorId;
        document.body.appendChild(dot);
      }
    },
    { cursorId: CURSOR_ID, styleId: CURSOR_STYLE_ID },
  );
}

/**
 * Glide the fake cursor to (x,y), hover-glow, click the real element via
 * page.mouse (so the app receives a genuine click, not a synthetic DOM dispatch),
 * then ripple. `selector` is resolved fresh each call — pass a Locator-compatible
 * CSS/text selector, not a pre-resolved handle, so this works equally for a plain
 * button and an SVG `g.node[data-step=...]`.
 */
export async function spotlightClick(
  page: Page,
  selector: string,
  opts: { hoverMs?: number; postClickMs?: number } = {},
): Promise<void> {
  const { hoverMs = 1500, postClickMs = 400 } = opts;
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`spotlightClick: no bounding box for selector "${selector}" — is it visible?`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await ensureCursorChrome(page);
  await page.evaluate(
    ({ cursorId, x, y }) => {
      const dot = document.getElementById(cursorId);
      if (!dot) return;
      dot.classList.add('visible');
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
    },
    { cursorId: CURSOR_ID, x: cx, y: cy },
  );
  // Real pointer moves so :hover states on the underlying app also engage.
  await page.mouse.move(cx, cy, { steps: 24 });
  await page.evaluate((cursorId) => document.getElementById(cursorId)?.classList.add('hovering'), CURSOR_ID);
  await page.waitForTimeout(hoverMs);

  await page.evaluate(
    ({ x, y }) => {
      const ripple = document.createElement('div');
      ripple.className = 'dtm-demo-ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    { x: cx, y: cy },
  );
  await target.click();
  await page.evaluate((cursorId) => document.getElementById(cursorId)?.classList.remove('hovering'), CURSOR_ID);
  await page.waitForTimeout(postClickMs);
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
