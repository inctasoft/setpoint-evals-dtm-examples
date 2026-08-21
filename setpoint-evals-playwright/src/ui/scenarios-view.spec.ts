/**
 * UI coverage for the monitor's "Scenarios" screen (Phase 4a). Drives a real
 * browser against a real orchestrator — no mocking. Requires the standard
 * local stack running (see setpoint-evals-playwright/README or
 * global-setup.ts's own preflight) with Lambda workers deployed, since the
 * "Run creates a job" case waits for a REAL job to reach a terminal state.
 */

import { test, expect } from '../fixtures/scenarios-dashboard.fixture';

test.describe('Scenarios screen', () => {
  test('lists at least 41 evals across all four suites', async ({ dashboardPage }) => {
    await dashboardPage.getByRole('button', { name: 'Scenarios' }).click();

    const items = dashboardPage.locator('.eval-list-item');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });

    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(41);

    // Sanity: the suite tabs' own "All" count agrees with the rendered list.
    const allTabText = await dashboardPage.locator('.suite-tab', { hasText: 'All' }).innerText();
    const allTabCount = parseInt(allTabText.replace(/\D/g, ''), 10);
    expect(allTabCount).toBe(count);
  });

  test('selecting an eval renders its gherkin scenario and a mermaid diagram', async ({
    dashboardPage,
  }) => {
    await dashboardPage.getByRole('button', { name: 'Scenarios' }).click();

    // core/SE-04-ack-delays: a real eval with both a Scenario and an Architecture mermaid block.
    await dashboardPage.locator('.eval-list-item', { hasText: 'SE-04-ack-delays' }).first().click();

    const gherkin = dashboardPage.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Feature:');
    await expect(gherkin).toContainText('Scenario:');

    // mermaid.run() replaces <pre class="mermaid"> with a rendered <svg> — the
    // presence of that svg (not just the raw fence text) proves the diagram
    // actually rendered, not just that the markdown pipeline emitted a fence.
    const mermaidSvg = dashboardPage.locator('.readme-body svg');
    await expect(mermaidSvg).toBeVisible({ timeout: 10_000 });
  });

  test('Run creates a job that becomes visible and selected on the Dashboard', async ({
    dashboardPage,
  }) => {
    await dashboardPage.getByRole('button', { name: 'Scenarios' }).click();
    await dashboardPage.locator('.eval-list-item', { hasText: 'SE-04-ack-delays' }).first().click();

    await dashboardPage.locator('.run-button').click();

    const runResultLink = dashboardPage.locator('.run-result a');
    await expect(runResultLink).toBeVisible({ timeout: 15_000 });
    const jobId = (await runResultLink.innerText()).trim();
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    await runResultLink.click();

    // The click switches the view back to Dashboard (an <a> onClick, not a
    // real navigation) with this exact job selected in the Job Detail panel —
    // the improvement over the donor pattern (task brief).
    await expect(dashboardPage.getByRole('button', { name: 'Dashboard' })).toHaveClass(/active/);
    await expect(dashboardPage.locator('.job-detail-header')).toContainText(jobId, {
      timeout: 5_000,
    });

    // The job actually reaches a terminal state (not left hanging forever).
    await expect(dashboardPage.locator('.job-detail-header .status')).toHaveText(
      /COMPLETED|FAILED/i,
      { timeout: 60_000 },
    );
  });
});
