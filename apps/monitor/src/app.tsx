import { useState, useEffect } from 'preact/hooks';
import Session from 'supertokens-auth-react/recipe/session';
import {
  canHandleRoute,
  getRoutingComponent,
} from 'supertokens-auth-react/ui';
import { ThirdPartyPreBuiltUI } from 'supertokens-auth-react/recipe/thirdparty/prebuiltui';
import { AuthPage } from './auth/AuthPage';
import { useWebSocket } from './hooks/use-websocket';
import { Header } from './components/header';
import { JobList } from './components/job-list';
import { JobDetail } from './components/job-detail';
import { SqsPanel } from './components/sqs-panel';
import { EventLog } from './components/event-log';
import { ConnectionStatus } from './components/connection-status';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;

export function App() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const state = useWebSocket(WS_URL);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    Session.doesSessionExist().then((exists) => {
      setAuthenticated(exists);
      setLoading(false);
      if (!exists && !window.location.pathname.startsWith('/auth')) {
        window.location.href = '/auth';
      }
    });
  }, []);

  // SuperTokens auth routes
  if (window.location.pathname.startsWith('/auth')) {
    const preBuiltUIList = [ThirdPartyPreBuiltUI];
    if (canHandleRoute(preBuiltUIList)) {
      return getRoutingComponent(preBuiltUIList) as any;
    }
    return <AuthPage />;
  }

  if (loading) {
    return (
      <div class="dashboard" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
        <span style="color:#8b949e;font-family:monospace">Authenticating...</span>
      </div>
    );
  }

  if (!authenticated) return null;

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
