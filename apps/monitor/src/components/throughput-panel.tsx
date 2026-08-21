import { useState, useEffect, useRef } from 'preact/hooks';
import type { ThroughputResponse } from '../types/api';

const POLL_INTERVAL_MS = 5000;
const WINDOW_MINUTES = 30;

interface ThroughputPanelProps {
  /** null == "All" — omits the workflow query param, aggregates across every workflow. */
  workflow: string | null;
}

/**
 * "Throughput" tab — GET /api/v1/metrics/throughput. A hand-rolled CSS bar
 * mini-chart (no chart library — terminal theme, tiny data volume, not worth
 * a dependency) showing steps-completed-per-minute over a trailing window.
 */
export function ThroughputPanel({ workflow }: ThroughputPanelProps) {
  const [data, setData] = useState<ThroughputResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const fetchThroughput = async () => {
      try {
        const params = new URLSearchParams({ windowMinutes: String(WINDOW_MINUTES) });
        if (workflow) params.set('workflow', workflow);
        const res = await fetch(`/api/api/v1/metrics/throughput?${params.toString()}`);
        if (res.ok) setData(await res.json());
      } catch {
        // retry on next poll
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    fetchThroughput();
    pollRef.current = setInterval(fetchThroughput, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [workflow]);

  if (loading && !data) {
    return <div class="empty-state">Loading throughput…</div>;
  }
  if (!data || data.buckets.length === 0) {
    return (
      <div class="empty-state">
        No completed steps in the last {WINDOW_MINUTES} minutes
        {workflow ? ` for ${workflow}` : ''}.
      </div>
    );
  }

  const maxCount = Math.max(1, ...data.buckets.map((b) => b.completed + b.failed));

  return (
    <div class="throughput-panel">
      <div class="throughput-summary">
        <span class="throughput-stat">
          <span class="status completed">{data.totalCompleted}</span> completed
        </span>
        <span class="throughput-stat">
          <span class="status failed">{data.totalFailed}</span> failed
        </span>
        <span class="throughput-window">last {data.windowMinutes}m{workflow ? ` · ${workflow}` : ''}</span>
      </div>
      <div class="throughput-chart">
        {data.buckets.map((b) => {
          const total = b.completed + b.failed;
          const heightPct = Math.max(2, Math.round((total / maxCount) * 100));
          const failedPct = total > 0 ? Math.round((b.failed / total) * 100) : 0;
          const time = new Date(b.bucket).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          });
          return (
            <div class="throughput-bar-col" key={b.bucket} title={`${time} — ${b.completed} completed, ${b.failed} failed`}>
              <div class="throughput-bar" style={{ height: `${heightPct}%` }}>
                {failedPct > 0 && (
                  <div class="throughput-bar-failed" style={{ height: `${failedPct}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
