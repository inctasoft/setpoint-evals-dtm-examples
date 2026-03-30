/**
 * Dashboard browser fixture for demo video recordings.
 *
 * Extends the existing API + DB fixture chain with a real Chromium page
 * that opens the DTM monitor dashboard. Tests using this fixture get:
 *   - dashboardPage: a Playwright Page navigated to the monitor UI
 *   - dtmApi: the existing API client for triggering workflows
 *   - dtmDb: the existing DB client for verification
 *   - env: environment config
 *
 * The fixture waits for the dashboard to be responsive before yielding.
 */

import { test as dbTest } from './db-client.fixture';
import { chromium, type Page, type Browser } from '@playwright/test';
import { loadEnv } from '../helpers/env';

export const test = dbTest.extend<{ dashboardPage: Page }>({
  dashboardPage: async ({}, use) => {
    const env = loadEnv();
    const dashboardUrl = process.env.DASHBOARD_URL ?? `http://localhost:${env.ORCHESTRATOR_PORT === 3002 ? 5173 : 5173}`;

    const browser: Browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      recordVideo: {
        dir: 'test-results/videos/',
        size: { width: 1280, height: 900 },
      },
    });

    const page = await context.newPage();

    // Navigate and wait for the dashboard to render
    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 15_000 });

    // Wait for the header to appear (proves Preact app mounted)
    await page.waitForSelector('.header', { timeout: 10_000 });

    await use(page);

    // Teardown: close context to flush video to disk
    await context.close();
    await browser.close();
  },
});

export { expect } from '@playwright/test';
