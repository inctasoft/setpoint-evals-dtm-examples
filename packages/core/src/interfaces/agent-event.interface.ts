/**
 * agent-event/1 + agent-forest/1 — the canonical event and tree schema for this repo's
 * monitor/orchestrator agent-visibility subsystem: the orchestrator emits `agent_event` /
 * `agent_forest` messages describing agent lifecycle and tree state, and the monitor's
 * agent-forest store (`apps/monitor/src/state/agent-forest.store.ts`) consumes them.
 *
 * Drift discipline: setpoint-evals/SE-40-agent-forest-schema-conformance checks conformance
 * BOTH WAYS against a JSON Schema — a snapshot built from these types must validate against
 * it, and the schema's closed enums must match the unions below. Do not extend these types
 * unilaterally: update the JSON Schema first, then re-mirror here.
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
