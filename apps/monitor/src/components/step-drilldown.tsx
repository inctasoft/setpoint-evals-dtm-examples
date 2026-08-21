import { useWorkflowDetail } from '../hooks/use-workflow-detail';
import { useJobStepDetail } from '../hooks/use-job-step-detail';
import {
  isAggregateActivity,
  fanOutCounts,
  normalizedChildren,
  childStatusDistribution,
  type StepActivity,
} from '../lib/step-activity';
import type { JobState, StepState } from '../types/events';

const NON_TERMINAL = new Set(['delegated', 'in_progress', 'in_progress_retrying', 'waiting_for_ack', 'waiting_for_children', 'pending']);
const MAX_CHILDREN_RENDERED = 50;

interface StepDrilldownProps {
  workflowName: string;
  stepName: string;
  job: JobState | null;
  onClose: () => void;
  /** Sets the console dock's filter to this step (§3.3 "show only this step in console"). */
  onScopeEvents: (step: string) => void;
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-GB');
  } catch {
    return iso;
  }
}

/**
 * Right-rail node drill-down (ux-storyboards.md §3.2) — information hierarchy EXACTLY as
 * spec'd: header -> activity timeline -> fan-out section -> input/output -> scoped-events link.
 * Data source is the dedicated GET /jobs/:jobId/steps/:stepName/activity endpoint (SYNTHESIS.md
 * verdict — NOT an enriched getJobDetails), via use-job-step-detail.
 */
export function StepDrilldown({ workflowName, stepName, job, onClose, onScopeEvents }: StepDrilldownProps) {
  const { detail: workflowDetail } = useWorkflowDetail(workflowName);
  const jobStep: StepState | undefined = job?.steps.find((s) => s.step === stepName);
  const contractStep = Object.values(workflowDetail?.stepsByVariant ?? {})
    .flat()
    .find((s) => s.step === stepName);

  const shouldPoll = !!jobStep && NON_TERMINAL.has(jobStep.status);
  const { data, loading, error, notFound } = useJobStepDetail(job?.id ?? null, stepName, shouldPoll);

  return (
    <div class="step-drilldown">
      <div class="step-drilldown-header">
        <span class="step-drilldown-title">{stepName}</span>
        <button class="drilldown-close" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* State: no job selected — the contract view (workflow step description + dependencies),
          the "DAG as product" angle even with nothing running. */}
      {!job && (
        <div class="step-drilldown-body">
          <div class="drilldown-empty-note">
            Select a job to overlay live activity; showing the workflow's step contract.
          </div>
          {contractStep ? (
            <>
              <div class="drilldown-section-label">Description</div>
              <p class="drilldown-description">{contractStep.description || '—'}</p>
              <div class="drilldown-section-label">Depends on</div>
              {contractStep.dependencies.length > 0 ? (
                <ul class="drilldown-dep-list">
                  {contractStep.dependencies.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : (
                <div class="drilldown-empty-note">No dependencies — runs first.</div>
              )}
            </>
          ) : (
            <div class="drilldown-empty-note">Loading step contract…</div>
          )}
        </div>
      )}

      {job && (
        <div class="step-drilldown-body">
          <div class="step-drilldown-summary">
            {jobStep && <span class={`status ${jobStep.status}`}>{jobStep.status.replace(/_/g, ' ').toUpperCase()}</span>}
            {jobStep?.duration != null && <span class="drilldown-duration">{formatMs(jobStep.duration)}</span>}
            {jobStep?.attempt != null && jobStep.attempt > 0 && (
              <span class="drilldown-attempt-chip">attempt {jobStep.attempt}</span>
            )}
          </div>

          {loading && !data && (
            <div class="drilldown-skeleton">
              <div class="skeleton-row" />
              <div class="skeleton-row" />
              <div class="skeleton-row" />
            </div>
          )}

          {error && <div class="drilldown-empty-note error">Failed to load activity: {error}</div>}

          {/* State: pending step — no activity row yet, only the contract's dependency list. */}
          {!loading && notFound && (
            <div class="drilldown-empty-note">
              No activity yet
              {contractStep && contractStep.dependencies.length > 0 && (
                <>
                  {' '}
                  — waiting on:
                  <ul class="drilldown-dep-list">
                    {contractStep.dependencies.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {data && <StepActivityDetail activity={data} />}

          <div class="drilldown-section-label">Console</div>
          <button class="drilldown-scope-events-btn" onClick={() => onScopeEvents(stepName)}>
            Show only this step in console ↴
          </button>
        </div>
      )}
    </div>
  );
}

function StepActivityDetail({ activity }: { activity: StepActivity }) {
  const aggregate = isAggregateActivity(activity);
  const children = normalizedChildren(activity);
  const counts = fanOutCounts(activity);
  const distribution = childStatusDistribution(children);

  return (
    <>
      {/* Activity timeline — the "engine's patience" money-shot: delegated -> attempts -> ack. */}
      {!aggregate && (
        <>
          <div class="drilldown-section-label">Activity timeline</div>
          <div class="activity-timeline">
            {activity.delegation.lambdaFunctionName && (
              <div class="timeline-entry">
                <span class="timeline-dot" />
                delegated → <span class="timeline-mono">{activity.delegation.lambdaFunctionName}</span>
              </div>
            )}
            {activity.attempts.length === 0 && (
              <div class="timeline-entry timeline-dim">no attempts recorded yet</div>
            )}
            {activity.attempts.map((a, i) => (
              <div key={i} class={`timeline-entry ${a.status === 'failed' || a.error ? 'timeline-failed' : ''}`}>
                <span class="timeline-dot" />
                attempt #{a.attemptNumber ?? i + 1} {a.status ?? ''}
                {a.processingTimeMs != null && ` (${formatMs(a.processingTimeMs)})`}
                {a.sqsReceiveCount != null && `, sqsReceiveCount=${a.sqsReceiveCount}`}
                {a.error && <div class="timeline-error">↳ {a.error}</div>}
              </div>
            ))}
            {activity.ack.kafkaPublishedAt && (
              <div class="timeline-entry">
                <span class="timeline-dot" />
                published {formatTime(activity.ack.kafkaPublishedAt)}
                {activity.ack.ackReceivedAt && (
                  <> → acknowledged {formatTime(activity.ack.ackReceivedAt)} ({formatMs(activity.ack.ackWaitMs)})</>
                )}
                {!activity.ack.ackReceivedAt && <> → awaiting acknowledgement</>}
              </div>
            )}
          </div>
        </>
      )}

      {/* Fan-out section — only when there are children (either shape). */}
      {counts && (
        <>
          <div class="drilldown-section-label">Fan-out ({counts.total})</div>
          <div class="fanout-distribution-bar">
            {Object.entries(distribution).map(([status, count]) => (
              <span
                key={status}
                class={`fanout-bar-segment fanout-status-${status}`}
                style={{ flexGrow: count }}
                title={`${count} ${status}`}
              />
            ))}
          </div>
          <div class="fanout-distribution-legend">
            {Object.entries(distribution)
              .map(([status, count]) => `${count} ${status.replace(/_/g, ' ')}`)
              .join(' · ')}
            {' '}of {counts.total}
          </div>
          <div class="fanout-child-list">
            {children.slice(0, MAX_CHILDREN_RENDERED).map((c) => (
              <div key={c.key} class="fanout-child-row">
                <span class={`step-icon ${c.status}`} />
                <span class="fanout-child-id" title={c.childItemId ?? undefined}>
                  {c.childItemId ?? `#${c.childIndex ?? '?'}`}
                </span>
                {c.step && <span class="fanout-child-step">{c.step}</span>}
                <span class="fanout-child-status">{c.status}</span>
                <span class="fanout-child-duration">{formatMs(c.durationMs)}</span>
              </div>
            ))}
            {children.length > MAX_CHILDREN_RENDERED && (
              <div class="fanout-child-more">+ {children.length - MAX_CHILDREN_RENDERED} more (see distribution above)</div>
            )}
          </div>
        </>
      )}

      {/* Input/Output — collapsed by default, reuses payloads-panel's .payload-preview styling. */}
      {!aggregate && (activity.input || activity.output) && (
        <>
          {activity.input && (
            <details class="drilldown-io">
              <summary>Input</summary>
              <pre class="payload-preview">{JSON.stringify(activity.input, null, 2)}</pre>
            </details>
          )}
          {activity.output && (
            <details class="drilldown-io">
              <summary>Output</summary>
              <pre class="payload-preview">{JSON.stringify(activity.output, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </>
  );
}
