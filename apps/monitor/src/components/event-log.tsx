import type { EventLogEntry } from '../types/events';

interface EventLogProps {
  entries: EventLogEntry[];
}

export function EventLog({ entries }: EventLogProps) {
  return (
    <div class="event-log">
      <div class="panel-header">
        Event Log
        <span style="float: right; font-weight: normal; text-transform: none; letter-spacing: 0">
          {entries.length > 0 ? `${entries.length} events` : 'waiting...'}
        </span>
      </div>
      <div class="panel-body" style="max-height: 180px">
        {entries.length === 0 ? (
          <div class="empty-state" style="padding: 12px">
            Events will appear here as workflows execute
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} class="log-entry">
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
