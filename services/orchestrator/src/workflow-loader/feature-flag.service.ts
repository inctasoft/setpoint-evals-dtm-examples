/**
 * FeatureFlagService
 *
 * Three-layer resolution for feature flags:
 *   1. Workflow config defaults (from WorkflowDefinition.featureFlags.defaults)
 *   2. Environment variable overrides (FEATURE_FLAG_{KEY})
 *   3. Per-request client overrides (gated by ENABLE_REQUEST_FEATURE_FLAGS + clientOverridable allowlist)
 *
 * Security model:
 *   - Layer 3 requires ENABLE_REQUEST_FEATURE_FLAGS=true (env var master switch)
 *   - Only flags listed in WorkflowDefinition.featureFlags.clientOverridable can be overridden per-request
 *   - If clientOverridable is empty or omitted, NO flags are client-overridable (locked by default)
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { WORKFLOW_DEFINITION } from './workflow-loader.constants';
import type { WorkflowDefinition } from '@dtm/core';

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(
    @Inject(WORKFLOW_DEFINITION)
    private readonly workflow: WorkflowDefinition,
  ) {}

  /**
   * Resolve feature flags using three-layer resolution.
   *
   * @param requestFlags - Optional per-request flag overrides from the client
   * @returns Fully resolved feature flags
   */
  resolveFlags(requestFlags?: Record<string, unknown>): Record<string, unknown> {
    // Layer 1: Workflow config defaults
    const resolved: Record<string, unknown> = {
      ...(this.workflow.featureFlags?.defaults ?? {}),
    };

    // Layer 2: Environment variable overrides
    for (const key of Object.keys(resolved)) {
      const envKey = `FEATURE_FLAG_${this.toScreamingSnake(key)}`;
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        resolved[key] = this.parseEnvValue(envValue);
      }
    }

    // Layer 3: Per-request client overrides (triple-gated)
    if (requestFlags && process.env.ENABLE_REQUEST_FEATURE_FLAGS === 'true') {
      const allowlist = this.workflow.featureFlags?.clientOverridable ?? [];
      for (const [key, value] of Object.entries(requestFlags)) {
        if (allowlist.includes(key)) {
          resolved[key] = value;
        } else {
          this.logger.warn(`Feature flag "${key}" is not client-overridable — ignored`);
        }
      }
    } else if (requestFlags && Object.keys(requestFlags).length > 0) {
      this.logger.debug(
        `Per-request feature flags provided but ENABLE_REQUEST_FEATURE_FLAGS is not enabled — ignored`,
      );
    }

    return resolved;
  }

  /**
   * Get a single resolved flag value.
   *
   * @param key - The flag name
   * @param requestFlags - Optional per-request flag overrides
   * @returns The resolved value, or undefined if not defined
   */
  getFlag(key: string, requestFlags?: Record<string, unknown>): unknown {
    return this.resolveFlags(requestFlags)[key];
  }

  /**
   * Get a boolean flag with a default value.
   */
  getBooleanFlag(
    key: string,
    defaultValue: boolean,
    requestFlags?: Record<string, unknown>,
  ): boolean {
    const value = this.getFlag(key, requestFlags);
    if (typeof value === 'boolean') return value;
    return defaultValue;
  }

  /**
   * Parse environment variable values to appropriate types.
   * Handles: "true"/"false" → boolean, numeric strings → number, rest → string.
   */
  private parseEnvValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    return value;
  }

  /**
   * Convert camelCase to SCREAMING_SNAKE_CASE for env var lookup.
   * e.g., "enableDeduplication" → "ENABLE_DEDUPLICATION"
   */
  private toScreamingSnake(key: string): string {
    return key.replace(/([A-Z])/g, '_$1').toUpperCase();
  }
}
