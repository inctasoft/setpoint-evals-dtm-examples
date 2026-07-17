/**
 * Demo: IoT Sensor Pipeline — "one job becomes a tree of work"
 *
 * v2 (dtm-video-v2 Lane C) — follows ux-storyboards.md §2.2 shot-by-shot, WITH ONE
 * DELIBERATE DEVIATION from the storyboard's literal node choice (see below).
 *
 * Scenario: workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out —
 * the README's own "Demo pick": greenhouse-3's 3 sensors each independently
 * trigger their own reading fan-out (2 nested levels from a single job — device
 * to sensors, sensor to readings: 3 DiscoverReadings, 18 IngestReading, 18
 * PublishReading). The job lands COMPLETED.
 *
 * GROUND TRUTH verified live against :3002 before scripting this (dtm-video-v2
 * Lane C recon, 2026-07-17 — see PR body for the full trace):
 *
 *   1. #36 (Lane B.1's dedupe fix) IS live on the running stack — confirmed via a
 *      fresh job: DiscoverReadings=3 (not 6), IngestReading=18 (not 36). Good —
 *      the numbers this spec relies on are the FIXED ones.
 *
 *   2. DEVIATION from storyboard: the storyboard's 0:45 beat says "click
 *      DiscoverReadings node -> eighteen children". Verified live this is WRONG —
 *      DiscoverReadings is itself a 3-instance fan-out (one per sensor); its own
 *      drill-down shows "Fan-out (3)", not 18. The real 18-instance surface is
 *      IngestReading (or PublishReading) — GET .../steps/IngestReading/activity
 *      returns instanceCount:18 live. This spec drills into IngestReading instead.
 *
 *   3. The DAG's own fan-out badge ("n/m" corner label on a discovery node) has a
 *      KNOWN, UNFIXED bug (documented in PR #36's body as a follow-up, not fixed
 *      in this lane's scope): it sums ALL descendant chain rows against the
 *      node's own childCount, e.g. DiscoverSensors' badge reads something like
 *      "24/3" instead of "3/3". This spec's captions never quote a badge ratio —
 *      the honest, verified-correct surfaces are the drill-down's own fan-out
 *      count (`Fan-out (N)` + child list, computed directly from `/activity`,
 *      independent of the badge) and the job's own total step count.
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { captionBeat, spotlightClick } from './helpers';

test.use({ demoSlug: 'iot-double-fan-out' });

test.describe('Demo: IoT Sensor Pipeline', () => {
  test.setTimeout(240_000);

  test('STORY: iot-sensor-pipeline double fan-out explodes into an N-by-M step tree (Scenarios -> Run -> full-screen DAG -> drill-down -> Assertions)', async ({
    dashboardPage: page,
    beat,
  }) => {
    // ACT I — read the contract ---------------------------------------------------
    await captionBeat(
      page,
      'Greenhouse 3 has three sensors. Nobody knows in advance how much work one health check becomes.',
      { label: 'open', mark: beat, minMs: 1800, maxMs: 3600 },
    );

    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'IoT' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-03-double-fan-out' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    await captionBeat(page, "The contract doesn't list the work — it describes how work is discovered.", {
      label: 'scenarios',
      mark: beat,
      minMs: 1600,
      maxMs: 3200,
    });

    // F1 fix: scroll the fan-out tree into view and assert real viewport intersection.
    const mermaidSvg = page.locator('.readme-body svg').first();
    await mermaidSvg.scrollIntoViewIfNeeded();
    await expect(mermaidSvg).toBeInViewport({ ratio: 0.15, timeout: 10_000 });

    await captionBeat(page, 'One box becomes three, becomes eighteen — the tree is the promise.', {
      label: 'mermaid-visible',
      mark: beat,
      minMs: 4200,
      maxMs: 6000,
    });

    // ACT II — run it --------------------------------------------------------------
    await captionBeat(page, 'Run it. No batch file, no pre-wiring.', { mark: beat, minMs: 1000, maxMs: 1800 });
    await spotlightClick(page, '.run-button');
    beat('run-click');

    const runResultLink = page.locator('.run-result a');
    await expect(runResultLink).toBeVisible({ timeout: 15_000 });
    const jobId = (await runResultLink.innerText()).trim();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    beat('job-created');

    await captionBeat(page, 'The engine starts with six steps. Watch what it finds.', {
      mark: beat,
      minMs: 1200,
      maxMs: 2200,
    });
    await runResultLink.click();

    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(page.locator('.job-detail-header')).toContainText(jobId, { timeout: 5_000 });
    await page.locator('.workflow-pill', { hasText: 'iot-sensor-pipeline' }).click();
    beat('workflow-filtered');

    // ACT III — watch the graph ----------------------------------------------------
    await spotlightClick(page, '.dag-expand-btn');
    await expect(page.locator('.dag-fullscreen')).toBeVisible({ timeout: 5_000 });
    beat('fullscreen-open');

    // This job is genuinely FAST (~16-20s total, verified live — the double
    // fan-out is real work but not slow work) — unlike order/infra, there is no
    // real dead-air span here to beat-sync through. A single node's DAG color
    // is also not a reliable transition signal for a fan-out TYPE (workflow-dag.tsx
    // renders one visual node per step NAME across potentially many instance rows;
    // `applyLiveState()` keys a `Map` by step name, so with several same-named
    // fan-out rows the displayed color reflects whichever happens to be LAST in
    // the array — not "still pending" in any stable sense). So these two beats use
    // short fixed holds rather than gating on a per-node CSS class transition —
    // gating on it was observed live to eat the full waitFor ceiling for no visual
    // payoff (dtm-video-v2 Lane C, 2026-07-17: cost ~48s of dead ceiling-waiting
    // across two beats on a job that had already finished fanning out).
    await captionBeat(page, 'Discovery in progress — the map grows as the engine learns the fleet.', {
      mark: beat,
      minMs: 2200,
      maxMs: 3200,
    });

    await captionBeat(page, 'Every branch is tracked on its own — from discovery to the last reading.', {
      mark: beat,
      minMs: 2200,
      maxMs: 3200,
    });

    // Node drill-down — IngestReading (NOT DiscoverReadings, see file header
    // deviation note): its /activity aggregate is the honest 18-instance surface.
    await spotlightClick(page, '.dag-fullscreen-canvas g.node[data-step="IngestReading"]');
    await expect(page.locator('.step-drilldown')).toBeVisible({ timeout: 5_000 });
    beat('drilldown-open');

    await expect(page.locator('.step-drilldown .drilldown-section-label', { hasText: /Fan-out/ })).toBeVisible({
      timeout: 10_000,
    });
    await captionBeat(page, 'Eighteen individual readings, each with its own status and duration — on its own row.', {
      mark: beat,
      minMs: 2600,
      maxMs: 4000,
    });

    // Scroll through the real child list on camera.
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(600);

    await page.locator('.drilldown-scope-events-btn').click();
    beat('console-scoped');
    await captionBeat(page, 'Every step change is on the record — nothing hidden in a log file.', {
      mark: beat,
      minMs: 1800,
      waitFor: () =>
        page
          .locator('.dag-fullscreen-dock .log-entry')
          .first()
          .waitFor({ timeout: 15_000 })
          .catch(() => {}),
      maxMs: 16_000,
    });

    // ACT III close — terminal state lands.
    await captionBeat(page, 'Every branch finished. The tree closed itself.', {
      mark: beat,
      minMs: 1600,
      waitFor: () => page.waitForSelector('.job-detail-header .status.completed', { timeout: 90_000 }).catch(() => {}),
      maxMs: 90_000,
    });
    beat('terminal-landed');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dag-fullscreen')).toHaveCount(0, { timeout: 5_000 });
    beat('fullscreen-exit');

    await expect(page.locator('.job-detail-header .status')).toHaveText(/COMPLETED|PARTIAL_SUCCESS|FAILED/i, {
      timeout: 10_000,
    });
    await captionBeat(page, "COMPLETED — the fleet's widest device, fully accounted for.", {
      mark: beat,
      minMs: 2000,
      maxMs: 3200,
    });

    // ACT IV — the promise, checked -------------------------------------------------
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-03-double-fan-out' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();
    await expect(assertionsHeading).toBeInViewport({ ratio: 0.3, timeout: 5_000 });
    beat('assertions');

    await captionBeat(page, 'Every sensor, every reading — checked.', { mark: beat, minMs: 2400, maxMs: 3600 });
  });
});
