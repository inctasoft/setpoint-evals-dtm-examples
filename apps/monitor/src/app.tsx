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
import { ScenariosView } from './components/scenarios/scenarios-view';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;

type View = 'dashboard' | 'scenarios';

export function App() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState<View>('dashboard');

  const state = useWebSocket(WS_URL);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    // Dev-only escape hatch, mirrors the backend's DISABLE_AUTH (auth.guard.ts) —
    // that one bypasses the API guard, this one bypasses the frontend's own
    // SuperTokens gate, which DISABLE_AUTH alone does NOT reach (the monitor
    // still redirects to /auth on a session-less browser regardless of the
    // backend flag). Fails CLOSED: only the exact literal 'true' bypasses;
    // unset/'1'/'false'/anything else keeps the real gate. Required for
    // headless Playwright coverage of the monitor UI (no interactive Google
    // OAuth path exists for an ad-hoc dev port — see DIFFICULTIES-LOG.md).
    // NEVER set VITE_DISABLE_AUTH in a production build.
    if (import.meta.env.VITE_DISABLE_AUTH === 'true') {
      setAuthenticated(true);
      setLoading(false);
      return;
    }

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

  // A Scenarios "Run" success switches to the Dashboard with the new job selected
  // (improvement over the donor pattern, which left the operator to find it manually).
  const handleJobCreatedFromScenario = (jobId: string) => {
    setSelectedJobId(jobId);
    setView('dashboard');
  };

  return (
    <div class="dashboard">
      <Header connected={state.connected} />

      {/* Deliberately BELOW the header's own ~64px band — a later phase reserves that
          band for a subtitle; this toggle lives in its own slim bar underneath. */}
      <div class="view-tabs">
        <button
          class={`view-tab ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
        >
          Dashboard
        </button>
        <button
          class={`view-tab ${view === 'scenarios' ? 'active' : ''}`}
          onClick={() => setView('scenarios')}
        >
          Scenarios
        </button>
      </div>

      {view === 'scenarios' ? (
        <ScenariosView onJobCreated={handleJobCreatedFromScenario} />
      ) : (
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
      )}

      <EventLog entries={state.eventLog} />

      <div class="bottom-bar">
        <ConnectionStatus connected={state.connected} reconnecting={state.reconnecting} />
        <span>Jobs: {jobs.length} | Events: {state.eventLog.length}</span>
      </div>
    </div>
  );
}
