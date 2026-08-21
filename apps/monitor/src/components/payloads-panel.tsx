import { useState, useEffect, useRef } from 'preact/hooks';
import type { JobDetailFull } from '../types/api';

const POLL_INTERVAL_MS = 5000;

interface PayloadsPanelProps {
  selectedJobId: string | null;
}

/**
 * "Payloads" tab — GET /api/v1/jobs/:jobId (input/output/ackMetadata added to
 * that response for exactly this tab). Generic over the step's own field
 * names — unlike the donor's PayloadsPanel, which hardcodes a STEP_TO_TOPIC
 * map for its migration-domain steps, this reads directly off the step
 * record so it works for ANY workflow.
 */
export function PayloadsPanel({ selectedJobId }: PayloadsPanelProps) {
  const [job, setJob] = useState<JobDetailFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setExpanded(new Set());

    if (!selectedJobId) {
      setJob(null);
      return;
    }

    const fetchJob = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/api/v1/jobs/${encodeURIComponent(selectedJobId)}`);
        if (res.ok) setJob(await res.json());
      } catch {
        // retry on next poll
      } finally {
        setLoading(false);
      }
    };

    fetchJob();
    pollRef.current = setInterval(fetchJob, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [selectedJobId]);

  if (!selectedJobId) {
    return <div class="empty-state">Select a job to view step payloads.</div>;
  }
  if (loading && !job) {
    return <div class="empty-state">Loading payloads…</div>;
  }
  if (!job) {
    return <div class="empty-state">Job not found.</div>;
  }

  const stepsWithPayload = job.steps.filter((s) => s.input || s.output || s.ackMetadata);

  if (stepsWithPayload.length === 0) {
    return <div class="empty-state">No step payloads captured yet for this job.</div>;
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div class="payloads-list">
      {stepsWithPayload.map((step) => {
        const isExpanded = expanded.has(step.id);
        return (
          <div key={step.id} class="payload-card">
            <div class="payload-card-header" onClick={() => toggle(step.id)}>
              <span class="payload-toggle">{isExpanded ? '▼' : '▶'}</span>
              <span class="payload-topic">{step.stepName}</span>
              <span class={`status ${step.status}`}>{step.status}</span>
              {step.ackMetadata?.success != null && (
                <span
                  class={`payload-ack ${step.ackMetadata.success ? 'payload-ack--ok' : 'payload-ack--fail'}`}
                >
                  {step.ackMetadata.success ? '✓ACK' : '✗ACK'}
                </span>
              )}
            </div>
            {isExpanded && (
              <div class="payload-card-body">
                {step.input && (
                  <>
                    <div class="payload-section-label">input</div>
                    <pre class="payload-preview">{JSON.stringify(step.input, null, 2)}</pre>
                  </>
                )}
                {step.output && (
                  <>
                    <div class="payload-section-label">output</div>
                    <pre class="payload-preview">{JSON.stringify(step.output, null, 2)}</pre>
                  </>
                )}
                {step.ackMetadata && (
                  <>
                    <div class="payload-section-label">ack_metadata</div>
                    <pre class="payload-preview">{JSON.stringify(step.ackMetadata, null, 2)}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
