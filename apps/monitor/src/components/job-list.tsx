import type { JobState } from '../types/events';
import { colorForWorkflow } from '../lib/workflow-colors';

const OUTCOME_LABELS: Record<string, string> = {
  completed: 'COMPLETED',
  partial_success: 'PARTIAL',
  failed: 'FAILED',
  processing: 'RUNNING',
  pending: 'PENDING',
};

function formatDuration(job: JobState): string {
  if (job.results) return `${(job.results.durationMs / 1000).toFixed(1)}s`;
  if (job.status === 'processing') {
    const elapsedMs = Date.now() - new Date(job.createdAt).getTime();
    return `${(elapsedMs / 1000).toFixed(0)}s…`;
  }
  return '-';
}

interface JobListProps {
  jobs: JobState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Dashboard job table (Phase 4b) — replaces the donor's flat job-list cards
 * with proper columns: workflow (accent dot), variant, outcome badge, steps
 * summary (done/failed/aborted — "aborted" is this codebase's actual name
 * for what a migration-style tool would call "skipped": JobResults.stepsAborted,
 * cascades that never ran because an earlier required step failed), duration.
 */
export function JobList({ jobs, selectedId, onSelect }: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div class="empty-state">
        📭 No jobs found
        <pre>
{`Submit a test job:
  curl -X POST http://localhost:3000/workflows/\\
    order-processing/jobs \\
    -H 'Content-Type: application/json' \\
    -d '{"variant":"default"}'`}
        </pre>
      </div>
    );
  }

  return (
    <table class="job-table">
      <thead>
        <tr>
          <th>Workflow</th>
          <th>Variant</th>
          <th>Outcome</th>
          <th>Steps</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const completed = job.steps.filter((s) => s.status === 'completed').length;
          const failed = job.steps.filter((s) => s.status === 'failed').length;
          const aborted = job.results?.stepsAborted ?? 0;
          const total = job.steps.length;
          const color = colorForWorkflow(job.workflow);

          return (
            <tr
              key={job.id}
              class={`job-row ${job.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(job.id)}
              title={`${job.id} · created ${new Date(job.createdAt).toLocaleString()}`}
            >
              <td class="job-table-workflow">
                <span class="workflow-pill-dot" style={{ background: color }} />
                <span class="job-table-workflow-name">{job.workflow}</span>
              </td>
              <td class="job-table-variant">{job.variant}</td>
              <td>
                <span class={`outcome-badge status ${job.status}`}>
                  {OUTCOME_LABELS[job.status] ?? job.status.toUpperCase()}
                </span>
              </td>
              <td class="job-table-steps">
                {total > 0 ? (
                  <>
                    <span class="step-count-done">{completed}✓</span>
                    {failed > 0 && <span class="step-count-failed"> {failed}✗</span>}
                    {aborted > 0 && <span class="step-count-aborted"> {aborted}⊘</span>}
                    <span class="step-count-total"> /{total}</span>
                  </>
                ) : (
                  '-'
                )}
              </td>
              <td class="job-table-duration">{formatDuration(job)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
