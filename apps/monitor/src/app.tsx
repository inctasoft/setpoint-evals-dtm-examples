import { useState, useEffect, useRef } from 'preact/hooks';
import Session from 'supertokens-auth-react/recipe/session';
import { canHandleRoute, getRoutingComponent } from 'supertokens-auth-react/ui';
import { ThirdPartyPreBuiltUI } from 'supertokens-auth-react/recipe/thirdparty/prebuiltui';
import { AuthPage } from './auth/AuthPage';
import { useWebSocket } from './hooks/use-websocket';
import { useWorkflows } from './hooks/use-workflows';
import { Header } from './components/header';
import { WorkflowSelector } from './components/workflow-selector';
import { JobList } from './components/job-list';
import { JobDetail } from './components/job-detail';
import { SqsPanel } from './components/sqs-panel';
import { EventLog } from './components/event-log';
import { KafkaPanel } from './components/kafka-panel';
import { PayloadsPanel } from './components/payloads-panel';
import { ThroughputPanel } from './components/throughput-panel';
import { FlagsPanel } from './components/flags-panel';
import { TabbedPanel } from './components/tabbed-panel';
import { WorkflowDag } from './components/workflow-dag';
import { DagFullscreen } from './components/dag-fullscreen';
import { ConnectionStatus } from './components/connection-status';
import { ScenariosView } from './components/scenarios/scenarios-view';
import { AgentTree } from './components/agent-tree';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/events`;
const SELECTED_WORKFLOW_KEY = 'dtm-monitor:selectedWorkflow';

type View = 'dashboard' | 'scenarios' | 'agents';

function loadPersistedWorkflow(): string | null {
  try {
    return localStorage.getItem(SELECTED_WORKFLOW_KEY) || null;
  } catch {
    return null; // localStorage unavailable (private mode, etc.) — degrade to "All"
  }
}

function persistWorkflow(workflow: string | null) {
  try {
    if (workflow) localStorage.setItem(SELECTED_WORKFLOW_KEY, workflow);
    else localStorage.removeItem(SELECTED_WORKFLOW_KEY);
  } catch {
    // best-effort — selection still works for the current session via state
  }
}

// Demo mode (ux-storyboards.md §4.1, "DX NOTE — making these demos repeatable on demand"):
// ?demo=1 (a) scopes the job list to jobs created after page load — kills the "leftover job
// from the previous demo" contradiction (critique F5) without DB surgery, (b) pins UI defaults
// so a take never inherits a prior manual session's state, (c) suppresses the DLQ banner.
// Nothing changes for real operators; generate-demo-media.sh is the only caller that sets it.
function isDemoMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch {
    return false;
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const demoMode = useRef(isDemoMode()).current;
  const pageLoadTime = useRef(Date.now()).current;

  const state = useWebSocket(WS_URL);
  const { workflows } = useWorkflows();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(() =>
    demoMode ? null : loadPersistedWorkflow(),
  );
  const [dagFullscreen, setDagFullscreen] = useState(false);
  const [eventFilterStep, setEventFilterStep] = useState<string | null>(null);
  const [flashToken, setFlashToken] = useState<{
    step: string;
    nonce: number;
  } | null>(null);

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

  // 'f' toggles the full-screen DAG while the Dashboard view is showing a workflow (§3.1 entry
  // point 2) — ignored while a form field has focus so it can't hijack typing in the job picker
  // or a search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (isTypingTarget(document.activeElement)) return;
      if (view !== 'dashboard' || !selectedWorkflow) return;
      setDagFullscreen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, selectedWorkflow]);

  // Exiting full-screen (any of the three affordances) never survives a workflow change.
  useEffect(() => {
    setDagFullscreen(false);
    setEventFilterStep(null);
  }, [selectedWorkflow]);

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
      <div
        class="dashboard"
        style="display:flex;align-items:center;justify-content:center;min-height:100vh"
      >
        <span style="color:#8b949e;font-family:monospace">Authenticating...</span>
      </div>
    );
  }

  if (!authenticated) return null;

  const allJobsUnfiltered = Array.from(state.jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const allJobs = demoMode
    ? allJobsUnfiltered.filter((j) => new Date(j.createdAt).getTime() >= pageLoadTime)
    : allJobsUnfiltered;
  const jobs = selectedWorkflow ? allJobs.filter((j) => j.workflow === selectedWorkflow) : allJobs;

  // Selection can point at a job that Just got filtered out by a workflow change —
  // fall back to the first visible job rather than showing a stale/invisible one.
  const selectedJob =
    (selectedJobId && jobs.find((j) => j.id === selectedJobId)) || jobs[0] || null;

  const handleSelectWorkflow = (workflow: string | null) => {
    setSelectedWorkflow(workflow);
    persistWorkflow(workflow);
  };

  // A Scenarios "Run" success switches to the Dashboard with the new job selected
  // (improvement over the donor pattern, which left the operator to find it manually).
  const handleJobCreatedFromScenario = (jobId: string) => {
    setSelectedJobId(jobId);
    setView('dashboard');
  };

  const handleRowStepClick = (step: string) =>
    setFlashToken((prev) => ({ step, nonce: (prev?.nonce ?? 0) + 1 }));

  const scopedEventLog = eventFilterStep
    ? state.eventLog.filter((e) => e.step === eventFilterStep)
    : state.eventLog;

  return (
    <>
      <div class="dashboard">
        <Header connected={state.connected} />

        {/* Deliberately BELOW the header's own ~64px band — this toggle + the workflow selector
            share the slim bar underneath. */}
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
          <button
            class={`view-tab ${view === 'agents' ? 'active' : ''}`}
            onClick={() => setView('agents')}
          >
            Agents
          </button>
          <WorkflowSelector
            workflows={workflows}
            selected={selectedWorkflow}
            onSelect={handleSelectWorkflow}
          />
        </div>

        {view === 'agents' ? (
          <AgentTree />
        ) : view === 'scenarios' ? (
          <ScenariosView
            onJobCreated={handleJobCreatedFromScenario}
            presetWorkflow={selectedWorkflow}
          />
        ) : (
          <>
            {selectedWorkflow && (
              <div class="dag-section">
                <div class="panel-header">
                  {selectedWorkflow} — step graph
                  <span class="dag-section-header-right">
                    {selectedJob?.workflow === selectedWorkflow && (
                      <span class="dag-legend">
                        <span class="dag-legend-item dag-legend-done">done</span>
                        <span class="dag-legend-item dag-legend-active">active</span>
                        <span class="dag-legend-item dag-legend-failed">failed</span>
                        <span class="dag-legend-item dag-legend-skipped">skipped</span>
                        <span class="dag-legend-item dag-legend-partial">partial</span>
                        <span class="dag-legend-item dag-legend-pending">pending</span>
                      </span>
                    )}
                    <button
                      class="dag-expand-btn"
                      title="Full-screen the step graph (f)"
                      onClick={() => setDagFullscreen(true)}
                    >
                      ⛶ Expand
                    </button>
                  </span>
                </div>
                {/* Whole strip is a "see it properly" affordance — click anywhere on the
                    background to expand (ux-storyboards.md §3.1 entry point 3). */}
                <div onClick={() => setDagFullscreen(true)}>
                  <WorkflowDag
                    workflowName={selectedWorkflow}
                    selectedJob={selectedJob}
                    flashToken={flashToken}
                  />
                </div>
              </div>
            )}

            <div class="panels">
              <div class="panel panel-left">
                <div class="panel-header">
                  {selectedWorkflow ? `${selectedWorkflow} Jobs` : 'All Jobs'} ({jobs.length})
                </div>
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
                <TabbedPanel
                  storageKey={demoMode ? undefined : 'right-panel'}
                  initialTabId={demoMode ? 'events' : undefined}
                  tabs={[
                    {
                      id: 'sqs',
                      label: 'SQS',
                      content: <SqsPanel queues={state.queues} demoMode={demoMode} />,
                    },
                    { id: 'kafka', label: 'Kafka', content: <KafkaPanel /> },
                    {
                      id: 'events',
                      label: 'Events',
                      content: (
                        <EventLog
                          entries={scopedEventLog}
                          hideHeader
                          maxHeight="none"
                          filter={eventFilterStep ? { step: eventFilterStep } : undefined}
                          onClearFilter={() => setEventFilterStep(null)}
                          onRowStepClick={selectedWorkflow ? handleRowStepClick : undefined}
                        />
                      ),
                    },
                    {
                      id: 'payloads',
                      label: 'Payloads',
                      content: <PayloadsPanel selectedJobId={selectedJob?.id ?? null} />,
                    },
                    {
                      id: 'throughput',
                      label: 'Throughput',
                      content: <ThroughputPanel workflow={selectedWorkflow} />,
                    },
                    {
                      id: 'flags',
                      label: 'Flags',
                      content: <FlagsPanel workflow={selectedWorkflow} />,
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}

        <div class="bottom-bar">
          <ConnectionStatus connected={state.connected} reconnecting={state.reconnecting} />
          <span>
            Jobs: {jobs.length} | Events: {state.eventLog.length}
          </span>
        </div>
      </div>

      {dagFullscreen && selectedWorkflow && (
        <DagFullscreen
          workflowName={selectedWorkflow}
          jobs={jobs}
          selectedJob={selectedJob}
          onSelectJob={setSelectedJobId}
          onClose={() => setDagFullscreen(false)}
          eventLog={state.eventLog}
        />
      )}
    </>
  );
}
