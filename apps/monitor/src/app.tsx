import { useState } from 'preact/hooks';
import { useWebSocket } from './hooks/use-websocket';
import { Header } from './components/header';
import { JobList } from './components/job-list';
import { JobDetail } from './components/job-detail';
import { SqsPanel } from './components/sqs-panel';
import { EventLog } from './components/event-log';
import { ConnectionStatus } from './components/connection-status';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;

export function App() {
  const state = useWebSocket(WS_URL);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const jobs = Array.from(state.jobs.values()).sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const selectedJob = selectedJobId ? state.jobs.get(selectedJobId) ?? null : jobs[0] ?? null;

  return (
    <div class="dashboard">
      <Header connected={state.connected} />

      <div class="panels">
        <div class="panel panel-left">
          <div class="panel-header">Active Jobs</div>
          <div class="panel-body">
            <JobList
              jobs={jobs}
              selectedId={selectedJob?.id ?? null}
              onSelect={setSelectedJobId}
            />
          </div>
        </div>

        <div class="panel panel-center">
          <div class="panel-header">Job Detail</div>
          <div class="panel-body">
            <JobDetail job={selectedJob} />
          </div>
        </div>

        <div class="panel panel-right">
          <div class="panel-header">SQS Queues</div>
          <div class="panel-body">
            <SqsPanel queues={state.queues} />
          </div>
        </div>
      </div>

      <EventLog entries={state.eventLog} />

      <div class="bottom-bar">
        <ConnectionStatus connected={state.connected} reconnecting={state.reconnecting} />
        <span>Jobs: {jobs.length} | Events: {state.eventLog.length}</span>
      </div>
    </div>
  );
}
