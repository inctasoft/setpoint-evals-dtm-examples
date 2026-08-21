/**
 * agent-forest.store.ts — the agent-tree FSM store for the monitor's agent-visibility view.
 *
 * This is the monitor's canonical store for agent-tree state, living alongside the app's
 * other state in `src/state/`. The workflow-step DAG stays a distinct renderer with its own
 * state plane — it is a separate concern, not retro-refactored into this store.
 *
 * Node-level FSM: an agent node is 'spawned' | 'active' | 'idle' | 'done' | 'error'.
 * `TRANSITIONS` is an explicit, exported data table (count-drift against it enforced by
 * SE-38): every transition has exactly one sim scenario. Components render this state, they
 * never own it — state changes flow only through named store actions, never ad hoc DOM
 * events; server-authoritative reconciliation via reconcileForest
 * (element 3 — a fresh agent-forest/1 snapshot SUPERSEDES local state; a locally-known node
 * the server no longer reports transitions to 'error' with the TYPED discriminator
 * error_reason 'lost_connection' — NEVER a synthesized "crashed" string, SPEC invariant 3).
 *
 * Origin-keyed: state is keyed by root_id (the forest = the subsystem identity), not by
 * the active view. persist: plain Records (no Map) so the default JSON serializer suffices —
 * the "Map-aware serializer" caveat does not apply BY CONSTRUCTION; do not introduce a Map
 * here without adding that serializer.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AgentEvent, AgentForest, AgentErrorReason, AgentLifecycle } from '@dtm/core';

export type NodeLifecycle = 'spawned' | 'active' | 'idle' | 'done' | 'error';

export type Trigger =
  | 'AGENT_ACTIVE'
  | 'AGENT_IDLE'
  | 'AGENT_DONE'
  | 'AGENT_ERROR'
  | 'RECONCILE_LOST';

export interface AgentNode {
  agent_id: string;
  parent_id: string | null;
  provider: string;
  kind: string;
  label: string;
  lifecycle: NodeLifecycle;
  /** Typed discriminator — set iff lifecycle === 'error'. Never a synthesized sentence. */
  error_reason?: AgentErrorReason;
  /** Transient-orphan absorption (SPEC invariant 1): parent_id references an agent the stream
   *  has not produced YET. Rendered in a pending bucket, never as a root; cleared when the
   *  parent arrives (ingestEvent) or on the authoritative snapshot (reconcileForest). */
  pendingParent: boolean;
  first_ts: string;
  last_ts: string;
  event_count: number;
}

export interface RootRegion {
  nodes: Record<string, AgentNode>;
  lastSnapshotTs: string | null;
}

/** R-A1 — the transition matrix as data. SE-38 grep-counts these rows against the
 *  sim scenario files; divergence is a build failure. */
export const TRANSITIONS: Array<{
  from: NodeLifecycle;
  to: NodeLifecycle;
  trigger: Trigger;
}> = [
  { from: 'spawned', to: 'active', trigger: 'AGENT_ACTIVE' },
  { from: 'idle', to: 'active', trigger: 'AGENT_ACTIVE' },
  { from: 'active', to: 'idle', trigger: 'AGENT_IDLE' },
  { from: 'spawned', to: 'done', trigger: 'AGENT_DONE' },
  { from: 'active', to: 'done', trigger: 'AGENT_DONE' },
  { from: 'idle', to: 'done', trigger: 'AGENT_DONE' },
  { from: 'spawned', to: 'error', trigger: 'AGENT_ERROR' },
  { from: 'active', to: 'error', trigger: 'AGENT_ERROR' },
  { from: 'idle', to: 'error', trigger: 'AGENT_ERROR' },
  { from: 'spawned', to: 'error', trigger: 'RECONCILE_LOST' },
  { from: 'active', to: 'error', trigger: 'RECONCILE_LOST' },
  { from: 'idle', to: 'error', trigger: 'RECONCILE_LOST' },
];

const TERMINAL: ReadonlySet<NodeLifecycle> = new Set(['done', 'error']);

/** The FSM guard: a lifecycle move is applied iff a TRANSITIONS row licenses it. */
export function canTransition(from: NodeLifecycle, trigger: Trigger): boolean {
  return TRANSITIONS.some((t) => t.from === from && t.trigger === trigger);
}

/** schema lifecycle -> store node state (identity over the five-value alphabet minus spawn). */
function toNodeLifecycle(l: AgentLifecycle): NodeLifecycle {
  return l === 'spawn' ? 'spawned' : l;
}

/** schema lifecycle event -> FSM trigger (null: 'spawn' of an already-known node moves nothing). */
function toTrigger(l: AgentLifecycle): Trigger | null {
  switch (l) {
    case 'active':
      return 'AGENT_ACTIVE';
    case 'idle':
      return 'AGENT_IDLE';
    case 'done':
      return 'AGENT_DONE';
    case 'error':
      return 'AGENT_ERROR';
    case 'spawn':
      return null;
    default:
      return null;
  }
}

export interface AgentForestState {
  forests: Record<string, RootRegion>;
  selectedRootId: string | null;
  actions: {
    ingestEvent: (ev: AgentEvent) => void;
    reconcileForest: (forest: AgentForest) => void;
    selectRoot: (rootId: string | null) => void;
  };
}

function upsertNode(region: RootRegion, ev: AgentEvent): RootRegion {
  const nodes = { ...region.nodes };
  const existing = nodes[ev.agent_id];
  const parentKnown = ev.parent_id !== null && ev.parent_id in nodes;

  if (!existing) {
    // Materialize (a node may first appear at ANY lifecycle — a teammate root arrives via `done`).
    nodes[ev.agent_id] = {
      agent_id: ev.agent_id,
      parent_id: ev.parent_id,
      provider: ev.provider,
      kind: ev.kind,
      label: ev.label ?? '',
      lifecycle: toNodeLifecycle(ev.lifecycle),
      error_reason: ev.lifecycle === 'error' ? ev.error_reason : undefined,
      pendingParent: ev.parent_id !== null && !parentKnown,
      first_ts: ev.ts,
      last_ts: ev.ts,
      event_count: 1,
    };
  } else {
    const trigger = toTrigger(ev.lifecycle);
    const next: AgentNode = {
      ...existing,
      // parent_id = first non-null ever seen (reconstruct.py merge rule).
      parent_id: existing.parent_id ?? ev.parent_id,
      label: ev.label || existing.label,
      last_ts: ev.ts > existing.last_ts ? ev.ts : existing.last_ts,
      first_ts: ev.ts < existing.first_ts ? ev.ts : existing.first_ts,
      event_count: existing.event_count + 1,
    };
    if (trigger !== null && canTransition(existing.lifecycle, trigger)) {
      next.lifecycle = toNodeLifecycle(ev.lifecycle);
      if (trigger === 'AGENT_ERROR') next.error_reason = ev.error_reason; // schema: required iff error
    }
    // error_reason is sticky once set (reconstruct.py merge rule): an old reason survives
    // non-error updates; only AGENT_ERROR above rewrites it.
    next.pendingParent = next.parent_id !== null && !(next.parent_id in nodes);
    nodes[ev.agent_id] = next;
  }

  // A node's arrival may resolve pending children (the parent edge landing after the child).
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (n.pendingParent && n.parent_id !== null && n.parent_id in nodes) {
      nodes[id] = { ...n, pendingParent: false };
    }
  }
  return { ...region, nodes };
}

export const useAgentForestStore = create<AgentForestState>()(
  persist(
    (set) => ({
      forests: {},
      selectedRootId: null,
      actions: {
        ingestEvent: (ev) =>
          set((s) => ({
            forests: {
              ...s.forests,
              [ev.root_id]: upsertNode(
                s.forests[ev.root_id] ?? { nodes: {}, lastSnapshotTs: null },
                ev,
              ),
            },
          })),

        reconcileForest: (forest) =>
          set((s) => {
            const prior = s.forests[forest.root_id] ?? {
              nodes: {},
              lastSnapshotTs: null,
            };
            const nodes: Record<string, AgentNode> = {};
            const snapshotIds = new Set(forest.nodes.map((n) => n.agent_id));

            // 1) The server is authoritative: snapshot nodes REPLACE local state wholesale.
            for (const n of forest.nodes) {
              nodes[n.agent_id] = {
                agent_id: n.agent_id,
                parent_id: n.parent_id,
                provider: n.provider,
                kind: n.kind,
                label: n.label ?? prior.nodes[n.agent_id]?.label ?? '',
                lifecycle: toNodeLifecycle(n.lifecycle),
                error_reason: n.lifecycle === 'error' ? n.error_reason : undefined,
                pendingParent: false, // recomputed below
                first_ts: n.first_ts ?? prior.nodes[n.agent_id]?.first_ts ?? forest.ts,
                last_ts: n.last_ts ?? prior.nodes[n.agent_id]?.last_ts ?? forest.ts,
                event_count: n.event_count ?? prior.nodes[n.agent_id]?.event_count ?? 1,
              };
            }

            // 2) A locally-known node the server no longer reports: RECONCILE_LOST — the TYPED
            //    discriminator 'lost_connection', never a synthesized "crashed" (SPEC inv. 3).
            for (const local of Object.values(prior.nodes)) {
              if (snapshotIds.has(local.agent_id)) continue;
              if (TERMINAL.has(local.lifecycle)) {
                nodes[local.agent_id] = local; // terminal history is kept, never rewritten
                continue;
              }
              if (canTransition(local.lifecycle, 'RECONCILE_LOST')) {
                nodes[local.agent_id] = {
                  ...local,
                  lifecycle: 'error',
                  error_reason: 'lost_connection',
                  pendingParent: false,
                };
              }
            }

            // 3) Pending flags from the authoritative picture only.
            for (const id of Object.keys(nodes)) {
              const n = nodes[id];
              nodes[id] = {
                ...n,
                pendingParent: n.parent_id !== null && !(n.parent_id in nodes),
              };
            }

            return {
              forests: {
                ...s.forests,
                [forest.root_id]: { nodes, lastSnapshotTs: forest.ts },
              },
            };
          }),

        selectRoot: (rootId) => set({ selectedRootId: rootId }),
      },
    }),
    {
      name: 'dtm-agent-forest',
      partialize: (s) =>
        ({
          forests: s.forests,
          selectedRootId: s.selectedRootId,
        }) as AgentForestState,
    },
  ),
);
