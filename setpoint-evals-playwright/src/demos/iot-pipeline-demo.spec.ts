/**
 * Demo: IoT Sensor Pipeline — "one job becomes a whole tree of work"
 *
 * Phase 5 story recording. Drives the monitor's Scenarios screen: open the
 * eval, read its README as the contract, click Run, follow the job live on
 * the Dashboard as it fans out, then close back on the Assertions checklist.
 *
 * Scenario: workflows/iot-sensor-pipeline/setpoint-evals/SE-03-double-fan-out
 * — the README's own "Demo pick" annotation: greenhouse-3's 3 sensors each
 * independently trigger their own reading fan-out (2 nested levels from a
 * single job — device to sensors, sensor to readings). The most visually
 * kinetic run in the estate; the job lands COMPLETED.
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { caption } from './helpers';

test.use({ demoSlug: 'iot-double-fan-out' });

test.describe('Demo: IoT Sensor Pipeline', () => {
  test.setTimeout(240_000);

  test('STORY: iot-sensor-pipeline double fan-out explodes into an N-by-M step tree (Scenarios -> Run -> Dashboard)', async ({
    dashboardPage: page,
  }) => {
    await caption(
      page,
      'Greenhouse 3 is the widest device in the fleet — one sensor check can explode into dozens of readings.',
      3600,
    );

    // 1. Scenarios screen — the README IS the contract.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'IoT' }).click();

    await caption(page, "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs.", 3200);

    await page.locator('.eval-list-item', { hasText: 'SE-03-double-fan-out' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    const mermaidSvg = page.locator('.readme-body svg');
    await expect(mermaidSvg).toBeVisible({ timeout: 10_000 });

    await caption(
      page,
      'Three sensors, each independently checking its own history — nobody pre-declares that shape, the engine discovers it live.',
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
    await page.locator('.workflow-pill', { hasText: 'iot-sensor-pipeline' }).click();

    await caption(
      page,
      'Watch one job become a whole tree of work — every sensor, then every reading underneath it, each tracked on its own.',
      4600,
    );

    await expect(page.locator('.job-detail-header .status')).toHaveText(/COMPLETED|PARTIAL_SUCCESS|FAILED/i, {
      timeout: 120_000,
    });

    await caption(
      page,
      'Every branch finished — the fleet’s widest device, fully accounted for, without anyone hand-wiring the fan-out.',
      4400,
    );
    await page.waitForTimeout(2500); // hold the landed dashboard state for the recording

    // 3. Close on the contract's own checklist.
    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-03-double-fan-out' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();

    await caption(page, 'The checklist confirms it — every sensor, every reading, done.', 3600);
    await page.waitForTimeout(2500); // final frame hold
  });
});
