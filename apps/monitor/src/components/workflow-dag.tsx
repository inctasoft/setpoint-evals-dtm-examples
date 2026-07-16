import { useEffect, useMemo, useRef } from 'preact/hooks';
import { useWorkflowDetail } from '../hooks/use-workflow-detail';
import { renderMermaidDiagrams } from '../lib/mermaid';
import type { JobState, StepStatus } from '../types/events';

interface WorkflowDagProps {
  workflowName: string;
  /** When set (and its .workflow matches workflowName) overlays this job's live step statuses. */
  selectedJob: JobState | null;
}

// mermaid node ids must be identifier-safe; step names are already PascalCase/no-spaces in
// practice, but sanitize defensively so a future step name with punctuation can't break the
// generated flowchart source.
function nodeId(step: string): string {
  return `s_${step.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

const STATUS_CLASS: Record<StepStatus, string> = {
  completed: 'dagDone',
  failed: 'dagFailed',
  in_progress: 'dagActive',
  in_progress_retrying: 'dagActive',
  waiting_for_ack: 'dagActive',
  delegated: 'dagActive',
  pending: 'dagPending',
};

/**
 * Per-workflow step DAG — nodes from stepsByVariant[variant], edges from each
 * step's `dependencies` (SE-23's pinned contract). When a job on this SAME
 * workflow is selected, its live step statuses overlay as node colors (mermaid
 * classDef, not per-render inline style — cheaper diagram source, and the
 * class vocabulary doubles as the legend).
 */
export function WorkflowDag({ workflowName, selectedJob }: WorkflowDagProps) {
  const { detail, loading, error } = useWorkflowDetail(workflowName);
  const containerRef = useRef<HTMLDivElement>(null);

  const variant =
    selectedJob && selectedJob.workflow === workflowName && detail?.stepsByVariant[selectedJob.variant]
      ? selectedJob.variant
      : detail?.defaultVariant;

  const steps = variant && detail ? detail.stepsByVariant[variant] : undefined;

  const diagramSource = useMemo(() => {
    if (!steps || steps.length === 0) return null;

    const lines: string[] = ['flowchart TD'];
    for (const step of steps) {
      // Square node, label = step name (mermaid escapes quotes inside "..." itself).
      lines.push(`  ${nodeId(step.step)}["${step.step}"]`);
    }
    for (const step of steps) {
      for (const dep of step.dependencies) {
        lines.push(`  ${nodeId(dep)} --> ${nodeId(step.step)}`);
      }
    }

    const overlayJob = selectedJob && selectedJob.workflow === workflowName ? selectedJob : null;
    if (overlayJob) {
      const byStep = new Map(overlayJob.steps.map((s) => [s.step, s.status]));
      lines.push('  classDef dagDone fill:#1c2128,stroke:#3fb950,stroke-width:2px,color:#3fb950');
      lines.push('  classDef dagFailed fill:#1c2128,stroke:#f85149,stroke-width:2px,color:#f85149');
      lines.push('  classDef dagActive fill:#1c2128,stroke:#58a6ff,stroke-width:2px,color:#58a6ff');
      lines.push('  classDef dagPending fill:#161b22,stroke:#30363d,color:#8b949e');
      for (const step of steps) {
        const status = byStep.get(step.step);
        const cls = status ? STATUS_CLASS[status] : 'dagPending';
        lines.push(`  class ${nodeId(step.step)} ${cls}`);
      }
    }

    return lines.join('\n');
  }, [steps, selectedJob, workflowName]);

  useEffect(() => {
    if (containerRef.current) {
      renderMermaidDiagrams(containerRef.current);
    }
  }, [diagramSource]);

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
    <div class="dag-container" ref={containerRef}>
      {/* key=diagramSource forces a fresh DOM node per source string — mermaid.run() only
          (re-)processes elements it hasn't already stamped data-processed on, so reusing the
          same <pre> across a job-selection change would leave the OLD render on screen. */}
      <pre class="mermaid" key={diagramSource}>
        {diagramSource}
      </pre>
    </div>
  );
}
