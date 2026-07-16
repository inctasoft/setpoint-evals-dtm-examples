import { useCallback, useEffect, useState } from 'preact/hooks';
import { EvalSummary } from '../types/evals';

interface UseEvalsResult {
  evals: EvalSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Discovery is filesystem-live server-side — this hook just fetches it. No client cache/manifest. */
export function useEvals(): UseEvalsResult {
  const [evals, setEvals] = useState<EvalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // NOTE the doubled "/api" — matches the existing use-websocket.ts convention: the vite
    // dev proxy strips ONE leading "/api" before forwarding, and the orchestrator's own
    // routes live under its global "api/v1" prefix, so the frontend path needs both.
    fetch('/api/api/v1/evals')
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/v1/evals -> HTTP ${res.status}`);
        return res.json() as Promise<EvalSummary[]>;
      })
      .then((data) => {
        if (!cancelled) setEvals(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  return { evals, loading, error, reload };
}

export interface RunEvalResult {
  jobId: string;
}

export async function runEval(suite: string, id: string): Promise<RunEvalResult> {
  const res = await fetch(
    `/api/api/v1/evals/${encodeURIComponent(suite)}/${encodeURIComponent(id)}/run`,
    { method: 'POST' },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body as { message?: string })?.message || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as RunEvalResult;
}
