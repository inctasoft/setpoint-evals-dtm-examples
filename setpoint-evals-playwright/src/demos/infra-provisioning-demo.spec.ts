/**
 * Demo: Infrastructure Provisioning — "blast radius as a picture"
 *
 * Phase 5 story recording. Drives the monitor's Scenarios screen: open the
 * eval, read its README as the contract, click Run, follow the job live on
 * the Dashboard as a mid-chain failure cascades, then close back on the
 * Assertions checklist.
 *
 * Scenario: workflows/infra-provisioning/setpoint-evals/SE-08-skipped-propagation-breadth
 * — the compute stage of the prod-eu chain fails permanently for every
 * fanned-out instance; three sibling cascades that depend directly on
 * compute (storage, dns, load balancer) are skipped, and dns's own
 * dependent (certificate) is skipped two hops deep — breadth AND depth of
 * the blast radius in one run. Compute is a required cascade, so the job
 * lands FAILED.
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { caption } from './helpers';

test.use({ demoSlug: 'infra-cascade-failure' });

test.describe('Demo: Infra Provisioning', () => {
  test.setTimeout(240_000);

  test('STORY: infra-provisioning 5-level cascade failure skips storage/dns/cert/LB (Scenarios -> Run -> Dashboard)', async ({
    dashboardPage: page,
  }) => {
    await caption(
      page,
      'Provisioning an environment is a chain: network, then compute, then everything that sits on top of it. Break one link and watch what really depends on it.',
      3800,
    );

    // 1. Scenarios screen — the README IS the contract.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'Infra' }).click();

    await caption(page, "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs.", 3200);

    await page.locator('.eval-list-item', { hasText: 'SE-08-skipped-propagation-breadth' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    const mermaidSvg = page.locator('.readme-body svg');
    await expect(mermaidSvg).toBeVisible({ timeout: 10_000 });

    await caption(
      page,
      "This chain's compute stage is configured to fail permanently — on purpose, so we can watch the blast radius, not guess at it.",
      3800,
    );

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
    await page.locator('.workflow-pill', { hasText: 'infra-provisioning' }).click();

    await caption(
      page,
      'Storage, DNS, and the load balancer all sit directly on compute — three separate promises that all break the same way, at once.',
      4400,
    );

    await expect(page.locator('.job-detail-header .status')).toHaveText(/FAILED|PARTIAL_SUCCESS|COMPLETED/i, {
      timeout: 150_000,
    });

    await caption(
      page,
      'The certificate depended on DNS, not on compute directly — two hops away, and still caught by the same failure. Nothing downstream was left guessing.',
      4800,
    );
    await page.waitForTimeout(2500); // hold the landed dashboard state for the recording

    // 3. Close on the contract's own checklist.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-08-skipped-propagation-breadth' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();

    await caption(page, 'The checklist confirms exactly what should have broken — and, just as important, what should not have.', 3800);
    await page.waitForTimeout(2500); // final frame hold
  });
});
