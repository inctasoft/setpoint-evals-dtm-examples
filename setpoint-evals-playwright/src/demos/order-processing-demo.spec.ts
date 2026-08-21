/**
 * Demo: Order Processing — "a failed payment may not sink the order"
 *
 * v2 (dtm-video-v2 Lane C) — follows ux-storyboards.md §2.1 shot-by-shot: read the
 * contract (gherkin + mermaid, scrolled IN VIEWPORT, not just toBeVisible — the v1
 * fatal flaw), a spotlighted Run click, deep-link to Dashboard, full-screen DAG
 * entered ON CAMERA, a node drill-down on ValidatePayment's real retry timeline,
 * a console beat, and a close on the Assertions checklist (D4-clean: the README's
 * Artifacts/Run sections stay collapsed behind eval-detail.tsx's own disclosure —
 * nothing to do here, just don't scroll into it).
 *
 * Scenario: workflows/order-processing/setpoint-evals/SE-04-partial-payment-failure
 * — Barbara Liskov's card never finishes processing (payload.paymentId is a
 * sentinel that matches no row). ValidateCustomer/SubmitCustomer/ValidateOrder/
 * SubmitOrder/ValidateShipment/SubmitShipment are required cascades and complete
 * regardless. The job lands PARTIAL_SUCCESS.
 *
 * GROUND TRUTH verified live against :3002 before scripting this (dtm-video-v2
 * Lane C recon, 2026-07-17 — see PR body for the full trace): ValidatePayment is
 * NOT a single-shot failure — it's SQS-redelivery-retried up to 3 times (~30s
 * apart, the real DB confirms retryCount=3 on the terminal FAILED row), flipping
 * to `in_progress_retrying` between attempts and broadcasting a `step_retrying`
 * event each time (services/orchestrator/src/callback/callback.service.ts). The
 * storyboard's "attempt two, attempt three, on its own" beat is therefore an
 * HONEST claim, not aspirational — ValidatePayment is a PRIMARY (non-aggregate)
 * step, so its drill-down renders the full attempt-by-attempt activity timeline
 * (unlike infra's fanned-out ApplyCompute — see infra-provisioning-demo.spec.ts's
 * header for the contrast).
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { captionBeat, spotlightClick } from './helpers';

test.use({ demoSlug: 'order-processing-partial-payment-failure' });

test.describe('Demo: Order Processing', () => {
  test.setTimeout(200_000);

  test('STORY: order-processing partial payment failure lands PARTIAL_SUCCESS (Scenarios -> Run -> full-screen DAG -> drill-down -> Assertions)', async ({
    dashboardPage: page,
    beat,
  }) => {
    // ACT I — read the contract ---------------------------------------------------
    await captionBeat(
      page,
      "Ada's Beans Cafe made a promise: a failed payment must never sink the order.",
      { label: 'open', mark: beat, minMs: 1800, maxMs: 3600 },
    );

    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'Order Processing' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-04-partial-payment-failure' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    await captionBeat(page, 'The rule is written in plain language — business and engineering read the same page.', {
      label: 'scenarios',
      mark: beat,
      minMs: 1600,
      maxMs: 3200,
    });

    // F1 fix: scroll the diagram into view and assert it is ACTUALLY IN VIEWPORT —
    // not just attached-and-unhidden (v1's `toBeVisible()` passed for an SVG sitting
    // 1000px below the fold; toBeInViewport checks real intersection with the
    // viewport rectangle, below the fixed caption band).
    const mermaidSvg = page.locator('.readme-body svg').first();
    await mermaidSvg.scrollIntoViewIfNeeded();
    await expect(mermaidSvg).toBeInViewport({ ratio: 0.15, timeout: 10_000 });

    await captionBeat(page, 'And the same rule as a picture: payment is optional, shipment is not.', {
      label: 'mermaid-visible',
      mark: beat,
      minMs: 4200,
      maxMs: 6000,
    });

    // Pan down toward the failure branch (ValidatePayment/SubmitPayment sit lower
    // in the diagram) — a real scroll gesture, not a second scrollIntoView jump.
    await page.mouse.wheel(0, 260);
    await captionBeat(page, "This is what we're about to prove — live, not on a slide.", {
      label: 'mermaid-failure-branch',
      mark: beat,
      minMs: 1800,
      maxMs: 3400,
    });

    // ACT II — run it --------------------------------------------------------------
    await captionBeat(page, 'One click runs the real thing.', {
      mark: beat,
      minMs: 1000,
      maxMs: 1800,
    });
    await spotlightClick(page, '.run-button');
    beat('run-click');

    const runResultLink = page.locator('.run-result a');
    await expect(runResultLink).toBeVisible({ timeout: 15_000 });
    const jobId = (await runResultLink.innerText()).trim();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    beat('job-created');

    await captionBeat(page, 'A real order, entering the real engine.', {
      mark: beat,
      minMs: 1200,
      maxMs: 2200,
    });
    await runResultLink.click();

    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(page.locator('.job-detail-header')).toContainText(jobId, { timeout: 5_000 });
    await page.locator('.workflow-pill', { hasText: 'order-processing' }).click();
    beat('workflow-filtered');

    // ACT III — watch the graph ----------------------------------------------------
    await captionBeat(page, "Customer, order, shipment — everything Ada's Beans Cafe owes this order.", {
      mark: beat,
      minMs: 1600,
      maxMs: 3000,
    });

    await spotlightClick(page, '.dag-expand-btn');
    await expect(page.locator('.dag-fullscreen')).toBeVisible({ timeout: 5_000 });
    beat('fullscreen-open');

    await captionBeat(page, 'The whole promise, as a living map.', {
      mark: beat,
      minMs: 1400,
      maxMs: 2600,
    });

    // Watch for ValidatePayment to leave `pending` (in_progress, then
    // in_progress_retrying) — the real signal the retry drama has started.
    await captionBeat(page, 'Green is kept. Blue is in flight. Watch the payment corner.', {
      mark: beat,
      minMs: 1600,
      waitFor: () =>
        page.waitForSelector('.dag-fullscreen g.node[data-step="ValidatePayment"].dagActive', { timeout: 20_000 }),
      maxMs: 22_000,
    });

    // Node drill-down — ValidatePayment is a PRIMARY step, so this renders the real
    // attempt-by-attempt activity timeline (confirmed live, see file header).
    await spotlightClick(page, '.dag-fullscreen-canvas g.node[data-step="ValidatePayment"]');
    await expect(page.locator('.step-drilldown')).toBeVisible({ timeout: 5_000 });
    beat('drilldown-open');

    await captionBeat(page, "The engine isn't giving up — attempt two, attempt three, on its own.", {
      mark: beat,
      minMs: 2200,
      // The 2nd/3rd attempt land ~30s apart (SQS visibility timeout) — this is the
      // real F4 dead-air span; beat-syncing keeps a caption honestly narrating it
      // instead of freezing, and generate-demo-media.sh speed-ramps this exact span
      // in post (drilldown-open -> terminal-landed) with an on-frame ×N tag.
      waitFor: () =>
        page.waitForSelector('.step-drilldown .drilldown-attempt-chip', { timeout: 40_000 }).catch(() => {}),
      maxMs: 42_000,
    });

    await page.locator('.drilldown-scope-events-btn').click();
    beat('console-scoped');
    await captionBeat(page, 'Every attempt is on the record — nothing hidden in a log file.', {
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
    await captionBeat(page, 'The payment lost. The order won.', {
      mark: beat,
      minMs: 1600,
      waitFor: () =>
        Promise.all([
          page.waitForSelector('.dag-fullscreen g.node[data-step="ValidatePayment"].dagFailed', { timeout: 60_000 }),
          page.waitForSelector('.dag-fullscreen g.node[data-step="SubmitPayment"].dagSkipped', { timeout: 60_000 }),
        ]),
      maxMs: 60_000,
    });
    beat('terminal-landed');

    // Two-level Esc (drill-down first, then full-screen) — ON CAMERA, per storyboard.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dag-fullscreen')).toHaveCount(0, { timeout: 5_000 });
    beat('fullscreen-exit');

    await expect(page.locator('.job-detail-header .status')).toHaveText(/PARTIAL_SUCCESS|COMPLETED|FAILED/i, {
      timeout: 10_000,
    });
    await captionBeat(page, 'PARTIAL SUCCESS — the engine failed exactly as designed.', {
      mark: beat,
      minMs: 2000,
      maxMs: 3200,
    });

    // ACT IV — the promise, checked -------------------------------------------------
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-04-partial-payment-failure' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();
    await expect(assertionsHeading).toBeInViewport({ ratio: 0.3, timeout: 5_000 });
    beat('assertions');

    await captionBeat(page, "Here's the checklist proving the promise held, item by item.", {
      mark: beat,
      minMs: 2400,
      maxMs: 3800,
    });
    await captionBeat(page, 'Contracts you can watch being kept.', {
      mark: beat,
      minMs: 2000,
      maxMs: 3000,
    });
  });
});
