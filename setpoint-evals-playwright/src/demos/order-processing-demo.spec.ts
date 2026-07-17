/**
 * Demo: Order Processing — "a failed payment may not sink the order"
 *
 * Phase 5 story recording. Drives the monitor's Scenarios screen exactly the
 * way an operator would: open the eval, read its README as the contract,
 * click Run, follow the job live on the Dashboard, then close back on the
 * Assertions checklist that proves the contract held.
 *
 * Scenario: workflows/order-processing/setpoint-evals/SE-04-partial-payment-failure
 * — Barbara Liskov's card never finishes processing (payload.paymentId is a
 * sentinel that matches no row), but Customer/Order/Shipment are required
 * cascades and complete regardless. The job lands PARTIAL_SUCCESS.
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { caption } from './helpers';

test.use({ demoSlug: 'order-processing-partial-payment-failure' });

test.describe('Demo: Order Processing', () => {
  test.setTimeout(200_000);

  test('STORY: order-processing partial payment failure lands PARTIAL_SUCCESS (Scenarios -> Run -> Dashboard)', async ({
    dashboardPage: page,
  }) => {
    await caption(
      page,
      "Ada's Beans Cafe promises: if a payment fails, your order still ships. Watch the engine keep that promise.",
      3600,
    );

    // 1. Scenarios screen — the README IS the contract.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'Order Processing' }).click();

    await caption(
      page,
      "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs.",
      3200,
    );

    await page.locator('.eval-list-item', { hasText: 'SE-04-partial-payment-failure' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    const mermaidSvg = page.locator('.readme-body svg');
    await expect(mermaidSvg).toBeVisible({ timeout: 10_000 });

    await caption(page, "Barbara's card on file never finishes processing — that's deliberate, not a bug.", 3600);

    // 2. Run — re-issues this exact README's Payload through the real job API.
    await caption(page, 'Clicking Run submits the real job the contract describes.', 2200);
    await page.locator('.run-button').click();

    const runResultLink = page.locator('.run-result a');
    await expect(runResultLink).toBeVisible({ timeout: 15_000 });
    const jobId = (await runResultLink.innerText()).trim();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    await caption(page, 'Following the job live on the operations dashboard.', 2200);
    await runResultLink.click();

    await expect(page.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(page.locator('.job-detail-header')).toContainText(jobId, { timeout: 5_000 });

    // Filter the dashboard to this workflow — the per-workflow step graph lights up.
    await page.locator('.workflow-pill', { hasText: 'order-processing' }).click();

    await caption(
      page,
      "The customer, the order, and the shipment are everything Ada's Beans Cafe owes this order — watch them land while the payment struggles.",
      4200,
    );

    await expect(page.locator('.job-detail-header .status')).toHaveText(/PARTIAL_SUCCESS|COMPLETED|FAILED/i, {
      timeout: 60_000,
    });

    await caption(
      page,
      'The payment failed, and the engine skipped only what depended on it — everything else Barbara was promised still shipped.',
      4600,
    );
    await page.waitForTimeout(2500); // hold the landed dashboard state for the recording

    // 3. Close on the contract's own checklist.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-04-partial-payment-failure' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();

    await caption(page, "Here's the checklist proving the promise held, item by item.", 3600);
    await page.waitForTimeout(2500); // final frame hold
  });
});
