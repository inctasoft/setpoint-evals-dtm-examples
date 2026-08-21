import { useEffect, useState } from 'preact/hooks';
import type { StepActivity } from '../lib/step-activity';

export interface JobStepDetailState {
  data: StepActivity | null;
  loading: boolean;
  error: string | null;
  /** True on a real 404 (no primary or fan-out-child row for this step on this job) — distinct
   *  from `error`, which is a transport/5xx failure. Lets StepDrilldown render its "pending step"
   *  state instead of a generic error banner (ux-storyboards.md §3.2 States). */
  notFound: boolean;
}

/**
 * GET /api/v1/jobs/:jobId/steps/:stepName/activity — the DAG node drill-down's data source
 * (capability-spec.md §3.2a). Fetches once per (jobId, stepName) change; pass `poll=true` to
 * additionally refresh on an interval while the caller still cares (e.g. WorkflowDag's fan-out
 * badge, StepDrilldown while the step is non-terminal) — WS events only carry TOP-LEVEL step
 * transitions, so this is the only live data source for fan-out child completion counts.
 */
export function useJobStepDetail(
  jobId: string | null,
  stepName: string | null,
  poll = false,
  pollIntervalMs = 2500,
): JobStepDetailState {
  const [state, setState] = useState<JobStepDetailState>({
    data: null,
    loading: false,
    error: null,
    notFound: false,
  });

  useEffect(() => {
    if (!jobId || !stepName) {
      setState({ data: null, loading: false, error: null, notFound: false });
      return;
    }
    let cancelled = false;

    const fetchOnce = async () => {
      setState((prev) => ({ ...prev, loading: true }));
      try {
        const res = await fetch(
          `/api/api/v1/jobs/${encodeURIComponent(jobId)}/steps/${encodeURIComponent(stepName)}/activity`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setState({ data: null, loading: false, error: null, notFound: true });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StepActivity;
        if (!cancelled) setState({ data, loading: false, error: null, notFound: false });
      } catch (err) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : 'failed to load step activity',
          }));
        }
      }
    };

    fetchOnce();
    const timer = poll ? setInterval(fetchOnce, pollIntervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, stepName, poll, pollIntervalMs]);

  return state;
}
