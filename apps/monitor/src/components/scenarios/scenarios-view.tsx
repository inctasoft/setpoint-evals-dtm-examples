import { useState } from 'preact/hooks';
import { useEvals } from '../../hooks/use-evals';
import { EvalSummary, EvalSuite, SUITE_ORDER } from '../../types/evals';
import { EvalSidebar } from './eval-sidebar';
import { EvalDetail } from './eval-detail';

interface ScenariosViewProps {
  onJobCreated: (jobId: string) => void;
  /** Header's workflow selector — null == "All". Preselects the matching suite
      tab; workflows with no dedicated eval suite (e.g. plan-execution) fall
      back to 'all' rather than silently showing an empty list. */
  presetWorkflow: string | null;
}

function suiteForWorkflow(workflow: string | null): EvalSuite | 'all' {
  if (workflow && (SUITE_ORDER as string[]).includes(workflow)) return workflow as EvalSuite;
  return 'all';
}

export function ScenariosView({ onJobCreated, presetWorkflow }: ScenariosViewProps) {
  const { evals, loading, error, reload } = useEvals();
  const [selected, setSelected] = useState<EvalSummary | null>(null);
  const initialSuite = suiteForWorkflow(presetWorkflow);

  if (loading && evals.length === 0) {
    return (
      <div class="scenarios-view">
        <div class="scenarios-detail-empty">Loading evals…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div class="scenarios-view">
        <div class="scenarios-detail-empty">
          Failed to load evals: {error}
          <div>
            <button class="run-button" onClick={reload}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = selected ? (evals.find((e) => e.suite === selected.suite && e.id === selected.id) ?? null) : null;

  return (
    <div class="scenarios-view">
      {/* key=initialSuite: remount (and re-seed useState) only when the header's workflow
          selection changes — a suite click made WITHIN this screen must not be fought on
          every re-render, only reset when the upstream preset itself changes. */}
      <EvalSidebar
        key={initialSuite}
        evals={evals}
        selected={current}
        onSelect={setSelected}
        initialSuite={initialSuite}
      />
      <EvalDetail evalItem={current} onJobCreated={onJobCreated} />
    </div>
  );
}
