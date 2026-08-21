import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { WorkflowSummary } from '../types/api';

const POLL_INTERVAL_MS = 30_000; // enable/disable is the only thing that can change post-boot

/** GET /api/v1/workflows — feeds the header's WorkflowSelector. */
export function useWorkflows() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/api/v1/workflows');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [load]);

  return { workflows, loading, error, reload: load };
}
