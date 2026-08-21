import { useEffect, useRef, useState } from 'preact/hooks';
import { WorkflowDag } from './workflow-dag';
import { StepDrilldown } from './step-drilldown';
import { EventLog } from './event-log';
import { usePanZoom } from '../hooks/use-pan-zoom';
import { useWorkflowDetail } from '../hooks/use-workflow-detail';
import type { JobState, EventLogEntry } from '../types/events';

interface DagFullscreenProps {
  workflowName: string;
  /** Jobs already filtered to this workflow, most-recent-first (app.tsx's existing filter). */
  jobs: JobState[];
  selectedJob: JobState | null;
  onSelectJob: (id: string) => void;
  onClose: () => void;
  eventLog: EventLogEntry[];
}

/**
 * Full-screen DAG overlay (ux-storyboards.md §3.1) — header bar + pan/zoom canvas + right-rail
 * drill-down + collapsible bottom console dock. Rendered from app.tsx next to `.dashboard` so
 * WS state flows unchanged (no separate data path). z-index sits below the demo caption band's
 * 2147483647 (terminal.css) — the caption stays on top by construction.
 */
export function DagFullscreen({ workflowName, jobs, selectedJob, onSelectJob, onClose, eventLog }: DagFullscreenProps) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [focusedStep, setFocusedStep] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(true);
  const [eventFilterStep, setEventFilterStep] = useState<string | null>(null);
  const [flashToken, setFlashToken] = useState<{ step: string; nonce: number } | null>(null);
  const panZoom = usePanZoom();
  const { detail } = useWorkflowDetail(workflowName);

  const variant =
    selectedJob && detail?.stepsByVariant[selectedJob.variant] ? selectedJob.variant : detail?.defaultVariant;
  const stepOrder = (variant && detail?.stepsByVariant[variant].map((s) => s.step)) || [];

  // Refs mirroring the above, updated SYNCHRONOUSLY during render (not via a useEffect) so the
  // single mount-only keydown listener below always reads the latest value. An effect-scoped
  // listener with [selectedStep, ...] in its deps looks correct but has a real race: preact's
  // effects flush on the NEXT frame, so two keydown events arriving within that window (e.g. a
  // fast two-level Esc — Playwright's back-to-back keyboard.press() calls land well under one
  // frame) can both hit the OLD listener closure. Caught by a real two-press Escape test, not
  // by a single-key check — see PR body / dag-fullscreen-drilldown.spec.ts.
  const selectedStepRef = useRef(selectedStep);
  selectedStepRef.current = selectedStep;
  const focusedStepRef = useRef(focusedStep);
  focusedStepRef.current = focusedStep;
  const stepOrderRef = useRef(stepOrder);
  stepOrderRef.current = stepOrder;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Reset per-node UI state when the workflow itself changes (job picker staying scoped to one
  // workflow means this only fires on a genuine re-entry, not on every job selection).
  useEffect(() => {
    setSelectedStep(null);
    setFocusedStep(null);
    setEventFilterStep(null);
  }, [workflowName]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Two-level Esc (§3.1): closes drill-down first, then full-screen. Tab cycles nodes (a11y +
  // lets a demo "walk" the graph); Enter opens drill-down on the focused node. Registered ONCE
  // (mount-only deps) — reads the refs above, never a stale closure over state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedStepRef.current) setSelectedStep(null);
        else onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && stepOrderRef.current.length > 0) {
        e.preventDefault();
        setFocusedStep((prev) => {
          const order = stepOrderRef.current;
          const idx = prev ? order.indexOf(prev) : -1;
          return order[(idx + 1 + order.length) % order.length];
        });
        return;
      }
      if (e.key === 'Enter' && focusedStepRef.current) {
        setSelectedStep(focusedStepRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleNodeSelect = (step: string) => {
    setSelectedStep(step);
    setFocusedStep(step);
  };

  const handleRowStepClick = (step: string) => setFlashToken((prev) => ({ step, nonce: (prev?.nonce ?? 0) + 1 }));

  const scopedEntries = eventFilterStep
    ? eventLog.filter((e) => e.step === eventFilterStep && (!selectedJob || e.jobIdFull === selectedJob.id))
    : selectedJob
      ? eventLog.filter((e) => e.jobIdFull === selectedJob.id)
      : eventLog;

  return (
    <div class="dag-fullscreen" role="dialog" aria-modal="true" aria-label={`${workflowName} — full-screen step graph`}>
      <div class="dag-fullscreen-header">
        <span class="dag-fullscreen-title">{workflowName}</span>
        <select
          class="dag-fullscreen-job-picker"
          value={selectedJob?.id ?? ''}
          onChange={(e) => onSelectJob((e.target as HTMLSelectElement).value)}
        >
          <option value="" disabled>
            Select a job…
          </option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.id.slice(0, 8)}… — {j.status}
            </option>
          ))}
        </select>
        <span class="dag-legend">
          <span class="dag-legend-item dag-legend-done">done</span>
          <span class="dag-legend-item dag-legend-active">active</span>
          <span class="dag-legend-item dag-legend-failed">failed</span>
          <span class="dag-legend-item dag-legend-skipped">skipped</span>
          <span class="dag-legend-item dag-legend-partial">partial</span>
          <span class="dag-legend-item dag-legend-pending">pending</span>
        </span>
        <button class="dag-fullscreen-toggle" title="Collapse (f)" onClick={onClose}>
          ⛶ Collapse
        </button>
        <button class="dag-fullscreen-close" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div class="dag-fullscreen-body">
        <div
          class="dag-fullscreen-canvas"
          ref={panZoom.containerRef}
          tabIndex={0}
          onPointerDown={panZoom.handlers.onPointerDown}
          onPointerMove={panZoom.handlers.onPointerMove}
          onPointerUp={panZoom.handlers.onPointerUp}
          onPointerCancel={panZoom.handlers.onPointerCancel}
          onKeyDown={panZoom.handlers.onKeyDown}
        >
          {/* The pan/zoom transform lives on THIS wrapper, outside WorkflowDag's key-replaced
              <pre> — a live status update never remounts this element, so drag/zoom state
              survives a WS event for free (capability-spec.md §3.1). */}
          <div
            class="dag-pan-zoom-wrapper"
            style={{
              transform: `translate(${panZoom.transform.x}px, ${panZoom.transform.y}px) scale(${panZoom.transform.scale})`,
            }}
          >
            <WorkflowDag
              workflowName={workflowName}
              selectedJob={selectedJob}
              size="full"
              onNodeSelect={handleNodeSelect}
              selectedStep={selectedStep}
              flashToken={flashToken}
            />
          </div>
          <div class="dag-zoom-controls">
            <button onClick={panZoom.zoomIn} title="Zoom in (+)">
              +
            </button>
            <button onClick={panZoom.zoomOut} title="Zoom out (-)">
              −
            </button>
            <button onClick={panZoom.reset} title="Fit to view (0)">
              ⤢
            </button>
          </div>
        </div>

        {selectedStep && (
          <div class="dag-fullscreen-rail">
            <StepDrilldown
              workflowName={workflowName}
              stepName={selectedStep}
              job={selectedJob}
              onClose={() => setSelectedStep(null)}
              onScopeEvents={setEventFilterStep}
            />
          </div>
        )}
      </div>

      <div class={`dag-fullscreen-dock ${dockOpen ? '' : 'collapsed'}`}>
        <button class="dock-toggle" onClick={() => setDockOpen((v) => !v)}>
          {dockOpen ? '▾' : '▴'} Console
        </button>
        {dockOpen && (
          <EventLog
            entries={scopedEntries}
            hideHeader
            maxHeight="160px"
            filter={eventFilterStep ? { step: eventFilterStep, jobId: selectedJob?.id } : { jobId: selectedJob?.id }}
            onClearFilter={() => setEventFilterStep(null)}
            onRowStepClick={handleRowStepClick}
          />
        )}
      </div>
    </div>
  );
}
