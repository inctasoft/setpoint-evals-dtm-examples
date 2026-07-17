import { useEffect, useRef, useState } from 'preact/hooks';
import { EvalSummary } from '../../types/evals';
import { renderMarkdown } from '../../lib/markdown';
import { renderMermaidDiagrams } from '../../lib/mermaid';
import { splitReadmeSections } from '../../lib/readme-sections';
import { runEval } from '../../hooks/use-evals';

interface EvalDetailProps {
  evalItem: EvalSummary | null;
  onJobCreated: (jobId: string) => void;
}

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'success'; jobId: string }
  | { status: 'error'; message: string };

export function EvalDetail({ evalItem, onJobCreated }: EvalDetailProps) {
  const [runState, setRunState] = useState<RunState>({ status: 'idle' });
  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset the run result whenever a different eval is selected.
  useEffect(() => {
    setRunState({ status: 'idle' });
  }, [evalItem?.suite, evalItem?.id]);

  // mermaid.run() on selection change (and once the README HTML is in the DOM).
  useEffect(() => {
    if (!evalItem?.readme || !bodyRef.current) return;
    renderMermaidDiagrams(bodyRef.current).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('mermaid render failed', err);
    });
  }, [evalItem?.suite, evalItem?.id, evalItem?.readme]);

  if (!evalItem) {
    return (
      <div class="scenarios-detail">
        <div class="scenarios-detail-empty">Select an eval from the list.</div>
      </div>
    );
  }

  const handleRun = async () => {
    setRunState({ status: 'running' });
    try {
      const result = await runEval(evalItem.suite, evalItem.id);
      setRunState({ status: 'success', jobId: result.jobId });
    } catch (err) {
      setRunState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  // D4 hygiene (ux-storyboards.md §3.5): Artifacts + Run stay out of the default-visible flow —
  // Assertions (between them in most READMEs) is deliberately NOT pulled in; it's the styled
  // checklist that's meant to be the closing beat.
  const sections = evalItem.readme ? splitReadmeSections(evalItem.readme) : null;
  const renderedMain = sections ? renderMarkdown(sections.main) : null;
  const renderedTechnical = sections?.hasTechnical ? renderMarkdown(sections.technical) : null;

  return (
    <div class="scenarios-detail">
      <div class="scenarios-detail-header">
        <div class="eval-title">
          {evalItem.suite}/{evalItem.id}
        </div>
        <div class="scenarios-detail-badges">
          {evalItem.category && <span class="badge">{evalItem.category}</span>}
          {evalItem.duration && <span class="badge">⏱ {evalItem.duration}</span>}
          {evalItem.isolation && (
            <span class={`badge isolation-${evalItem.isolation}`}>{evalItem.isolation}</span>
          )}
          {evalItem.quick && <span class="badge quick">quick</span>}
          <button
            class={`run-button ${runState.status === 'error' ? 'run-error' : ''}`}
            disabled={runState.status === 'running'}
            onClick={handleRun}
          >
            {runState.status === 'running' ? 'Running…' : '▶ Run'}
          </button>
        </div>
      </div>

      {runState.status === 'success' && (
        <div class="run-result success">
          ✓ Job created:{' '}
          <a
            onClick={() => onJobCreated(runState.jobId)}
            title="Switch to the Dashboard view with this job selected"
          >
            {runState.jobId}
          </a>
        </div>
      )}
      {runState.status === 'error' && <div class="run-result error">✗ {runState.message}</div>}

      <div class="scenarios-detail-body" ref={bodyRef}>
        {evalItem.scenario && (
          <div class="gherkin-block">
            <span class="gherkin-keyword">Scenario</span>
            {'\n'}
            {evalItem.scenario}
          </div>
        )}

        {renderedMain ? (
          <div class="readme-body" dangerouslySetInnerHTML={{ __html: renderedMain }} />
        ) : (
          <div class="eval-list-empty">No README.md for this eval.</div>
        )}

        {renderedTechnical && (
          <details class="readme-technical-disclosure">
            <summary>Technical verification ▸</summary>
            <div class="readme-body" dangerouslySetInnerHTML={{ __html: renderedTechnical }} />
          </details>
        )}
      </div>
    </div>
  );
}
