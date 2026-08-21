import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { AgentEvent, AgentForest, AgentForestNode } from '@dtm/core';
import { EventsGateway } from '../websocket/events.gateway';

const FOREST_RESYNC_INTERVAL_MS = 30000;

/**
 * AgentForestService — the server half of the agent-event/1 ingest plane
 * (Phase C; canonical schema in server-config setpoint-evals/agent-event-schema/).
 *
 * Merges validated lifecycle events into an in-memory per-root forest and
 * re-broadcasts on the WS relay: every accepted event as-is (`agent_event`)
 * plus the server-authoritative `agent_forest` snapshot for every touched root.
 *
 * Merge rules mirror reconstruct.py build()/snapshot() EXACTLY:
 *   - events sorted by (event_id, ts) — ULID mint order authoritative, ts advisory;
 *   - parent_id = first NON-null ever seen (spawn carries it; done may omit it);
 *   - lifecycle = last-writer;
 *   - error_reason sticky once set (a later non-error event never clears it);
 *   - provider change for a known agent_id = PROVIDER-DRIFT: warn + SKIP the
 *     event, never crash, never merge it, never count it.
 *
 * The 30s resync re-broadcasts every forest so reconnected clients reconcile
 * against server state — a fresh snapshot SUPERSEDES prior partial state.
 */
@Injectable()
export class AgentForestService {
  private readonly logger = new Logger(AgentForestService.name);

  /** root_id -> agent_id -> merged node. Forests never cross-contaminate. */
  private readonly forests = new Map<string, Map<string, AgentForestNode>>();

  constructor(private readonly eventsGateway: EventsGateway) {}

  /**
   * Merge a validated batch and broadcast the results. Events already passed
   * the structural guards at the controller boundary.
   */
  ingest(events: AgentEvent[]): void {
    if (events.length === 0) return;

    // Every invariant is scoped per root_id, so merge per forest.
    const byRoot = new Map<string, AgentEvent[]>();
    for (const event of events) {
      const group = byRoot.get(event.root_id);
      if (group) group.push(event);
      else byRoot.set(event.root_id, [event]);
    }

    const accepted: AgentEvent[] = [];
    const touchedRoots: string[] = [];

    for (const [rootId, group] of byRoot) {
      group.sort((a, b) =>
        a.event_id === b.event_id
          ? a.ts < b.ts
            ? -1
            : a.ts > b.ts
              ? 1
              : 0
          : a.event_id < b.event_id
            ? -1
            : 1,
      );
      let nodes = this.forests.get(rootId);
      if (!nodes) {
        nodes = new Map<string, AgentForestNode>();
        this.forests.set(rootId, nodes);
      }
      let touched = false;
      for (const event of group) {
        if (this.merge(nodes, event)) {
          accepted.push(event);
          touched = true;
        }
      }
      if (touched) touchedRoots.push(rootId);
    }

    for (const event of accepted) {
      this.eventsGateway.broadcast({
        type: 'agent_event',
        event,
        timestamp: new Date().toISOString(),
      });
    }
    for (const rootId of touchedRoots) {
      const forest = this.snapshot(rootId);
      if (forest) {
        this.eventsGateway.broadcast({
          type: 'agent_forest',
          forest,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.logger.debug(
      `Ingested ${accepted.length} agent event(s) across ${touchedRoots.length} forest(s)`,
    );
  }

  /**
   * Build the agent-forest/1 snapshot for one root (reconstruct.py snapshot()):
   * roots = nodes with parent_id === null (sorted); every node carries
   * first_ts/last_ts/event_count (event_count >= 1 by construction).
   */
  snapshot(rootId: string): AgentForest | undefined {
    const nodes = this.forests.get(rootId);
    if (!nodes || nodes.size === 0) return undefined;

    const all = [...nodes.values()];
    return {
      schema: 'agent-forest/1',
      ts: new Date().toISOString(),
      root_id: rootId,
      roots: all
        .filter((n) => n.parent_id === null)
        .map((n) => n.agent_id)
        .sort(),
      nodes: all.map((n) => ({ ...n })),
    };
  }

  /**
   * Server-authoritative resync point: re-broadcast every root's snapshot so
   * reconnected clients drop heuristic partial state and re-render from the
   * server's forest (the pattern's reconcile trigger).
   */
  @Interval(FOREST_RESYNC_INTERVAL_MS)
  resyncForests(): void {
    if (this.forests.size === 0) return;

    for (const rootId of this.forests.keys()) {
      const forest = this.snapshot(rootId);
      if (!forest) continue;
      this.eventsGateway.broadcast({
        type: 'agent_forest',
        forest,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Merge one event into a forest. Returns false when the event was SKIPPED
   * (PROVIDER-DRIFT — the only structural conflict a single event can cause).
   */
  private merge(nodes: Map<string, AgentForestNode>, event: AgentEvent): boolean {
    const existing = nodes.get(event.agent_id);

    // PROVIDER-STABLE (structural): a provider change for a known agent_id is
    // PROVIDER-DRIFT — log warn + SKIP, never crash, never merge.
    if (existing && existing.provider && existing.provider !== event.provider) {
      this.logger.warn(
        `PROVIDER-DRIFT root=${event.root_id} agent=${event.agent_id} ` +
          `provider changed '${existing.provider}'->'${event.provider}' — event ${event.event_id} skipped`,
      );
      return false;
    }

    const node: AgentForestNode = existing ?? {
      agent_id: event.agent_id,
      parent_id: event.parent_id ?? null,
      provider: event.provider,
      kind: event.kind,
      label: event.label,
      lifecycle: event.lifecycle,
      error_reason: event.error_reason,
      first_ts: event.ts,
      last_ts: event.ts,
      event_count: 0,
    };
    if (!existing) nodes.set(event.agent_id, node);

    // parent_id: first NON-null ever seen (spawn carries it; done may omit it).
    if (node.parent_id === null && event.parent_id != null) {
      node.parent_id = event.parent_id;
    }
    // lifecycle: last-writer (events already in mint order).
    node.lifecycle = event.lifecycle;
    // error_reason: sticky once set — a later non-error event never clears it.
    if (event.error_reason != null) {
      node.error_reason = event.error_reason;
    }
    if (!node.label && event.label) {
      node.label = event.label;
    }
    node.last_ts = event.ts;
    node.event_count = (node.event_count ?? 0) + 1;
    return true;
  }
}
