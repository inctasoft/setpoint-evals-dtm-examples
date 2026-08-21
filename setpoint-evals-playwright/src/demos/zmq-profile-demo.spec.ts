/**
 * Demo: Full-ZeroMQ Bus Profile — "the same engine, zero brokers"
 *
 * The fourth STORY demo (bus-agnosticism program closeout), following the same
 * house contract as the other three (docs/guides/DEMO-VIDEOS.md): read the
 * contract on the Scenarios screen (SE-36-full-zmq-bus-profile's own README —
 * gherkin + mermaid scrolled IN VIEWPORT), a spotlighted Run click re-issuing the
 * README's quick-order payload, live dashboard, full-screen DAG on camera, a node
 * drill-down, and a close on the Assertions checklist.
 *
 * What makes this demo different is what is NOT on camera: no SQS, no LocalStack,
 * no Kafka, no Zookeeper, no sqs-pollers. The stack for this recording is the
 * full-zmq profile (BUS_PROFILE=zmq): tasks travel the orchestrator's ROUTER to
 * per-workflow zmq-worker-host DEALERs (in-process handlers), events and ACKs
 * travel PUB/PULL to the dev-ack-simulator's zmq client. Captions never say
 * "zmq", "ROUTER", or "socket" on camera — the story is the business promise:
 * the same engine, one docker network, zero brokers.
 *
 * GROUND TRUTH checked live before scripting (2026-07-29, this stack):
 * - The task-bus ("SQS") panel under QUEUE_TRANSPORT=zmq is fed by
 *   ZmqTransport.getQueueStatuses() — every queue the worker registry knows
 *   (3 registered worker-hosts, ~39 queues), mostly all-zero counts under a
 *   healthy fleet, so the panel honestly shows "All N queues idle" rather than
 *   fabricated depth. The demo captions the panel's own idle-state as the
 *   evidence ("every queue accounted for, none on a broker") and does NOT
 *   promise in-flight activity — receipt-ack is near-instant, so a busy row is
 *   a coin flip, not a surface to build a beat on.
 * - The Kafka Topics tab under EVENT_BUS=zmq (broker stopped) renders
 *   kafka-panel.tsx's honest degraded empty-state ("Kafka broker not reachable —
 *   topics unavailable") — GET /api/v1/kafka/topics returns
 *   {topics: [], connected: false}. Not an error page, not fabricated data.
 * - The Run button on SE-36's eval detail re-issues the README's quick-order
 *   payload through /api/v1/evals/core/SE-36-full-zmq-bus-profile/run (verified
 *   live: returns a jobId and the job completes in ~20-40s on this profile).
 */

import { test, expect } from '../fixtures/demo-recording.fixture';
import { captionBeat, spotlightClick } from './helpers';

test.use({ demoSlug: 'zmq-bus-profile-zero-brokers' });

test.describe('Demo: Full-ZeroMQ Bus Profile', () => {
  test.setTimeout(180_000);

  test('STORY: zero-broker profile runs a job end-to-end (Scenarios -> Run -> task-bus panel -> full-screen DAG -> drill-down -> honest Kafka tab -> Assertions)', async ({
    dashboardPage: page,
    beat,
  }) => {
    // ACT I — read the contract ---------------------------------------------------
    await captionBeat(page, 'The same engine. One docker network. Zero brokers.', {
      label: 'open',
      mark: beat,
      minMs: 2000,
      maxMs: 3600,
    });

    await page.getByRole('button', { name: 'Scenarios' }).click();
    await page.locator('.suite-tab', { hasText: 'Core' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-36-full-zmq-bus-profile' }).first().click();

    const gherkin = page.locator('.gherkin-block');
    await expect(gherkin).toBeVisible();
    await expect(gherkin).toContainText('Scenario:');

    await captionBeat(page, 'The contract says it plainly: stop every broker — the work still gets done.', {
      label: 'scenarios',
      mark: beat,
      minMs: 2000,
      maxMs: 3600,
    });

    const mermaidSvg = page.locator('.readme-body svg').first();
    await mermaidSvg.scrollIntoViewIfNeeded();
    await expect(mermaidSvg).toBeInViewport({ ratio: 0.15, timeout: 10_000 });

    await captionBeat(page, 'No queue server, no message broker — and the steps still flow, the answers still come back.', {
      label: 'mermaid-visible',
      mark: beat,
      minMs: 4200,
      maxMs: 6200,
    });

    // ACT II — run it --------------------------------------------------------------
    await captionBeat(page, 'One click runs the real thing — on nothing but this network.', {
      mark: beat,
      minMs: 1200,
      maxMs: 2000,
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

    // The task-bus panel, honestly: every queue the engine knows is accounted for
    // on this panel (the fleet registered them — read the ground-truth note in the
    // file header) — and none of them live on a broker. The right panel's tabs are
    // .tab-btn inside .tabbed-panel (demo mode pins Events by default, so this is a
    // real on-camera tab click).
    await spotlightClick(page, '.tabbed-panel .tab-btn:text-is("SQS")');
    await expect(
      page.locator('.tabbed-panel .empty-state, .tabbed-panel .sqs-table').first(),
    ).toBeVisible({ timeout: 10_000 });
    beat('taskbus-panel');

    await captionBeat(page, 'Every queue the engine knows, in plain view — and not one of them on a broker.', {
      mark: beat,
      minMs: 2400,
      maxMs: 4200,
    });

    // ACT III — watch the graph ----------------------------------------------------
    await spotlightClick(page, '.dag-expand-btn');
    await expect(page.locator('.dag-fullscreen')).toBeVisible({ timeout: 5_000 });
    beat('fullscreen-open');

    await captionBeat(page, 'The whole job, as a living map.', {
      mark: beat,
      minMs: 1400,
      maxMs: 2600,
    });

    await captionBeat(page, 'Work flowing already — no waiting room, no redelivery clock.', {
      mark: beat,
      minMs: 1600,
      // Zmq jobs land in seconds — a completed DAG never turns .dagActive, so this
      // beat resolves early on a fast run and caps quickly on a slow one (the 22s
      // ceiling produced a 26s static stretch on the first take; tightened after
      // frame review).
      waitFor: () =>
        page.waitForSelector('.dag-fullscreen g.node[data-step="ValidateCustomer"].dagActive', { timeout: 5_000 }),
      maxMs: 7_000,
    });

    // Node drill-down — SubmitCustomer is the step that also needs an external
    // confirmation; its real activity is on this surface either way.
    await spotlightClick(page, '.dag-fullscreen-canvas g.node[data-step="SubmitCustomer"]');
    await expect(page.locator('.step-drilldown')).toBeVisible({ timeout: 5_000 });
    beat('drilldown-open');

    await captionBeat(page, 'Every step accounted for, on the record — the same way it always was.', {
      mark: beat,
      minMs: 2200,
      maxMs: 4000,
    });

    // Two-level Esc (drill-down first, then full-screen) — on camera.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dag-fullscreen')).toHaveCount(0, { timeout: 5_000 });

    // The honest broker panel — the degraded state IS the evidence.
    await spotlightClick(page, '.tabbed-panel .tab-btn:text-is("Kafka")');
    await expect(page.locator('.tabbed-panel .empty-state')).toContainText(/Kafka broker not reachable/i, {
      timeout: 15_000,
    });
    beat('kafka-honest');

    await captionBeat(page, 'This panel has nothing to hide: there is no broker to reach.', {
      mark: beat,
      minMs: 2400,
      maxMs: 4200,
    });

    // Terminal state lands.
    await expect(page.locator('.job-detail-header .status')).toHaveText(/COMPLETED/i, {
      timeout: 60_000,
    });
    beat('terminal-landed');

    await captionBeat(page, 'COMPLETED — every step, every confirmation, zero brokers.', {
      mark: beat,
      minMs: 2200,
      maxMs: 3600,
    });

    // ACT IV — the promise, checked -------------------------------------------------
    await page.getByRole('button', { name: 'Scenarios' }).click();
    // The sidebar inherits the header's workflow pill (remounted via key — see
    // eval-sidebar.tsx), so the Core suite must be re-selected before SE-36 is
    // visible again (found live: second-pass timeout on exactly this line).
    await page.locator('.suite-tab', { hasText: 'Core' }).click();
    await page.locator('.eval-list-item', { hasText: 'SE-36-full-zmq-bus-profile' }).first().click();
    const assertionsHeading = page.locator('.readme-body h2', { hasText: 'Assertions' });
    await expect(assertionsHeading).toBeVisible({ timeout: 10_000 });
    await assertionsHeading.scrollIntoViewIfNeeded();
    await expect(assertionsHeading).toBeInViewport({ ratio: 0.3, timeout: 5_000 });
    beat('assertions');

    await captionBeat(page, 'The checklist, kept item by item.', {
      mark: beat,
      minMs: 2400,
      maxMs: 3800,
    });
    await captionBeat(page, 'AWS primitives when you want them. Zero brokers when you don’t. One environment variable.', {
      label: 'close',
      mark: beat,
      minMs: 2600,
      maxMs: 4200,
    });
  });
});
