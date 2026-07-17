import type { EventLogEntry } from '../types/events';

export interface EventLogFilter {
  jobId?: string;
  step?: string;
}

interface EventLogProps {
  entries: EventLogEntry[];
  /** Bottom-bar placement (default) shows its own header + is height-capped. The
      "Events" tab (TabbedPanel) sets hideHeader + fills the tab body instead. */
  hideHeader?: boolean;
  maxHeight?: string;
  /** Active filter — renders a chip row (§3.3) describing what's scoping `entries`.
   *  `entries` itself must already be pre-filtered by the caller; this prop is display-only
   *  (the chip + its ✕), never a second filtering pass. */
  filter?: EventLogFilter;
  onClearFilter?: () => void;
  /** Reverse console<->DAG coupling (§3.3): clicking a row whose event names a step pulses
   *  that node. Undefined in contexts with no DAG to pulse (e.g. the plain Events tab). */
  onRowStepClick?: (step: string) => void;
}

export function EventLog({
  entries,
  hideHeader = false,
  maxHeight = '180px',
  filter,
  onClearFilter,
  onRowStepClick,
}: EventLogProps) {
  const hasFilter = !!(filter?.jobId || filter?.step);

  return (
    <div class="event-log">
      {!hideHeader && (
        <div class="panel-header">
          Event Log
          <span style="float: right; font-weight: normal; text-transform: none; letter-spacing: 0">
            {entries.length > 0 ? `${entries.length} events` : 'waiting...'}
          </span>
        </div>
      )}
      {hasFilter && (
        <div class="event-log-filter-row">
          {filter?.jobId && (
            <span class="filter-chip">
              job: {filter.jobId.slice(0, 8)}…
            </span>
          )}
          {filter?.step && (
            <span class="filter-chip">
              step: {filter.step}
              {onClearFilter && (
                <button class="filter-chip-clear" onClick={onClearFilter} title="Clear step filter">
                  ✕
                </button>
              )}
            </span>
          )}
        </div>
      )}
      <div class="panel-body" style={{ maxHeight }}>
        {entries.length === 0 ? (
          <div class="empty-state" style="padding: 12px">
            {hasFilter ? 'No events match this filter yet' : 'Events will appear here as workflows execute'}
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={i}
              class={`log-entry ${entry.step && onRowStepClick ? 'log-entry-clickable' : ''}`}
              onClick={entry.step && onRowStepClick ? () => onRowStepClick(entry.step!) : undefined}
              title={entry.step && onRowStepClick ? `Pulse ${entry.step} on the DAG` : undefined}
            >
              <span class="log-time">{entry.timestamp}</span>
              <span class={`log-type ${entry.type}`}>{entry.type}</span>
              <span class="log-job">{entry.jobId}</span>
              <span class="log-detail">{entry.detail}</span>
              {entry.correlationId && (
                <span class="log-corr" title={entry.correlationId} style="color: #888; font-size: 0.8em; margin-left: 4px">
                  [{entry.correlationId.slice(0, 8)}]
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
