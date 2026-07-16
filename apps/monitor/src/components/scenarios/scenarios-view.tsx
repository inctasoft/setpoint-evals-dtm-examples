import { useState } from 'preact/hooks';
import { useEvals } from '../../hooks/use-evals';
import { EvalSummary } from '../../types/evals';
import { EvalSidebar } from './eval-sidebar';
import { EvalDetail } from './eval-detail';

interface ScenariosViewProps {
  onJobCreated: (jobId: string) => void;
}

export function ScenariosView({ onJobCreated }: ScenariosViewProps) {
  const { evals, loading, error, reload } = useEvals();
  const [selected, setSelected] = useState<EvalSummary | null>(null);

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
      <EvalSidebar evals={evals} selected={current} onSelect={setSelected} />
      <EvalDetail evalItem={current} onJobCreated={onJobCreated} />
    </div>
  );
}
