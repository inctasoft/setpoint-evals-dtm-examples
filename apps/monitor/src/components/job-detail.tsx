import type { JobState } from '../types/events';
import { ProgressBar } from './progress-bar';
import { StepRow } from './step-row';

interface JobDetailProps {
  job: JobState | null;
}

export function JobDetail({ job }: JobDetailProps) {
  if (!job) {
    return (
      <div class="empty-state">
        Select a job to view details
      </div>
    );
  }

  const completed = job.steps.filter(s => s.status === 'completed').length;
  const failed = job.steps.filter(s => s.status === 'failed').length;
  const total = job.steps.length;

  return (
    <div>
      <div class="job-detail-header">
        <div>
          <span class="workflow-name">{job.workflow}</span>
          <span class="variant"> ({job.variant})</span>
          <span class={`status ${job.status}`} style="margin-left: 12px">
            {job.status.toUpperCase()}
          </span>
        </div>
        <div style="margin-top: 4px; font-size: 11px; color: var(--text-dim)">
          ID: {job.id} · Created: {new Date(job.createdAt).toLocaleTimeString('en-GB')}
          {job.completedAt && ` · Completed: ${new Date(job.completedAt).toLocaleTimeString('en-GB')}`}
        </div>
        {total > 0 && (
          <div style="margin-top: 6px; display: flex; align-items: center; gap: 12px">
            <ProgressBar completed={completed} total={total} width={200} />
            {failed > 0 && <span style="color: var(--red); font-size: 11px">⚠️ {failed} failed</span>}
          </div>
        )}
      </div>

      <div style="padding: 4px 0">
        <div style="padding: 4px 12px; font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border)">
          Steps
        </div>
        {job.steps.map((step, i) => (
          // step.step (stepValue) repeats for fan-out children of the same step type
          // (e.g. 4x 'ActivateSensor') — fold in the array index for a unique key.
          <StepRow key={`${step.step}-${i}`} step={step} index={i} />
        ))}
      </div>

      {job.results && (
        <div style="padding: 4px 0">
          <div style="padding: 4px 12px; font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border)">
            Results
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; padding: 8px 12px; font-size: 12px">
            <div>
              <span style="color: var(--text-dim)">Records Processed: </span>
              <span style="color: var(--green)">{job.results.totalRecordsProcessed}</span>
            </div>
            <div>
              <span style="color: var(--text-dim)">Records Failed: </span>
              <span style={`color: var(--${job.results.totalRecordsFailed > 0 ? 'red' : 'green'})`}>{job.results.totalRecordsFailed}</span>
            </div>
            <div>
              <span style="color: var(--text-dim)">Steps Completed: </span>
              <span style="color: var(--green)">{job.results.stepsCompleted}</span>
            </div>
            <div>
              <span style="color: var(--text-dim)">Steps Failed: </span>
              <span style={`color: var(--${job.results.stepsFailed > 0 ? 'red' : 'green'})`}>{job.results.stepsFailed}</span>
            </div>
            <div>
              <span style="color: var(--text-dim)">Steps Aborted: </span>
              <span>{job.results.stepsAborted}</span>
            </div>
            <div>
              <span style="color: var(--text-dim)">Duration: </span>
              <span style="color: var(--cyan)">{(job.results.durationMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
        </div>
      )}

      {job.error && (
        <div style="padding: 8px 12px; color: var(--red); font-size: 12px; border-top: 1px solid var(--border)">
          Error: {job.error}
        </div>
      )}
    </div>
  );
}
