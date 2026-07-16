import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagService } from './feature-flag.service';
import { WORKFLOW_DEFINITION } from './workflow-loader.constants';
import type { WorkflowDefinition } from '@dtm/core';

describe('FeatureFlagService', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function buildService(workflow: Partial<WorkflowDefinition>): Promise<FeatureFlagService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        { provide: WORKFLOW_DEFINITION, useValue: workflow as WorkflowDefinition },
      ],
    }).compile();
    return module.get(FeatureFlagService);
  }

  describe('Layer 2 — env var override — SCREAMING_SNAKE_CASE keys (regression)', () => {
    // Regression for the toScreamingSnake bug found via setpoint-evals/workflows/
    // iot-sensor-pipeline/setpoint-evals/SE-07-feature-flag-layering: iot-sensor-pipeline's
    // featureFlags.defaults keys are ALREADY SCREAMING_SNAKE_CASE (e.g.
    // "ENABLE_ALERT_GENERATION"), and the old regex inserted "_" before every already-
    // uppercase letter, mangling the env var name so FEATURE_FLAG_ENABLE_ALERT_GENERATION
    // never matched — Layer 2 was a silent no-op for this shape of key.
    it('honors FEATURE_FLAG_<KEY> for an already-SCREAMING_SNAKE_CASE default key', async () => {
      process.env.FEATURE_FLAG_ENABLE_ALERT_GENERATION = 'false';
      const service = await buildService({
        featureFlags: { defaults: { ENABLE_ALERT_GENERATION: true }, clientOverridable: [] },
      });
      expect(service.resolveFlags()).toEqual({ ENABLE_ALERT_GENERATION: false });
    });

    it('still honors FEATURE_FLAG_<KEY> for a camelCase default key (pre-existing behavior)', async () => {
      process.env.FEATURE_FLAG_ENABLE_DEDUPLICATION = 'true';
      const service = await buildService({
        featureFlags: { defaults: { enableDeduplication: false }, clientOverridable: [] },
      });
      expect(service.resolveFlags()).toEqual({ enableDeduplication: true });
    });

    it('falls back to the workflow default when no env var is set', async () => {
      const service = await buildService({
        featureFlags: { defaults: { ENABLE_AGGREGATION: true }, clientOverridable: [] },
      });
      expect(service.resolveFlags()).toEqual({ ENABLE_AGGREGATION: true });
    });
  });

  describe('Layer 3 — per-request override — clientOverridable allowlist', () => {
    it('applies a per-request override when the flag is client-overridable and the gate is enabled', async () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const service = await buildService({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      expect(service.resolveFlags({ ENABLE_ALERT_GENERATION: false })).toEqual({
        ENABLE_ALERT_GENERATION: false,
      });
    });

    it('ignores a per-request override when the flag is NOT in clientOverridable', async () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const service = await buildService({
        featureFlags: { defaults: { ENABLE_CASCADE_FK_INJECTION: true }, clientOverridable: [] },
      });
      expect(service.resolveFlags({ ENABLE_CASCADE_FK_INJECTION: false })).toEqual({
        ENABLE_CASCADE_FK_INJECTION: true,
      });
    });

    it('ignores ALL per-request overrides when ENABLE_REQUEST_FEATURE_FLAGS is not "true"', async () => {
      delete process.env.ENABLE_REQUEST_FEATURE_FLAGS;
      const service = await buildService({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      expect(service.resolveFlags({ ENABLE_ALERT_GENERATION: false })).toEqual({
        ENABLE_ALERT_GENERATION: true,
      });
    });
  });

  describe('three-layer priority — request beats env beats default', () => {
    it('applies default < env < per-request in that priority order', async () => {
      process.env.FEATURE_FLAG_ENABLE_ALERT_GENERATION = 'false'; // layer 2 beats layer 1
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const service = await buildService({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true }, // layer 1
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      // no per-request override supplied -> layer 2 wins over layer 1
      expect(service.resolveFlags()).toEqual({ ENABLE_ALERT_GENERATION: false });
      // per-request override supplied -> layer 3 wins over layer 2
      expect(service.resolveFlags({ ENABLE_ALERT_GENERATION: true })).toEqual({
        ENABLE_ALERT_GENERATION: true,
      });
    });
  });
});
