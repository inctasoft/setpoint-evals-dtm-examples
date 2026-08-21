import { useState, useEffect } from 'preact/hooks';
import type { WorkflowDetail } from '../types/api';

/**
 * GET /api/v1/workflows/:workflowName — feeds the DAG mini-viz (stepsByVariant
 * dependencies, SE-23's contract). Fetches once per `workflowName` change; a
 * workflow's step graph is fixed at boot (loaded from the filesystem), so no
 * polling is needed here (unlike use-workflows, whose `enabled` flag can flip).
 */
export function useWorkflowDetail(workflowName: string | null) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowName) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/api/v1/workflows/${encodeURIComponent(workflowName)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: WorkflowDetail) => {
        if (!cancelled) {
          setDetail(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load workflow');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowName]);

  return { detail, loading, error };
}
