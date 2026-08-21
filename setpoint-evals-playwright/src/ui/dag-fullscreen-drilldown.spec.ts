/**
 * UI coverage for the full-screen DAG + node drill-down + console pairing (dtm-video-v2
 * ux-storyboards.md §3.1-3.3, capability-spec.md §3.1-3.4) and the D4 disclosure fix (§3.5).
 * Drives a real browser against a real orchestrator (scenarios-dashboard.fixture — hermetic,
 * boots its own monitor dev server) — no mocking.
 *
 * Also carries SE-27's deferred case 27.3 (setpoint-evals/SE-27-dag-overlay-status-parity's
 * README §"Scope note": "27.3 ... is explicitly deferred to Lane B's PR" — a skipped step's
 * DAG node must carry the `dagSkipped` mermaid class, not just render `pending`).
 *
 * Every assertion below checks the REAL property the storyboard critique (F1) was about — a
 * false-green `toBeVisible()` on an off-viewport/inert element is exactly the bug class this
 * whole build exists to fix, so these specs read actual class lists, actual transform strings,
 * and actual row counts, never presence-only.
 */

import { test, expect } from '../fixtures/scenarios-dashboard.fixture';

const ORDER_PROCESSING_FAILING_PAYMENT_PAYLOAD = (entityId: string) => ({
  enableDeduplication: false,
  variant: 'default',
  payload: {
    customerId: 7,
    productId: 1,
    orderId: 7,
    paymentId: 99999, // not-found sentinel — ValidatePayment fails permanently (SE-04's own fixture)
    shipmentId: 7,
    entityId,
  },
  testOptions: {
    ValidateCustomer: { simDelay: 300 },
    ValidateProduct: { simDelay: 300 },
    SubmitCustomer: { simDelay: 300, ackDelay: 1000 },
    ValidateOrder: { simDelay: 300 },
    SubmitOrder: { simDelay: 300, ackDelay: 1000 },
    DiscoverLineItems: { simDelay: 300 },
    ValidateLineItem: { simDelay: 300 },
    SubmitLineItem: { simDelay: 300, ackDelay: 1000 },
    ValidatePayment: { simDelay: 300 },
    SubmitPayment: { simDelay: 300, ackDelay: 1000 },
    ValidateShipment: { simDelay: 300 },
    SubmitShipment: { simDelay: 300, ackDelay: 1000 },
  },
});

test.describe('Full-screen DAG, node drill-down, and console pairing', () => {
  test('skip-class parity, zoom persists across a live event, attempt timeline, and console filter actually scopes', async ({
    dashboardPage,
    dtmApi,
  }) => {
    test.setTimeout(240_000);

    const { jobId } = await dtmApi.initiateJob(
      ORDER_PROCESSING_FAILING_PAYMENT_PAYLOAD(`dagfs-${Date.now()}`),
      'order-processing',
    );

    await dashboardPage.locator('.workflow-pill', { hasText: 'order-processing' }).click();
    // Newest job sorts first — the just-created job becomes the auto-selection.
    await expect(dashboardPage.locator('.job-detail-header')).toContainText(jobId, { timeout: 20_000 });

    await dashboardPage.locator('.dag-expand-btn').click();
    await expect(dashboardPage.locator('.dag-fullscreen')).toBeVisible();

    // Zoom in, capture the REAL transform string (not "canvas visible") — this is the property
    // the storyboard needs (pan/zoom state surviving a live status update).
    const wrapper = dashboardPage.locator('.dag-pan-zoom-wrapper');
    await dashboardPage.locator('.dag-zoom-controls button', { hasText: '+' }).click();
    await expect
      .poll(() => wrapper.evaluate((el: any) => el.style.transform), { timeout: 5_000 })
      .toMatch(/scale\(1\.2\)/);
    const transformAfterZoom = await wrapper.evaluate((el: any) => el.style.transform);

    const validatePaymentNode = dashboardPage.locator('.dag-fullscreen g.node[data-step="ValidatePayment"]');

    // Wait for a REAL live status transition to land (proves a WS event actually re-applied
    // node classes) and re-read the transform — must be byte-identical, not just "still open".
    await expect(validatePaymentNode).not.toHaveClass(/dagPending/, { timeout: 30_000 });
    const transformAfterLiveEvent = await wrapper.evaluate((el: any) => el.style.transform);
    expect(transformAfterLiveEvent).toBe(transformAfterZoom);

    // SE-27 §27.3: the skipped step's node carries dagSkipped, not a bare "no class" pending look.
    // ValidatePayment's 3 real retry attempts (SQS visibility-timeout-based, no simDelay
    // override on the failure path) make this job take ~60-70s wall-clock to reach terminal —
    // budget well past that, not right at the edge.
    const submitPaymentNode = dashboardPage.locator('.dag-fullscreen g.node[data-step="SubmitPayment"]');
    await expect(submitPaymentNode).toHaveClass(/dagSkipped/, { timeout: 120_000 });
    await expect(validatePaymentNode).toHaveClass(/dagFailed/);

    // Transform must STILL be unchanged after the whole run of live events to terminal.
    const transformAtTerminal = await wrapper.evaluate((el: any) => el.style.transform);
    expect(transformAtTerminal).toBe(transformAfterZoom);

    // Drill-down: click the failed node, assert the REAL attempt timeline content (3 failed
    // attempts, the actual error string) — not just "drilldown panel visible".
    await validatePaymentNode.click();
    await expect(dashboardPage.locator('.step-drilldown-title')).toHaveText('ValidatePayment');
    const failedAttempts = dashboardPage.locator('.activity-timeline .timeline-failed');
    await expect(failedAttempts).toHaveCount(3, { timeout: 15_000 });
    await expect(dashboardPage.locator('.activity-timeline')).toContainText('No payments found for order 99999');

    // Console pairing (§3.3): scoping must actually REDUCE the row count, every remaining row
    // must name the scoped step, and the filter chip must be visible — the F1-shaped failure
    // mode here would be "chip renders but filtering is a no-op".
    const allRowsCount = await dashboardPage.locator('.dag-fullscreen-dock .log-entry').count();
    expect(allRowsCount).toBeGreaterThan(0);

    await dashboardPage.locator('.drilldown-scope-events-btn').click();
    await expect(
      dashboardPage.locator('.dag-fullscreen-dock .filter-chip', { hasText: 'ValidatePayment' }),
    ).toBeVisible();

    const scopedRows = dashboardPage.locator('.dag-fullscreen-dock .log-entry');
    const scopedCount = await scopedRows.count();
    expect(scopedCount).toBeGreaterThan(0);
    expect(scopedCount).toBeLessThan(allRowsCount);
    const scopedTexts = await scopedRows.allInnerTexts();
    for (const text of scopedTexts) {
      expect(text).toContain('ValidatePayment');
    }

    // Two-level Esc: closes drill-down first (rail gone, still full-screen), then full-screen.
    await dashboardPage.keyboard.press('Escape');
    await expect(dashboardPage.locator('.dag-fullscreen-rail')).toHaveCount(0);
    await expect(dashboardPage.locator('.dag-fullscreen')).toBeVisible();
    await dashboardPage.keyboard.press('Escape');
    await expect(dashboardPage.locator('.dag-fullscreen')).toHaveCount(0);
  });
});

test.describe('Scenarios D4 disclosure', () => {
  test('Artifacts/Run collapse behind a default-closed "Technical verification" twisty, Assertions stays visible', async ({
    dashboardPage,
  }) => {
    await dashboardPage.getByRole('button', { name: 'Scenarios' }).click();
    // core/SE-04-ack-delays has both Artifacts and Run sections (verified against the README).
    await dashboardPage.locator('.eval-list-item', { hasText: 'SE-04-ack-delays' }).first().click();

    const disclosure = dashboardPage.locator('.readme-technical-disclosure');
    await expect(disclosure).toBeVisible();

    // The REAL property: the <details> has no `open` attribute (collapsed), not merely
    // "off-screen" or "zero-height" — the F1 false-green shape this whole task exists to avoid.
    await expect(disclosure).not.toHaveAttribute('open', '');
    await expect(disclosure.locator('summary')).toHaveText('Technical verification ▸');

    // Its raw shell content must genuinely be hidden, not just visually de-emphasized —
    // toBeVisible() is false for content inside a closed <details>.
    const technicalBody = disclosure.locator('.readme-body');
    await expect(technicalBody).not.toBeVisible();

    // Assertions stays in the ALWAYS-visible main flow, outside the disclosure.
    const mainBody = dashboardPage.locator('.scenarios-detail-body > .readme-body').first();
    await expect(mainBody).toContainText('Assertions');

    // Opening it (native <details> toggle) actually reveals the content — proves this isn't a
    // decorative twisty that never opens.
    await disclosure.locator('summary').click();
    await expect(disclosure).toHaveAttribute('open', '');
    await expect(technicalBody).toBeVisible();
  });
});
