import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useWorkflowDetail } from '../hooks/use-workflow-detail';
import { useFanOutBadges } from '../hooks/use-fanout-badges';
import { renderMermaidDiagrams } from '../lib/mermaid';
import type { JobState, StepStatus } from '../types/events';

interface WorkflowDagProps {
  workflowName: string;
  /** When set (and its .workflow matches workflowName) overlays this job's live step statuses. */
  selectedJob: JobState | null;
  /** 'strip' (default) = the ~250px dashboard mini-viz, non-interactive nodes. 'full' = the
   *  full-screen overlay (ux-storyboards.md §3.1): larger font, useMaxWidth:false, node clicks
   *  wired to onNodeSelect. */
  size?: 'strip' | 'full';
  /** size='full' only — click delegation calls back with the step name (§3.2). */
  onNodeSelect?: (step: string) => void;
  /** size='full' only — the currently drilled-into node gets a halo class. */
  selectedStep?: string | null;
  /** Reverse console->DAG coupling (§3.3): a {step,nonce} bump pulses that node once. `nonce`
   *  (not just `step`) is what re-triggers the effect — clicking the SAME log row twice must
   *  flash twice, and a plain string dep wouldn't change on the second click. */
  flashToken?: { step: string; nonce: number } | null;
}

// mermaid node ids must be identifier-safe; step names are already PascalCase/no-spaces in
// practice, but sanitize defensively so a future step name with punctuation can't break the
// generated flowchart source.
function nodeId(step: string): string {
  return `s_${step.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

// Record<StepStatus, string> — a status added to @dtm/core without a mapping here is a compile
// error, not a silently-unstyled DAG node (capability-spec.md §3.4 "collapse the three drifting
// predicates ... derive STATUS_CLASS keys from the shared status type").
const STATUS_CLASS: Record<StepStatus, string> = {
  completed: 'dagDone',
  failed: 'dagFailed',
  in_progress: 'dagActive',
  in_progress_retrying: 'dagActive',
  waiting_for_ack: 'dagActive',
  waiting_for_children: 'dagActive',
  delegated: 'dagActive',
  pending: 'dagPending',
  skipped: 'dagSkipped',
  partial_success: 'dagPartial',
};
const ALL_DAG_CLASSES = Array.from(new Set(Object.values(STATUS_CLASS)));

/**
 * Per-workflow step DAG — nodes from stepsByVariant[variant], edges from each step's
 * `dependencies` (SE-23's pinned contract).
 *
 * TWO-PHASE rendering (dtm-video-v2 capability-spec.md §4.2 / ux-storyboards.md §4 item 2):
 * the mermaid SOURCE encodes structure ONLY (nodes + edges, no status) and is memoized per
 * workflow+variant+size — dagre layout runs exactly once. Live status is applied AFTER render
 * by toggling plain CSS classes on the already-rendered `<g class="node">` elements (found via
 * substring match on mermaid's mangled ids, `g.node[id*="s_X"]` — capability-spec.md §3.2) and
 * patching a badge `<text>` per node — never by re-generating diagram source and remounting the
 * `<pre>`. This is what kills the v1 re-layout jiggle on every WS event and is what makes
 * full-screen pan/zoom survive a live status update (the pan/zoom wrapper sits OUTSIDE this
 * component; nothing here remounts on a status-only change).
 */
export function WorkflowDag({ workflowName, selectedJob, size = 'strip', onNodeSelect, selectedStep, flashToken }: WorkflowDagProps) {
  const { detail, loading, error } = useWorkflowDetail(workflowName);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeElByStepRef = useRef<Map<string, SVGGElement>>(new Map());

  const variant =
    selectedJob && selectedJob.workflow === workflowName && detail?.stepsByVariant[selectedJob.variant]
      ? selectedJob.variant
      : detail?.defaultVariant;

  const steps = variant && detail ? detail.stepsByVariant[variant] : undefined;

  const overlayJob = selectedJob && selectedJob.workflow === workflowName ? selectedJob : null;
  const fanOutBadges = useFanOutBadges(overlayJob?.id ?? null, overlayJob?.steps ?? []);

  // PHASE 1 — structure only. No status, no selection, no badge data in the deps: this is the
  // "layout computed ONCE" memo. size is included because it changes the diagram's own
  // frontmatter config (useMaxWidth/fontSize), which is part of the source text mermaid parses.
  const diagramSource = useMemo(() => {
    if (!steps || steps.length === 0) return null;

    const lines: string[] = [];
    if (size === 'full') {
      // Per-diagram config via YAML frontmatter — mermaid.initialize() is once-only (lib/mermaid.ts),
      // so a size-specific render config has to travel in the source itself (capability-spec.md
      // §3.1 risk note), not through a second global init call.
      lines.push('---');
      lines.push('config:');
      lines.push('  flowchart:');
      lines.push('    useMaxWidth: false');
      lines.push('themeVariables:');
      lines.push('  fontSize: 18px');
      lines.push('---');
    }
    lines.push('flowchart TD');
    for (const step of steps) {
      lines.push(`  ${nodeId(step.step)}["${step.step}"]`);
    }
    for (const step of steps) {
      for (const dep of step.dependencies) {
        lines.push(`  ${nodeId(dep)} --> ${nodeId(step.step)}`);
      }
    }
    return lines.join('\n');
  }, [steps, size]);

  // Runs once per structural (re-)render: paint the SVG, build the reverse node map, mark each
  // node with data-step for O(1) click delegation, then apply whatever status is current.
  useEffect(() => {
    if (!containerRef.current || !diagramSource) return;
    let cancelled = false;
    renderMermaidDiagrams(containerRef.current).then(() => {
      if (cancelled || !containerRef.current) return;
      const map = new Map<string, SVGGElement>();
      const nodeEls = Array.from(containerRef.current.querySelectorAll<SVGGElement>('g.node'));
      for (const step of steps ?? []) {
        const wantedId = nodeId(step.step);
        const el = nodeEls.find((n) => n.id.includes(wantedId));
        if (el) {
          el.setAttribute('data-step', step.step);
          map.set(step.step, el);
        }
      }
      nodeElByStepRef.current = map;
      applyLiveState();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramSource]);

  // PHASE 2 — apply live status/selection/badges to the ALREADY-RENDERED nodes. Deliberately
  // does not depend on `diagramSource`/`steps` identity — only on the actual overlay content —
  // so a Map identity change elsewhere in useWebSocket's state never forces a structural re-render.
  const statusSignature = overlayJob
    ? overlayJob.steps.map((s) => `${s.step}:${s.status}:${s.childCount ?? ''}`).join('|')
    : '';
  const badgeSignature = Array.from(fanOutBadges.entries())
    .map(([step, b]) => `${step}:${b.completed}/${b.total}`)
    .join('|');

  function applyLiveState() {
    const byStep = new Map((overlayJob?.steps ?? []).map((s) => [s.step, s]));
    for (const [stepName, el] of nodeElByStepRef.current) {
      for (const cls of ALL_DAG_CLASSES) el.classList.remove(cls);
      if (overlayJob) {
        const live = byStep.get(stepName);
        el.classList.add(live ? STATUS_CLASS[live.status] : STATUS_CLASS.pending);
      }
      el.classList.toggle('dag-node-selected', selectedStep === stepName);
      el.classList.toggle('dag-node-clickable', size === 'full' && !!onNodeSelect);

      const badge = fanOutBadges.get(stepName);
      const live = byStep.get(stepName);
      const badgeText = badge ? `${badge.completed}/${badge.total}` : live?.childCount ? `×${live.childCount}` : null;
      patchBadge(el, badgeText);
    }
  }

  useEffect(() => {
    applyLiveState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusSignature, badgeSignature, selectedStep, size, !!onNodeSelect]);

  // Click delegation (§3.2) — one listener on the container, closest('g.node') -> data-step.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || size !== 'full' || !onNodeSelect) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const nodeEl = target?.closest('g.node');
      const step = nodeEl?.getAttribute('data-step');
      if (step) onNodeSelect(step);
    };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [size, onNodeSelect]);

  useEffect(() => {
    if (!flashToken) return;
    const el = nodeElByStepRef.current.get(flashToken.step);
    if (!el) return;
    el.classList.remove('dag-node-flashing');
    void el.getBoundingClientRect(); // force reflow so a repeat flash restarts the CSS animation
    el.classList.add('dag-node-flashing');
    const t = setTimeout(() => el.classList.remove('dag-node-flashing'), 900);
    return () => clearTimeout(t);
  }, [flashToken]);

  if (loading && !detail) {
    return <div class="dag-empty">Loading workflow graph…</div>;
  }
  if (error) {
    return <div class="dag-empty">Failed to load workflow graph: {error}</div>;
  }
  if (!diagramSource) {
    return <div class="dag-empty">No steps defined for this workflow/variant.</div>;
  }

  return (
    <div class={`dag-container dag-container-${size}`} ref={containerRef}>
      {/* key=diagramSource forces a fresh DOM node only on a STRUCTURAL change (workflow/variant/
          size) — mermaid.run() only (re-)processes elements it hasn't already stamped
          data-processed on, so reusing the same <pre> across a live status change would leave
          the OLD render on screen; reusing it across an UNRELATED status tick (the common case
          now) is exactly the point — no jiggle, no dagre re-layout. */}
      <pre class="mermaid" key={diagramSource}>
        {diagramSource}
      </pre>
    </div>
  );
}

function patchBadge(nodeEl: SVGGElement, text: string | null) {
  let badge = nodeEl.querySelector<SVGTextElement>('text.dag-badge');
  if (!text) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    badge.setAttribute('class', 'dag-badge');
    badge.setAttribute('text-anchor', 'end');
    nodeEl.appendChild(badge);
  }
  try {
    const shape = nodeEl.querySelector<SVGGraphicsElement>('rect, polygon, .label-container');
    const bbox = shape?.getBBox();
    if (bbox) {
      badge.setAttribute('x', String(bbox.x + bbox.width - 4));
      badge.setAttribute('y', String(bbox.y + 12));
    }
  } catch {
    // getBBox can throw on a detached/hidden node (e.g. mid-transition) — badge just skips
    // positioning this tick, the next successful apply corrects it.
  }
  badge.textContent = text;
}
