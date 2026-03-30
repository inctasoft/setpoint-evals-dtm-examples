import type { JobState } from '../types/events';
import { ProgressBar } from './progress-bar';

const STATUS_ICONS: Record<string, string> = {
  completed: '✅',
  partial_success: '✅',
  processing: '⚙️ ',
  failed: '❌',
  pending: '⏳',
};

interface JobListProps {
  jobs: JobState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

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
    <>
      {jobs.map(job => {
        const completed = job.steps.filter(s => s.status === 'completed').length;
        const total = job.steps.length;
        const icon = STATUS_ICONS[job.status] ?? '○';

        return (
          <div
            key={job.id}
            class={`job-item ${job.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(job.id)}
          >
            <div class="job-workflow">
              {icon} {job.workflow}
            </div>
            <div class="job-id">{job.id.slice(0, 12)}... · {job.variant}</div>
            {total > 0 && (
              <div class="job-progress">
                <ProgressBar completed={completed} total={total} width={100} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
