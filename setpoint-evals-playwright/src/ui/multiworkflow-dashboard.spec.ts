/**
 * UI coverage for Phase 4b's multi-workflow dashboard: the persistent header
 * WorkflowSelector, its job-list filtering, the per-workflow DAG mini-viz, and
 * the tabbed side-panel (SQS/Kafka/Events/Payloads/Throughput/Flags). Drives a
 * real browser against a real orchestrator — no mocking (same fixture as
 * scenarios-view.spec.ts, Phase 4a's own UI coverage).
 */

import { test, expect } from '../fixtures/scenarios-dashboard.fixture';

const KNOWN_WORKFLOWS = ['order-processing', 'iot-sensor-pipeline', 'infra-provisioning'];

test.describe('Multi-workflow dashboard', () => {
  test('workflow selector lists every registered workflow and "All" is selected by default', async ({
    dashboardPage,
  }) => {
    const allPill = dashboardPage.locator('.workflow-pill', { hasText: 'All' });
    await expect(allPill).toBeVisible({ timeout: 10_000 });
    await expect(allPill).toHaveClass(/active/);

    for (const wf of KNOWN_WORKFLOWS) {
      await expect(dashboardPage.locator('.workflow-pill', { hasText: wf })).toBeVisible();
    }

    // Default view: "All Jobs" header, no dag-section rendered (only shown for a single workflow).
    await expect(dashboardPage.locator('.panel-left .panel-header')).toContainText('All Jobs');
    await expect(dashboardPage.locator('.dag-section')).toHaveCount(0);
  });

  test('selecting a workflow filters the job list and persists across reload', async ({
    dashboardPage,
  }) => {
    await dashboardPage.locator('.workflow-pill', { hasText: 'order-processing' }).click();

    await expect(dashboardPage.locator('.panel-left .panel-header')).toContainText(
      'order-processing Jobs',
    );
    // Every rendered job row (if any exist yet on a fresh stack) must belong to this workflow —
    // the filter must never leak a job from a different workflow into the table.
    const otherWorkflowRows = dashboardPage.locator('.job-table-workflow-name', {
      hasText: /^(?!order-processing$).+/,
    });
    await expect(otherWorkflowRows).toHaveCount(0);

    // localStorage persistence: a reload must re-select the same workflow, not reset to "All".
    await dashboardPage.reload({ waitUntil: 'networkidle' });
    await dashboardPage.waitForSelector('.header', { timeout: 10_000 });
    await expect(
      dashboardPage.locator('.workflow-pill', { hasText: 'order-processing' }),
    ).toHaveClass(/active/);
    await expect(dashboardPage.locator('.panel-left .panel-header')).toContainText(
      'order-processing Jobs',
    );

    // Clean up: back to "All" so later tests in this file start from the default.
    await dashboardPage.locator('.workflow-pill', { hasText: 'All' }).click();
  });

  for (const wf of KNOWN_WORKFLOWS) {
    test(`DAG mini-viz renders a real step graph for ${wf}`, async ({ dashboardPage }) => {
      await dashboardPage.locator('.workflow-pill', { hasText: wf }).click();

      await expect(dashboardPage.locator('.dag-section')).toBeVisible();
      // mermaid.run() replaces <pre class="mermaid"> with a rendered <svg> — same proof-of-render
      // pattern as scenarios-view.spec.ts's "renders a mermaid diagram" case.
      const dagSvg = dashboardPage.locator('.dag-container svg');
      await expect(dagSvg).toBeVisible({ timeout: 10_000 });
      // At least one real node label rendered (not an empty/broken diagram).
      await expect(dashboardPage.locator('.dag-container svg .node')).not.toHaveCount(0);

      await dashboardPage.locator('.workflow-pill', { hasText: 'All' }).click();
    });
  }

  test('all six side-panel tabs switch and render content without crashing', async ({
    dashboardPage,
  }) => {
    await dashboardPage.locator('.workflow-pill', { hasText: 'order-processing' }).click();

    const tabs: Array<{ label: string; expect: () => Promise<void> }> = [
      {
        label: 'SQS',
        expect: async () => {
          await expect(dashboardPage.locator('.tab-body')).toBeVisible();
        },
      },
      {
        label: 'Kafka',
        expect: async () => {
          // Either a real topic table or the empty/unreachable state — never a blank crash.
          await expect(
            dashboardPage.locator('.tab-body .sqs-table, .tab-body .empty-state'),
          ).toBeVisible({ timeout: 10_000 });
        },
      },
      {
        label: 'Events',
        expect: async () => {
          await expect(dashboardPage.locator('.tab-body .event-log')).toBeVisible();
        },
      },
      {
        label: 'Payloads',
        expect: async () => {
          await expect(dashboardPage.locator('.tab-body .empty-state, .tab-body .payloads-list')).toBeVisible();
        },
      },
      {
        label: 'Throughput',
        expect: async () => {
          await expect(
            dashboardPage.locator('.tab-body .throughput-panel, .tab-body .empty-state'),
          ).toBeVisible({ timeout: 10_000 });
        },
      },
      {
        label: 'Flags',
        expect: async () => {
          // order-processing is selected — a real committed flag (SE-22) must render, not a placeholder.
          await expect(dashboardPage.locator('.tab-body')).toContainText('ENABLE_DEDUPLICATION', {
            timeout: 10_000,
          });
        },
      },
    ];

    for (const tab of tabs) {
      await dashboardPage.locator('.tab-btn', { hasText: tab.label }).click();
      await expect(dashboardPage.locator('.tab-btn.active', { hasText: tab.label })).toBeVisible();
      await tab.expect();
    }

    await dashboardPage.locator('.workflow-pill', { hasText: 'All' }).click();
  });
});
