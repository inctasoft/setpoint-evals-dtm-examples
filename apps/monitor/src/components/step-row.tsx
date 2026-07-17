import type { StepState, StepStatus } from '../types/events';

// Record<StepStatus, string> — same "derive, don't duplicate" contract as workflow-dag.tsx's
// STATUS_CLASS: a status added to @dtm/core without an icon here is a compile error, not a
// silent '?' glyph (dtm-video-v2 ux-storyboards.md §3.0).
const STEP_ICONS: Record<StepStatus, string> = {
  completed: '✓',
  in_progress: '▶',
  delegated: '▶',
  in_progress_retrying: '🔄',
  waiting_for_ack: '⏱',
  waiting_for_children: '⧉',
  failed: '✗',
  pending: '○',
  skipped: '⊘',
  partial_success: '◐',
};

interface StepRowProps {
  step: StepState;
  index: number;
}

export function StepRow({ step, index }: StepRowProps) {
  const icon = STEP_ICONS[step.status] ?? '?';
  const duration = step.duration != null ? `${(step.duration / 1000).toFixed(1)}s` : '';

  return (
    <>
      <div class="step-row">
        <span class={`step-icon ${step.status}`}>{icon}</span>
        <span class="step-num">{index + 1}.</span>
        <span class="step-name" title={step.description}>{step.step}</span>
        <span class="step-status">{step.status.replace(/_/g, ' ')}</span>
        <span class="step-duration">{duration}</span>
      </div>
      {step.status === 'failed' && step.error && (
        <div class="step-error">↳ {step.error}</div>
      )}
      {step.status === 'skipped' && (
        <div class="step-skipped-info">
          ↳ skipped{step.reason ? ` — ${step.reason}` : ' — a dependency failed'}
        </div>
      )}
      {step.status === 'in_progress_retrying' && step.attempt != null && (
        <div class="step-retry-info">↳ Retrying (attempt #{step.attempt})</div>
      )}
      {step.status === 'waiting_for_ack' && (
        <div class="step-retry-info">↳ Waiting for external acknowledgement</div>
      )}
      {step.status === 'waiting_for_children' && (
        <div class="step-retry-info">
          ↳ Waiting on fan-out children{step.childCount ? ` (${step.childCount})` : ''}
        </div>
      )}
      {step.status === 'partial_success' && (
        <div class="step-skipped-info">↳ Some fan-out children failed — proceeding with the rest</div>
      )}
    </>
  );
}
