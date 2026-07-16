/**
 * Hermetic monitor-UI fixture for the Scenarios screen.
 *
 * Boots apps/monitor's OWN Vite dev server on a freshly-picked port, with
 * VITE_DISABLE_AUTH=true (see apps/monitor/src/app.tsx — the frontend
 * counterpart of the backend's DISABLE_AUTH; DISABLE_AUTH alone does NOT
 * bypass the monitor's own SuperTokens redirect, so headless Playwright has
 * no other path in). Self-booting per the workspace's hermetic-harness
 * convention (server-config/docs/setpoint-eval-conventions.md "Self-booting
 * harnesses"): refuses a busy port rather than reusing whatever's there,
 * and reaps the WHOLE process tree on teardown (setsid + kill-by-pgid) so a
 * crashed run never leaks an orphaned vite/esbuild process that poisons the
 * next one. Does NOT fight the workspace's shared 5173-5182 dev-server port
 * range (other concurrent agents hold those) — picks an arbitrary free port.
 */

import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { chromium, type Page, type Browser } from '@playwright/test';
import { test as dbTest } from './db-client.fixture';

const MONITOR_DIR = path.resolve(__dirname, '../../../apps/monitor');
const VITE_BIN = path.resolve(__dirname, '../../../node_modules/.bin/vite');

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not determine a free port')));
      }
    });
  });
}

async function waitForHttp(url: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`monitor dev server never became ready at ${url}`);
}

export const test = dbTest.extend<{ dashboardPage: Page; dashboardUrl: string }>({
  dashboardUrl: async ({}, use) => {
    const port = await findFreePort();
    const url = `http://127.0.0.1:${port}`;

    const child: ChildProcess = spawn(
      process.execPath,
      [VITE_BIN, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: MONITOR_DIR,
        env: { ...process.env, VITE_DISABLE_AUTH: 'true' },
        detached: true, // own process group -> teardown can reap the whole tree
        stdio: 'ignore',
      },
    );

    let reaped = false;
    const reap = () => {
      if (reaped || !child.pid) return;
      reaped = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    };
    process.once('exit', reap);

    try {
      await waitForHttp(url);
    } catch (err) {
      reap();
      throw err;
    }

    await use(url);

    reap();
  },

  dashboardPage: async ({ dashboardUrl }, use) => {
    const browser: Browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1400, height: 960 } });
    const page = await context.newPage();

    await page.goto(dashboardUrl, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForSelector('.header', { timeout: 10_000 });

    await use(page);

    await context.close();
    await browser.close();
  },
});

export { expect } from '@playwright/test';
