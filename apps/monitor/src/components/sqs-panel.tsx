import type { SqsQueueStatus } from '../types/events';

interface SqsPanelProps {
  queues: SqsQueueStatus[];
}

export function SqsPanel({ queues }: SqsPanelProps) {
  if (queues.length === 0) {
    return (
      <div class="empty-state">
        No SQS data yet
        <div style="margin-top: 8px; font-size: 11px">
          Queue status updates arrive via WebSocket
        </div>
      </div>
    );
  }

  // Only show queues with activity (messages available, in-flight, or in DLQ)
  const activeQueues = queues.filter(q => q.available > 0 || q.inFlight > 0 || q.dlq > 0);
  const idleCount = queues.length - activeQueues.length;

  const totalAvail = queues.reduce((s, q) => s + q.available, 0);
  const totalFlight = queues.reduce((s, q) => s + q.inFlight, 0);
  const totalDlq = queues.reduce((s, q) => s + q.dlq, 0);

  if (activeQueues.length === 0) {
    return (
      <div class="empty-state">
        All {queues.length} queues idle
        <div style="margin-top: 8px; font-size: 11px">
          Queues with messages will appear here
        </div>
      </div>
    );
  }

  return (
    <table class="sqs-table">
      <thead>
        <tr>
          <th>Queue</th>
          <th>Avail</th>
          <th>Flight</th>
          <th>DLQ</th>
        </tr>
      </thead>
      <tbody>
        {activeQueues.map(q => (
          <tr key={q.name}>
            <td title={q.name}>{q.name}</td>
            <td style={q.available > 0 ? 'color: var(--green)' : ''}>{q.available}</td>
            <td style={q.inFlight > 0 ? 'color: var(--blue)' : ''}>{q.inFlight}</td>
            <td class={q.dlq > 0 ? 'dlq-active' : ''}>{q.dlq}</td>
          </tr>
        ))}
        {idleCount > 0 && (
          <tr>
            <td colspan={4} style="color: var(--text-dim); font-size: 11px; padding-top: 4px">
              + {idleCount} idle queue(s) hidden
            </td>
          </tr>
        )}
        <tr style="border-top: 1px solid var(--border); font-weight: bold">
          <td>TOTAL</td>
          <td>{totalAvail}</td>
          <td>{totalFlight}</td>
          <td class={totalDlq > 0 ? 'dlq-active' : ''}>{totalDlq}</td>
        </tr>
      </tbody>
      {totalDlq > 0 && (
        <tfoot>
          <tr>
            <td colspan={4} style="color: var(--red); font-size: 11px; padding-top: 8px">
              ⚠️ {totalDlq} message(s) in Dead Letter Queues
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
