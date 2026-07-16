import { useState, useEffect } from 'preact/hooks';
import type { WorkflowFlagsResponse } from '../types/api';

interface FlagsPanelProps {
  /** null == "All" selected — flags are per-workflow, so nothing to show. */
  workflow: string | null;
}

/**
 * "Flags" tab — GET /api/v1/workflows/:workflowName/flags (SE-22). Shows the
 * REAL resolved flags (FeatureFlagService.resolveFlags, same call path a real
 * job submission uses), not a paraphrase of the workflow config file.
 */
export function FlagsPanel({ workflow }: FlagsPanelProps) {
  const [data, setData] = useState<WorkflowFlagsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflow) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/api/v1/workflows/${encodeURIComponent(workflow)}/flags`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load flags');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflow]);

  if (!workflow) {
    return <div class="empty-state">Select a single workflow (not "All") to view its flags.</div>;
  }
  if (loading && !data) {
    return <div class="empty-state">Loading flags…</div>;
  }
  if (error) {
    return <div class="empty-state">Failed to load flags: {error}</div>;
  }
  if (!data || Object.keys(data.flags).length === 0) {
    return <div class="empty-state">No feature flags defined for {workflow}.</div>;
  }

  return (
    <table class="sqs-table">
      <thead>
        <tr>
          <th>Flag</th>
          <th>Value</th>
          <th>Overridable</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(data.flags).map(([key, value]) => (
          <tr key={key}>
            <td title={key}>{key}</td>
            <td style={value === true ? 'color: var(--green)' : value === false ? 'color: var(--text-dim)' : ''}>
              {String(value)}
            </td>
            <td>{data.clientOverridable.includes(key) ? '✓' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
