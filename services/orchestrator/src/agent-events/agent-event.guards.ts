import type { AgentErrorReason, AgentEvent, AgentLifecycle } from '@dtm/core';

/**
 * Runtime guards for the agent-event/1 ingest plane.
 *
 * FAIL-CLOSED ON STRUCTURE, fail-open on taxonomy (SPEC invariant 4 — canonical
 * source: server-config setpoint-evals/agent-event-schema/agent-event-1.schema.json):
 * an unknown provider/kind string still validates and still renders; a malformed
 * lifecycle / missing root_id / bad event_id / unknown top-level key is rejected.
 */

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** CLOSED FSM alphabet — the load-bearing structure fails closed. */
const LIFECYCLES: readonly AgentLifecycle[] = ['spawn', 'active', 'idle', 'done', 'error'];

/** Typed error discriminator — required iff lifecycle==='error', forbidden otherwise. */
const ERROR_REASONS: readonly AgentErrorReason[] = [
  'crashed',
  'timeout',
  'tool_denied',
  'cancelled',
  'lost_connection',
];

/** additionalProperties:false — the closed top-level key set. */
const ALLOWED_KEYS = new Set([
  'schema',
  'event_id',
  'ts',
  'provider',
  'kind',
  'lifecycle',
  'agent_id',
  'parent_id',
  'root_id',
  'label',
  'error_reason',
  'attrs',
]);

export type ValidateAgentEventResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate one raw record against the agent-event/1 structural contract.
 * Returns the normalized event (absent parent_id → null) on success.
 */
export function validateAgentEvent(raw: unknown): ValidateAgentEventResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'record must be a JSON object' };
  }
  const rec = raw as Record<string, unknown>;

  for (const key of Object.keys(rec)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `unknown top-level key '${key}' (additionalProperties: false)` };
    }
  }

  if (rec.schema !== 'agent-event/1') {
    return {
      ok: false,
      error: `schema must be "agent-event/1", got ${JSON.stringify(rec.schema)}`,
    };
  }
  if (typeof rec.event_id !== 'string' || !ULID_PATTERN.test(rec.event_id)) {
    return {
      ok: false,
      error: `event_id must be a 26-char Crockford-base32 ULID, got ${JSON.stringify(rec.event_id)}`,
    };
  }
  if (typeof rec.ts !== 'string') {
    return { ok: false, error: 'ts must be an RFC3339 string' };
  }
  for (const field of ['provider', 'kind', 'agent_id', 'root_id'] as const) {
    if (!isNonEmptyString(rec[field])) {
      return { ok: false, error: `${field} must be a non-empty string` };
    }
  }
  if (typeof rec.lifecycle !== 'string' || !LIFECYCLES.includes(rec.lifecycle as AgentLifecycle)) {
    return {
      ok: false,
      error: `lifecycle must be one of ${LIFECYCLES.join('|')}, got ${JSON.stringify(rec.lifecycle)}`,
    };
  }
  const lifecycle = rec.lifecycle as AgentLifecycle;

  if (rec.parent_id !== undefined && rec.parent_id !== null && typeof rec.parent_id !== 'string') {
    return { ok: false, error: 'parent_id must be a string or null' };
  }
  if (rec.label !== undefined && typeof rec.label !== 'string') {
    return { ok: false, error: 'label must be a string' };
  }
  if (
    rec.attrs !== undefined &&
    (rec.attrs === null || typeof rec.attrs !== 'object' || Array.isArray(rec.attrs))
  ) {
    return { ok: false, error: 'attrs must be an object' };
  }

  // TYPED ERRORS ONLY (SPEC invariant 3): error_reason required iff lifecycle==='error'.
  if (lifecycle === 'error') {
    if (
      typeof rec.error_reason !== 'string' ||
      !ERROR_REASONS.includes(rec.error_reason as AgentErrorReason)
    ) {
      return {
        ok: false,
        error: `error_reason is required when lifecycle is 'error' and must be one of ${ERROR_REASONS.join('|')}, got ${JSON.stringify(rec.error_reason)}`,
      };
    }
  } else if (rec.error_reason !== undefined) {
    return {
      ok: false,
      error: `error_reason is forbidden unless lifecycle is 'error' (got lifecycle '${lifecycle}')`,
    };
  }

  const event: AgentEvent = {
    schema: 'agent-event/1',
    event_id: rec.event_id as string,
    ts: rec.ts as string,
    provider: rec.provider as string,
    kind: rec.kind as string,
    lifecycle,
    agent_id: rec.agent_id as string,
    parent_id: (rec.parent_id as string | null | undefined) ?? null,
    root_id: rec.root_id as string,
  };
  if (rec.label !== undefined) event.label = rec.label as string;
  if (lifecycle === 'error') event.error_reason = rec.error_reason as AgentErrorReason;
  if (rec.attrs !== undefined) event.attrs = rec.attrs as Record<string, unknown>;

  return { ok: true, event };
}
