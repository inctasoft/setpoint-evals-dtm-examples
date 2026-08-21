import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type {
  DtmEvent,
  JobState,
  StepState,
  StepStatus,
  SqsQueueStatus,
  EventLogEntry,
} from '../types/events';
import { useAgentForestStore } from '../state/agent-forest.store';

const MAX_LOG_ENTRIES = 200;
const MAX_RECONNECT_DELAY = 30000;
const POLL_INTERVAL_MS = 2000;

export interface DashboardState {
  jobs: Map<string, JobState>;
  queues: SqsQueueStatus[];
  eventLog: EventLogEntry[];
  connected: boolean;
  reconnecting: boolean;
}

export function useWebSocket(url: string) {
  const [state, setState] = useState<DashboardState>({
    jobs: new Map(),
    queues: [],
    eventLog: [],
    connected: false,
    reconnecting: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const makeLogEntry = (
    type: string,
    jobId: string,
    detail: string,
    correlationId?: string,
    step?: string,
  ): EventLogEntry => ({
    timestamp: new Date().toLocaleTimeString('en-GB'),
    type,
    jobId: jobId.slice(0, 8) + '...',
    jobIdFull: jobId,
    step,
    detail,
    correlationId,
  });

  const appendLog = (prev: DashboardState, entry: EventLogEntry) =>
    [entry, ...prev.eventLog].slice(0, MAX_LOG_ENTRIES);

  const handleEvent = useCallback((event: DtmEvent) => {
    setState((prev) => {
      const jobs = new Map(prev.jobs);

      switch (event.type) {
        case 'snapshot': {
          const newJobs = new Map<string, JobState>();
          for (const job of event.jobs) {
            newJobs.set(job.id, job);
          }
          return { ...prev, jobs: newJobs };
        }

        case 'sqs_status':
          return { ...prev, queues: event.queues };

        case 'job_created': {
          jobs.set(event.jobId, {
            id: event.jobId,
            workflow: event.workflow,
            variant: event.variant,
            status: 'processing',
            steps: event.steps || [],
            createdAt: event.timestamp,
          });
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry('job_created', event.jobId, event.workflow, event.correlationId),
            ),
          };
        }

        case 'job_completed': {
          const job = jobs.get(event.jobId);
          if (job) {
            jobs.set(event.jobId, {
              ...job,
              status: event.status,
              completedAt: event.timestamp,
              results: event.results,
            });
          }
          const detail = event.results
            ? `${event.status} (${(event.results.durationMs / 1000).toFixed(1)}s)`
            : event.status;
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry('job_completed', event.jobId, detail, event.correlationId),
            ),
          };
        }

        case 'step_started': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step ? { ...s, status: 'in_progress' as const } : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'step_started',
                event.jobId,
                event.step,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        case 'step_completed': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step
                ? {
                    ...s,
                    status: 'completed' as const,
                    duration: event.duration,
                  }
                : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'step_completed',
                event.jobId,
                `${event.step} (${event.duration}ms)`,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        case 'step_failed': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step ? { ...s, status: 'failed' as const, error: event.error } : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'step_failed',
                event.jobId,
                `${event.step}: ${event.error}`,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        case 'step_retrying': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step
                ? {
                    ...s,
                    status: 'in_progress_retrying' as const,
                    attempt: event.attempt,
                  }
                : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'step_retrying',
                event.jobId,
                `${event.step} attempt #${event.attempt}`,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        case 'step_skipped': {
          // Was previously UNHANDLED here (fell to default) — a skipped step's live status
          // never reached the dashboard, only a subsequent on-demand snapshot (the exact bug
          // storyboard F1/infra-cascade's payoff depends on not regressing: SE-27 §27.2 proves
          // the backend broadcasts this; this case is what makes the frontend actually apply it).
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step
                ? { ...s, status: 'skipped' as const, reason: event.reason }
                : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'step_skipped',
                event.jobId,
                `${event.step}: ${event.reason}`,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        case 'step_ack_waiting': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step ? { ...s, status: 'waiting_for_ack' as const } : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry('ack_waiting', event.jobId, event.step, event.correlationId, event.step),
            ),
          };
        }

        case 'step_ack_received': {
          const job = jobs.get(event.jobId);
          if (job) {
            const steps = job.steps.map((s) =>
              s.step === event.step ? { ...s, status: 'completed' as const } : s,
            );
            jobs.set(event.jobId, { ...job, steps });
          }
          return {
            ...prev,
            jobs,
            eventLog: appendLog(
              prev,
              makeLogEntry(
                'ack_received',
                event.jobId,
                event.step,
                event.correlationId,
                event.step,
              ),
            ),
          };
        }

        // Phase-C agent-tree plane: both envelopes route straight into the agent-forest FSM
        // store (live ingest / server-authoritative reconcile); the jobs state is untouched.
        case 'agent_event':
          useAgentForestStore.getState().actions.ingestEvent(event.event);
          return prev;

        case 'agent_forest':
          useAgentForestStore.getState().actions.reconcileForest(event.forest);
          return prev;

        default:
          return prev;
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setState((prev) => ({ ...prev, connected: true, reconnecting: false }));
      ws.send(JSON.stringify({ type: 'request_snapshot' }));
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as DtmEvent;
        handleEvent(event);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false, reconnecting: true }));
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), MAX_RECONNECT_DELAY);
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, handleEvent]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // REST API polling fallback — supplements WebSocket with job data from REST API.
  // Only polls when WebSocket is disconnected to avoid duplicate data.
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>();
  const connectedRef = useRef(false);
  // Keep connectedRef in sync with state
  connectedRef.current = state.connected;

  // 10-value parity with @dtm/core's StepStatus (dtm-video-v2 capability-spec.md §3.4) — this
  // REST-polling fallback path used to collapse SKIPPED into 'completed' and had no entries for
  // WAITING_FOR_CHILDREN/PARTIAL_SUCCESS (silently falling to 'pending'), the same
  // status-vocabulary drift the shared union was meant to kill, just on the leg nobody widened.
  const mapStepStatus = useCallback((status: string): StepStatus => {
    const map: Record<string, StepStatus> = {
      PENDING: 'pending',
      DELEGATED: 'delegated',
      IN_PROGRESS: 'in_progress',
      IN_PROGRESS_RETRYING: 'in_progress_retrying',
      WAITING_FOR_ACK: 'waiting_for_ack',
      WAITING_FOR_CHILDREN: 'waiting_for_children',
      COMPLETED: 'completed',
      FAILED: 'failed',
      SKIPPED: 'skipped',
      PARTIAL_SUCCESS: 'partial_success',
    };
    return map[status?.toUpperCase()] ?? 'pending';
  }, []);

  const pollApi = useCallback(async () => {
    // Skip polling when WebSocket is connected — live events handle updates
    if (connectedRef.current) return;
    try {
      // Fetch job list (proxy: /api/xxx → localhost:3002/xxx)
      const listRes = await fetch('/api/api/v1/jobs');
      if (!listRes.ok) return;
      const { jobs: jobList } = await listRes.json();
      if (!Array.isArray(jobList) || jobList.length === 0) return;

      // Fetch details for recent jobs (last 10)
      const recentJobs = jobList.slice(0, 10);
      const detailPromises = recentJobs.map(async (j: { id: string }) => {
        try {
          const res = await fetch(`/api/api/v1/jobs/${j.id}`);
          if (!res.ok) return null;
          return res.json();
        } catch {
          return null;
        }
      });
      const details = await Promise.all(detailPromises);

      setState((prev) => {
        const jobs = new Map(prev.jobs);
        for (const detail of details) {
          if (!detail?.id) continue;
          const steps: StepState[] = (detail.steps || []).map(
            (s: Record<string, unknown>, i: number) => ({
              step: (s.stepNumber as string) || `Step${i + 1}`,
              description: (s.description as string) || '',
              status: mapStepStatus(s.status as string),
              stepNumber: i + 1,
              error: (s.error as string) || undefined,
              attempt: (s.retryCount as number) || undefined,
            }),
          );
          jobs.set(detail.id, {
            id: detail.id,
            workflow: detail.workflowName || 'unknown',
            variant: detail.type || 'default',
            status: (detail.status || 'processing').toLowerCase(),
            steps,
            createdAt: detail.submittedAt || new Date().toISOString(),
            completedAt: detail.completedAt || undefined,
          });
        }
        return { ...prev, jobs };
      });
    } catch {
      // ignore polling errors
    }
  }, [mapStepStatus]);

  useEffect(() => {
    // Start polling immediately and then every POLL_INTERVAL_MS
    pollApi();
    pollTimerRef.current = setInterval(pollApi, POLL_INTERVAL_MS);
    return () => clearInterval(pollTimerRef.current);
  }, [pollApi]);

  return state;
}
