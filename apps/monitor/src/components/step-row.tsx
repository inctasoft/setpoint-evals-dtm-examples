import type { StepState } from '../types/events';

const STEP_ICONS: Record<string, string> = {
  completed: '✓',
  in_progress: '▶',
  delegated: '▶',
  in_progress_retrying: '🔄',
  waiting_for_ack: '⏱',
  failed: '✗',
  pending: '○',
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
      {step.status === 'in_progress_retrying' && step.attempt != null && (
        <div class="step-retry-info">↳ Retrying (attempt #{step.attempt})</div>
      )}
      {step.status === 'waiting_for_ack' && (
        <div class="step-retry-info">↳ Waiting for external acknowledgement</div>
      )}
    </>
  );
}
