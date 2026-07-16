import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagService } from './feature-flag.service';
import type { WorkflowDefinition } from '@dtm/core';

describe('FeatureFlagService', () => {
  const ORIGINAL_ENV = { ...process.env };
  let service: FeatureFlagService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FeatureFlagService],
    }).compile();
    service = module.get(FeatureFlagService);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function workflow(partial: Partial<WorkflowDefinition>): WorkflowDefinition {
    return partial as WorkflowDefinition;
  }

  describe('Layer 2 — env var override — SCREAMING_SNAKE_CASE keys (regression)', () => {
    // Regression for the toScreamingSnake bug found via setpoint-evals/workflows/
    // iot-sensor-pipeline/setpoint-evals/SE-07-feature-flag-layering: ALL three
    // shipped workflows' featureFlags.defaults keys are ALREADY SCREAMING_SNAKE_CASE
    // (e.g. "ENABLE_ALERT_GENERATION"), and the old regex inserted "_" before every
    // already-uppercase letter, mangling the env var name so
    // FEATURE_FLAG_ENABLE_ALERT_GENERATION never matched — Layer 2 was a silent
    // no-op for every shipped workflow.
    it('honors FEATURE_FLAG_<KEY> for an already-SCREAMING_SNAKE_CASE default key', () => {
      process.env.FEATURE_FLAG_ENABLE_ALERT_GENERATION = 'false';
      const wf = workflow({
        featureFlags: { defaults: { ENABLE_ALERT_GENERATION: true }, clientOverridable: [] },
      });
      expect(service.resolveFlags(wf)).toEqual({ ENABLE_ALERT_GENERATION: false });
    });

    it('still honors FEATURE_FLAG_<KEY> for a camelCase default key (pre-existing behavior)', () => {
      process.env.FEATURE_FLAG_ENABLE_DEDUPLICATION = 'true';
      const wf = workflow({
        featureFlags: { defaults: { enableDeduplication: false }, clientOverridable: [] },
      });
      expect(service.resolveFlags(wf)).toEqual({ enableDeduplication: true });
    });

    it('falls back to the workflow default when no env var is set', () => {
      const wf = workflow({
        featureFlags: { defaults: { ENABLE_AGGREGATION: true }, clientOverridable: [] },
      });
      expect(service.resolveFlags(wf)).toEqual({ ENABLE_AGGREGATION: true });
    });
  });

  describe('Layer precedence — default < env < per-request', () => {
    it('per-request beats env var beats default, in strict priority order', () => {
      process.env.FEATURE_FLAG_ENABLE_ALERT_GENERATION = 'false';
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      // Layer 1 alone: default wins
      expect(service.resolveFlags(wf)).toEqual({ ENABLE_ALERT_GENERATION: false }); // Layer 2 overrides Layer 1
      // Layer 3 overrides Layer 2
      expect(service.resolveFlags(wf, { ENABLE_ALERT_GENERATION: true })).toEqual({
        ENABLE_ALERT_GENERATION: true,
      });
    });
  });

  describe('Layer 3 — per-request override — clientOverridable allowlist', () => {
    it('applies a per-request override when the flag is client-overridable and the gate is enabled', () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      expect(service.resolveFlags(wf, { ENABLE_ALERT_GENERATION: false })).toEqual({
        ENABLE_ALERT_GENERATION: false,
      });
    });

    it('IGNORES a non-allowlisted per-request flag even when the gate is enabled', () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_CASCADE_FK_INJECTION: true, ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'], // ENABLE_CASCADE_FK_INJECTION NOT listed
        },
      });
      const resolved = service.resolveFlags(wf, { ENABLE_CASCADE_FK_INJECTION: false });
      expect(resolved.ENABLE_CASCADE_FK_INJECTION).toBe(true); // stays at default — override rejected
    });

    it('treats an empty/omitted clientOverridable allowlist as "locked" — nothing is overridable', () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const wf = workflow({
        featureFlags: { defaults: { ENABLE_ALERT_GENERATION: true } }, // clientOverridable omitted
      });
      const resolved = service.resolveFlags(wf, { ENABLE_ALERT_GENERATION: false });
      expect(resolved.ENABLE_ALERT_GENERATION).toBe(true);
    });

    it('ignores ALL per-request flags when ENABLE_REQUEST_FEATURE_FLAGS is not "true"', () => {
      delete process.env.ENABLE_REQUEST_FEATURE_FLAGS;
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      const resolved = service.resolveFlags(wf, { ENABLE_ALERT_GENERATION: false });
      expect(resolved.ENABLE_ALERT_GENERATION).toBe(true); // gate closed — override never applied
    });

    it('ignores ALL per-request flags when ENABLE_REQUEST_FEATURE_FLAGS=false explicitly', () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'false';
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      const resolved = service.resolveFlags(wf, { ENABLE_ALERT_GENERATION: false });
      expect(resolved.ENABLE_ALERT_GENERATION).toBe(true);
    });
  });

  describe('getFlag / getBooleanFlag (per-workflow, stateless)', () => {
    it('getFlag resolves a single key through the same 3-layer logic', () => {
      process.env.ENABLE_REQUEST_FEATURE_FLAGS = 'true';
      const wf = workflow({
        featureFlags: {
          defaults: { ENABLE_ALERT_GENERATION: true },
          clientOverridable: ['ENABLE_ALERT_GENERATION'],
        },
      });
      expect(
        service.getFlag(wf, 'ENABLE_ALERT_GENERATION', { ENABLE_ALERT_GENERATION: false }),
      ).toBe(false);
    });

    it('getBooleanFlag falls back to the given default when the key is undefined', () => {
      const wf = workflow({ featureFlags: { defaults: {} } });
      expect(service.getBooleanFlag(wf, 'NOT_DEFINED', true)).toBe(true);
      expect(service.getBooleanFlag(wf, 'NOT_DEFINED', false)).toBe(false);
    });

    it('resolves independently per workflow — no cross-workflow state leakage', () => {
      const wfA = workflow({ featureFlags: { defaults: { ENABLE_ALERT_GENERATION: true } } });
      const wfB = workflow({ featureFlags: { defaults: { ENABLE_ALERT_GENERATION: false } } });
      expect(service.resolveFlags(wfA)).toEqual({ ENABLE_ALERT_GENERATION: true });
      expect(service.resolveFlags(wfB)).toEqual({ ENABLE_ALERT_GENERATION: false });
    });
  });
});
