import { defineConfig } from '@playwright/test';
import { loadEnv } from './src/helpers/env';

const env = loadEnv();

export default defineConfig({
  testDir: './src',
  timeout: 400_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: env.API_BASE_URL,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  globalSetup: './src/helpers/global-setup.ts',
  globalTeardown: './src/helpers/global-teardown.ts',

  projects: [
    // Phase 1: Safe evals (parallel OK)
    {
      name: 'core-safe',
      testDir: './src/core',
      testMatch: /0[1-4]|1[0-3]/,
      fullyParallel: true,
      workers: 6,
    },

    // Phase 2: Destructive evals (sequential, after safe)
    {
      name: 'core-destructive',
      testDir: './src/core',
      testMatch: /0[5-9]/,
      fullyParallel: false,
      workers: 1,
      dependencies: ['core-safe'],
    },

    // Workflow SEs
    {
      name: 'workflow-order-processing',
      testDir: './src/workflows/order-processing',
      fullyParallel: true,
      workers: 4,
    },
    {
      name: 'workflow-iot-sensor-pipeline',
      testDir: './src/workflows/iot-sensor-pipeline',
      fullyParallel: true,
      workers: 4,
    },
    {
      name: 'workflow-infra-provisioning',
      testDir: './src/workflows/infra-provisioning',
      fullyParallel: true,
      workers: 4,
    },

    // Scenarios screen UI coverage (Phase 4a) — boots its own hermetic monitor dev
    // server per test (scenarios-dashboard.fixture.ts), sequential (each test owns
    // a real orchestrator job; parallel workers would race the shared dtm-db).
    {
      name: 'ui-scenarios',
      testDir: './src/ui',
      fullyParallel: false,
      workers: 1,
      timeout: 120_000,
    },

    // Demo video recordings — records the monitor dashboard during workflow execution
    {
      name: 'demo-videos',
      testDir: './src/demos',
      fullyParallel: false,
      workers: 1,
      timeout: 240_000,
      use: {
        video: { mode: 'on', size: { width: 1280, height: 900 } },
        screenshot: 'on',
      },
    },
  ],
});
