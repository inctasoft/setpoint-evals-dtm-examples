/**
 * agent-event/1 + agent-forest/1 — TS MIRROR of the canonical schema.
 *
 * CANONICAL SOURCE: server-config `setpoint-evals/agent-event-schema/`
 *   (agent-event-1.schema.json + agent-forest-1.schema.json + SPEC.md, shipped sc#463).
 * This file is a copy-ready mirror adopted from `setpoint-evals/agent-event-schema/agent-event.ts`
 * now that the Phase-C consumer exists (plan: server-config/plans/agent-interop-and-viz-2026-07-23.md
 * §5 reconciliation 2 + §7.1). O-D4 re-verified at PR time (2026-07-30): this repo is PRIVATE —
 * the 07-23 premise-VOID resolution stands; there is no public-exposure concern.
 *
 * Drift discipline: conformance is checked BOTH WAYS by
 * setpoint-evals/SE-40-agent-forest-schema-conformance — a snapshot built from these types must
 * validate against the canonical JSON Schema, and the schema's closed enums must match the
 * unions below. Do not extend these types unilaterally: change the canonical schema first,
 * then re-mirror.
 */

/** CLOSED FSM alphabet (schema fails closed on any other value). */
export type AgentLifecycle = "spawn" | "active" | "idle" | "done" | "error";

/** Typed error discriminator — REQUIRED iff lifecycle === 'error', forbidden otherwise.
 *  A vanished node reconciles to 'lost_connection', NEVER a synthesized "crashed" sentence
 *  (SPEC invariant 3, SE-RECONCILE-NO-SYNTH). */
export type AgentErrorReason =
  | "crashed"
  | "timeout"
  | "tool_denied"
  | "cancelled"
  | "lost_connection";

/** Documentation-only unions — the schema is OPEN on provider/kind (fail-open on taxonomy):
 *  unknown values must still validate and still render. The `(string & {})` widening preserves
 *  autocomplete without closing the union. */
export type KnownProvider = "claude" | "kimi" | "gemini" | "local" | "dtm";
export type KnownKind = "subagent" | "teammate" | "workflow" | "local";

export interface AgentEvent {
  schema: "agent-event/1";
  /** ULID (Crockford base32, 26 chars) — lexicographically sortable; authoritative for ordering. */
  event_id: string;
  /** RFC3339 UTC — advisory only. */
  ts: string;
  provider: KnownProvider | (string & {});
  kind: KnownKind | (string & {});
  lifecycle: AgentLifecycle;
  agent_id: string;
  /** Spawning agent's agent_id, or null for a forest root. */
  parent_id: string | null;
  /** Forest key = originating session_id. */
  root_id: string;
  /** Human label — never structural. */
  label?: string;
  error_reason?: AgentErrorReason;
  /** Free-form provider/transport metadata. Renderers may read; the FSM must never depend on it. */
  attrs?: Record<string, unknown>;
}

export interface AgentForestNode {
  agent_id: string;
  parent_id: string | null;
  provider: string;
  kind: string;
  label?: string;
  lifecycle: AgentLifecycle;
  error_reason?: AgentErrorReason;
  first_ts?: string;
  last_ts?: string;
  event_count?: number;
}

/** Server-authoritative snapshot: a fresh snapshot SUPERSEDES prior partial state
 *  (reconciliation — the renderer never merges heuristics over it). */
export interface AgentForest {
  schema: "agent-forest/1";
  ts: string;
  root_id: string;
  roots: string[];
  nodes: AgentForestNode[];
}
