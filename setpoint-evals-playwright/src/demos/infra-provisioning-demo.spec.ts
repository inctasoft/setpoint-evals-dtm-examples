/**
 * Demo: Infrastructure Provisioning — "blast radius as a picture"
 *
 * v2 (dtm-video-v2 Lane C) — follows ux-storyboards.md §2.3 shot-by-shot: read the
 * contract (gherkin + mermaid, IN VIEWPORT), a spotlighted Run click, deep-link,
 * full-screen DAG ON CAMERA, a node drill-down on ApplyCompute's fan-out, the
 * cascade flipping amber live, a console beat, and a close on the Assertions
 * checklist.
 *
 * Scenario: workflows/infra-provisioning/setpoint-evals/SE-08-skipped-propagation-breadth
 * — the compute stage of the prod-eu chain fails permanently for every fanned-out
 * instance; three sibling cascades that depend directly on compute (storage, dns,
 * load balancer) are skipped, and dns's own dependent (certificate) is skipped two
 * hops deep — breadth AND depth of the blast radius in one run, while network and
 * environment (no compute dependency) stay untouched. Compute is a required
 * cascade, so the job lands FAILED.
 *
 * GROUND TRUTH verified live against :3002 before scripting this (dtm-video-v2
 * Lane C recon, 2026-07-17 — see PR body for the full trace, incl. a full-screen
 * DAG screenshot of exactly this cascade): ApplyCompute fans out to 6 instances,
 * each retried 3 times (retryCount=3 on every terminal FAILED row — 18 real
 * attempts total) before the job gives up. Storage/DNS/LoadBalancer/Certificate
 * all render `dagSkipped` (dashed amber); Network/Environment stay `dagDone`
 * (green, untouched) — this is the storyboard's claim EXACTLY, no recast needed.
 *
 * One nuance ApplyCompute's drill-down does NOT show on its own: because it's a
 * fanned-out (aggregate) step, its `/activity` response omits the per-instance
 * attempt-by-attempt timeline (that detail exists only for PRIMARY steps — see
 * order-processing-demo.spec.ts's ValidatePayment, which IS primary). What IS
 * visibly proven on screen: the drill-down header's own `attempt 3` chip (drawn
 * from the job's top-level step snapshot) and, per-instance, the flat Job Detail
 * step list's `↳ SIMULATED FAILURE [Attempt 3/3]: Apply Compute` line under each
 * of the 6 failed ApplyCompute rows (confirmed live via a real run, f4d911fe...).
 * The caption below is grounded in those two real surfaces, not an invented one.
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { captionBeat, spotlightClick } from './helpers';

test.use({ demoSlug: 'infra-cascade-failure' });

test.describe('Demo: Infra Provisioning', () => {
  test.setTimeout(240_000);

  test('STORY: infra-provisioning cascade failure skips storage/dns/cert/LB, network+environment untouched (Scenarios -> Run -> full-screen DAG -> drill-down -> Assertions)', async ({
    dashboardPage: page,
    beat,
  }) => {
    // ACT I — read the contract ---------------------------------------------------
    await captionBeat(
      page,
      'An environment is a chain: network, compute, and everything that sits on top.',
      { label: 'open', mark: beat, minMs: 1800, maxMs: 3600 },
    );

    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'Infra' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-08-skipped-propagation-breadth' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    await captionBeat(
      page,
      'Today compute is rigged to fail — on purpose. We want to see the blast radius, not guess it.',
      { label: 'scenarios', mark: beat, minMs: 1800, maxMs: 3400 },
    );

    // F1 fix: scroll the diagram into view and assert real viewport intersection.
    const mermaidSvg = page.locator('.readme-body svg').first();
    await mermaidSvg.scrollIntoViewIfNeeded();
    await expect(mermaidSvg).toBeInViewport({ ratio: 0.15, timeout: 10_000 });

    await captionBeat(
      page,
      'The contract predicts the damage: three direct casualties, one two hops away — and two survivors.',
      { label: 'mermaid-visible', mark: beat, minMs: 4200, maxMs: 6000 },
    );

    // ACT II — run it --------------------------------------------------------------
    await captionBeat(page, 'Break it. Deliberately. On the record.', { mark: beat, minMs: 1200, maxMs: 2000 });
    await spotlightClick(page, '.run-button');
    beat('run-click');

    const runResultLink = page.locator('.run-result a');
    await expect(runResultLink).toBeVisible({ timeout: 15_000 });
    const jobId = (await runResultLink.innerText()).trim();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    beat('job-created');

    await captionBeat(page, 'Provisioning starts healthy — environment green, network green.', {
      mark: beat,
      minMs: 1200,
      maxMs: 2200,
    });
    await runResultLink.click();

    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(page.locator('.job-detail-header')).toContainText(jobId, { timeout: 5_000 });
    await page.locator('.workflow-pill', { hasText: 'infra-provisioning' }).click();
    beat('workflow-filtered');

    // ACT III — watch the graph ----------------------------------------------------
    await spotlightClick(page, '.dag-expand-btn');
    await expect(page.locator('.dag-fullscreen')).toBeVisible({ timeout: 5_000 });
    beat('fullscreen-open');

    await captionBeat(page, 'Now compute starts failing. The engine retries before it condemns.', {
      mark: beat,
      minMs: 1600,
      waitFor: () =>
        page.waitForSelector('.dag-fullscreen g.node[data-step="ApplyCompute"].dagActive', { timeout: 25_000 }),
      maxMs: 26_000,
    });

    // Node drill-down — ApplyCompute is a fanned-out (aggregate) step: see file
    // header for exactly what does/doesn't render here.
    await spotlightClick(page, '.dag-fullscreen-canvas g.node[data-step="ApplyCompute"]');
    await expect(page.locator('.step-drilldown')).toBeVisible({ timeout: 5_000 });
    beat('drilldown-open');

    await expect(page.locator('.step-drilldown .drilldown-section-label', { hasText: /Fan-out/ })).toBeVisible({
      timeout: 30_000,
    });
    await captionBeat(page, 'Six instances, each tried three times before the verdict. Patience, then honesty.', {
      mark: beat,
      minMs: 2600,
      // The real SQS-visibility-timeout cadence (~30s between attempts, 6
      // instances in parallel) is this video's dead-air span — beat-synced so the
      // caption narrates through it instead of freezing; generate-demo-media.sh
      // speed-ramps drilldown-open -> terminal-landed with an on-frame ×N tag.
      waitFor: () =>
        page
          .locator('.step-drilldown .drilldown-attempt-chip', { hasText: /attempt 3/ })
          .waitFor({ timeout: 45_000 })
          .catch(() => {}),
      maxMs: 46_000,
    });

    await page.locator('.drilldown-scope-events-btn').click();
    beat('console-scoped');
    await captionBeat(page, 'Every skip has a reason attached — no downstream team left guessing.', {
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

    // Close the drill-down and watch the verdict travel the map — the cascade beat.
    await page.locator('.drilldown-close').click();
    await captionBeat(page, 'Verdict in. Watch the failure travel the map.', {
      mark: beat,
      minMs: 1600,
      waitFor: () =>
        Promise.all([
          page.waitForSelector('.dag-fullscreen g.node[data-step="ApplyCompute"].dagFailed', { timeout: 60_000 }),
          page.waitForSelector('.dag-fullscreen g.node[data-step="ApplyStorage"].dagSkipped', { timeout: 60_000 }),
          page.waitForSelector('.dag-fullscreen g.node[data-step="ApplyDNS"].dagSkipped', { timeout: 60_000 }),
          page.waitForSelector('.dag-fullscreen g.node[data-step="ApplyLoadBalancer"].dagSkipped', { timeout: 60_000 }),
        ]),
      maxMs: 60_000,
    });
    beat('cascade-landed');

    await captionBeat(
      page,
      'The certificate never touched compute — but it needed DNS. Two hops away, still caught.',
      {
        mark: beat,
        minMs: 2000,
        waitFor: () =>
          page
            .waitForSelector('.dag-fullscreen g.node[data-step="ApplyCertificate"].dagSkipped', { timeout: 15_000 })
            .catch(() => {}),
        maxMs: 16_000,
      },
    );

    await captionBeat(page, 'And network and environment stand untouched. Damage contained, not smeared.', {
      mark: beat,
      minMs: 2600,
      maxMs: 3800,
    });
    beat('terminal-landed');

    await page.keyboard.press('Escape');
    await expect(page.locator('.dag-fullscreen')).toHaveCount(0, { timeout: 5_000 });
    beat('fullscreen-exit');

    await expect(page.locator('.job-detail-header .status')).toHaveText(/FAILED|PARTIAL_SUCCESS|COMPLETED/i, {
      timeout: 10_000,
    });
    await captionBeat(page, 'FAILED — with a map of exactly what that means.', {
      mark: beat,
      minMs: 2000,
      maxMs: 3200,
    });

    // ACT IV — the promise, checked -------------------------------------------------
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-08-skipped-propagation-breadth' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();
    await expect(assertionsHeading).toBeInViewport({ ratio: 0.3, timeout: 5_000 });
    beat('assertions');

    await captionBeat(
      page,
      'What should break, broke. What shouldn’t, didn’t. Checked.',
      { mark: beat, minMs: 2600, maxMs: 3800 },
    );
  });
});
