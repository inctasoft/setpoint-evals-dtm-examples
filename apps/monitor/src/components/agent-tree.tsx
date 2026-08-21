import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useAgentForestStore } from '../state/agent-forest.store';
import type { AgentNode, NodeLifecycle } from '../state/agent-forest.store';
import { renderMermaidDiagrams } from '../lib/mermaid';

// Mermaid node ids must be identifier-safe; agent ids are arbitrary stream text, so sanitize
// defensively (same rationale as workflow-dag.tsx's step-name guard).
function nodeId(agentId: string): string {
  return `n_${agentId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

// Record<NodeLifecycle, string> — a lifecycle added to the store without a mapping here is a
// compile error, not a silently-unstyled node (same discipline as STATUS_CLASS in
// workflow-dag.tsx / capability-spec.md §3.4).
const LIFECYCLE_CLASS: Record<NodeLifecycle, string> = {
  spawned: 'nodeSpawned',
  active: 'nodeActive',
  idle: 'nodeIdle',
  done: 'nodeDone',
  error: 'nodeError',
};
const ALL_NODE_CLASSES = Array.from(
  new Set([...Object.values(LIFECYCLE_CLASS), 'nodeLost', 'nodePending']),
);

// Quoted mermaid labels: a literal `"` inside would terminate the string and break the parse —
// collapse to a single quote (agent labels are free text, unlike workflow step names).
function nodeLabel(n: AgentNode): string {
  return (n.label || n.agent_id).slice(0, 40).replace(/"/g, "'");
}

// One visual state per node. A pending-parent node renders as pending (it lives in the pending
// subgraph; the transient-orphan story outranks its raw lifecycle), and a lost node renders the
// TYPED discriminator 'lost_connection' — never a synthesized "crashed" (SPEC invariant 3).
function nodeClass(n: AgentNode): string {
  if (n.pendingParent) return 'nodePending';
  if (n.lifecycle === 'error' && n.error_reason === 'lost_connection') return 'nodeLost';
  return LIFECYCLE_CLASS[n.lifecycle];
}

// workflow-dag.tsx matches rendered nodes with a plain id substring includes(); that is safe for
// PascalCase step names but NOT for arbitrary agent ids ('a' is a prefix of 'a_b', and 'n_a'
// occurs inside 'n_x_n_a'). wantedId is [a-zA-Z0-9_] by construction, so requiring
// non-identifier boundaries on both sides makes the match collision-proof regardless of how
// mermaid mangles the surrounding id.
function idMatches(elId: string, wantedId: string): boolean {
  return new RegExp(`(^|[^a-zA-Z0-9_])${wantedId}([^a-zA-Z0-9_]|$)`).test(elId);
}

/**
 * Agent-tree renderer for ONE selected forest (Phase C of the agent-event/1 visualization).
 *
 * TWO-PHASE rendering, copied from workflow-dag.tsx: the mermaid SOURCE encodes structure ONLY
 * (nodes + parent edges + the pending subgraph) and is memoized on a structural key — dagre
 * layout runs exactly once per structural change. Live lifecycle is applied AFTER render by
 * toggling plain CSS classes on the already-rendered `<g class="node">` elements — NEVER by
 * re-generating diagram source on a status-only change (the pinned no-re-layout-jiggle
 * property). Forest selection/fallback is a view-layer concern; the store is not rewritten
 * from here.
 */
export function AgentTree() {
  const { forests, selectedRootId, actions } = useAgentForestStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeElByAgentRef = useRef<Map<string, SVGGElement>>(new Map());

  const rootIds = Object.keys(forests);
  // A selected root that has disappeared falls back to the first available forest.
  const activeRootId =
    selectedRootId && forests[selectedRootId] ? selectedRootId : (rootIds[0] ?? null);
  const region = activeRootId ? forests[activeRootId] : undefined;

  // The structural key: sorted agent_id|parent_id pairs. pendingParent needs no slot of its
  // own — it is derived (parent present in the node set or not) and the node set only grows,
  // so any pending flip accompanies a pair-key change by construction.
  const structureKey = useMemo(
    () =>
      region
        ? Object.values(region.nodes)
            .map((n) => `${n.agent_id}|${n.parent_id ?? ''}`)
            .sort()
            .join('\n')
        : null,
    [region],
  );

  // PHASE 1 — structure only. No lifecycle, no label churn in the deps: this is the
  // "layout computed ONCE" memo. A late-arriving label deliberately does NOT re-layout the
  // graph (that re-layout is exactly the jiggle this design kills).
  const diagramSource = useMemo(() => {
    if (!region) return null;
    const nodes = Object.values(region.nodes);
    if (nodes.length === 0) return null;

    const lines: string[] = ['flowchart TD'];
    for (const n of nodes) {
      if (n.pendingParent) continue;
      lines.push(`  ${nodeId(n.agent_id)}["${nodeLabel(n)}"]`);
    }
    for (const n of nodes) {
      // Forest roots (parent_id null) get no incoming edge; pending-parent nodes get NO edge
      // either (their parent has not been seen — they sit in the pending subgraph instead).
      if (n.pendingParent || n.parent_id === null) continue;
      if (!(n.parent_id in region.nodes)) continue;
      lines.push(`  ${nodeId(n.parent_id)} --> ${nodeId(n.agent_id)}`);
    }
    const pending = nodes.filter((n) => n.pendingParent);
    if (pending.length > 0) {
      lines.push('  subgraph pending["pending — parent not yet seen"]');
      for (const n of pending) {
        lines.push(`    ${nodeId(n.agent_id)}["${nodeLabel(n)}"]`);
      }
      lines.push('  end');
    }
    return lines.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey]);

  // Runs once per structural (re-)render: paint the SVG, build the reverse node map by id
  // match, then apply whatever live state is current.
  useEffect(() => {
    if (!containerRef.current || !diagramSource) return;
    let cancelled = false;
    renderMermaidDiagrams(containerRef.current).then(() => {
      if (cancelled || !containerRef.current) return;
      const map = new Map<string, SVGGElement>();
      const nodeEls = Array.from(containerRef.current.querySelectorAll<SVGGElement>('g.node'));
      for (const agentId of Object.keys(region?.nodes ?? {})) {
        const el = nodeEls.find((n) => idMatches(n.id, nodeId(agentId)));
        if (el) map.set(agentId, el);
      }
      nodeElByAgentRef.current = map;
      applyLiveState();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramSource]);

  // PHASE 2 — apply live lifecycle to the ALREADY-RENDERED nodes. Depends only on the actual
  // overlay content, so an unrelated forest-region identity change never forces a structural
  // re-render.
  const statusSignature = region
    ? Object.values(region.nodes)
        .map(
          (n) => `${n.agent_id}:${n.lifecycle}:${n.error_reason ?? ''}:${n.pendingParent ? 1 : 0}`,
        )
        .sort()
        .join('|')
    : '';

  function applyLiveState() {
    const nodes = region?.nodes ?? {};
    for (const [agentId, el] of nodeElByAgentRef.current) {
      for (const cls of ALL_NODE_CLASSES) el.classList.remove(cls);
      const node = nodes[agentId];
      if (node) el.classList.add(nodeClass(node));
    }
  }

  useEffect(() => {
    applyLiveState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusSignature]);

  if (rootIds.length === 0) {
    return (
      <div class="agent-tree">
        <div class="dag-empty">
          No agent events yet — the emitter is operator-gated; see server-config
          setpoint-evals/agent-event-schema/SPEC.md
        </div>
      </div>
    );
  }

  const nodeCount = region ? Object.keys(region.nodes).length : 0;

  return (
    <div class="agent-tree">
      <div class="agent-tree-header">
        <select
          class="agent-tree-select"
          value={activeRootId ?? ''}
          onChange={(e) => actions.selectRoot(e.currentTarget.value || null)}
        >
          {rootIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <span class="agent-tree-legend">
          <span class="agent-legend-item agent-legend-spawned">spawned</span>
          <span class="agent-legend-item agent-legend-active">active</span>
          <span class="agent-legend-item agent-legend-idle">idle</span>
          <span class="agent-legend-item agent-legend-done">done</span>
          <span class="agent-legend-item agent-legend-error">error</span>
          <span class="agent-legend-item agent-legend-lost">lost</span>
          <span class="agent-legend-item agent-legend-pending">pending</span>
        </span>
      </div>
      {diagramSource ? (
        <div class="agent-tree-canvas" ref={containerRef}>
          {/* key=diagramSource forces a fresh DOM node only on a STRUCTURAL change — see the
              two-phase comment in workflow-dag.tsx for why reusing the <pre> across a live
              status change is the point (no jiggle, no dagre re-layout). */}
          <pre class="mermaid" key={diagramSource}>
            {diagramSource}
          </pre>
        </div>
      ) : (
        <div class="dag-empty">No agents in this forest yet.</div>
      )}
      <div class="agent-tree-footer">
        snapshot: {region?.lastSnapshotTs ?? '—'} · {nodeCount} agents
      </div>
    </div>
  );
}
