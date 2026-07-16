import type { WorkflowSummary } from '../types/api';
import { colorForWorkflow } from '../lib/workflow-colors';

interface WorkflowSelectorProps {
  workflows: WorkflowSummary[];
  selected: string | null; // null == "All"
  onSelect: (workflow: string | null) => void;
}

/**
 * Persistent header selector — "All" or one registered workflow. Drives job-list
 * filtering, dashboard columns' accent dot, the Scenarios suite-tab preselect, and
 * the DAG mini-viz (app.tsx wires all four off this one piece of state).
 */
export function WorkflowSelector({ workflows, selected, onSelect }: WorkflowSelectorProps) {
  return (
    <div class="workflow-selector">
      <button
        class={`workflow-pill ${selected === null ? 'active' : ''}`}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {workflows.map((w) => {
        const color = colorForWorkflow(w.name);
        const active = selected === w.name;
        return (
          <button
            key={w.name}
            class={`workflow-pill ${active ? 'active' : ''} ${w.enabled ? '' : 'disabled'}`}
            style={active ? { background: color, borderColor: color } : { borderColor: color, color }}
            title={w.enabled ? w.description : `${w.description} (disabled — not accepting new jobs)`}
            onClick={() => onSelect(w.name)}
          >
            <span class="workflow-pill-dot" style={{ background: color }} />
            {w.name}
            {!w.enabled && <span class="workflow-pill-disabled-badge">off</span>}
          </button>
        );
      })}
    </div>
  );
}
