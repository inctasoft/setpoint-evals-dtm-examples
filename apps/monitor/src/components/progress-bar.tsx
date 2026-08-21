interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
}

export function ProgressBar({ completed, total, width = 120 }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const color = pct === 100 ? 'green' : pct >= 75 ? 'cyan' : 'yellow';

  return (
    <div class="progress-bar">
      <div class="progress-track" style={{ width: `${width}px` }}>
        <div class={`progress-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span class="progress-text">{pct}% ({completed}/{total})</span>
    </div>
  );
}
