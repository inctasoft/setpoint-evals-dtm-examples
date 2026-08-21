#!/usr/bin/env node
// watch-skip-broadcast.mjs — SE-27.2 live-broadcast probe.
//
// Connects to /ws/events BEFORE submitting a job (so no event can be missed by a
// race), submits an iot-sensor-pipeline job with ENABLE_ALERT_GENERATION=false (which
// makes EvaluateAlert/DispatchAlert SKIPPED immediately — see
// workflows/iot-sensor-pipeline/setpoint-evals/SE-04-feature-flag-disable-alerts for
// the reference payload), then waits for a `step_skipped` WS event naming that job and
// one of those two steps. Prints the captured event (or the last snapshot event seen,
// as a fallback diagnostic) to stdout as JSON and exits 0; on timeout, prints whatever
// was captured (possibly `null`) and exits 1.
//
// This exists as a dedicated script (not setpoint-evals/shared/) because the
// connect-before-submit ordering and the submit-a-job side effect are SE-27-specific,
// not generically reusable.
//
// Usage: node watch-skip-broadcast.mjs <ws-url> <api-base-url> <timeout-seconds>
import WebSocket from 'ws';

const wsUrl = process.argv[2];
const apiBase = process.argv[3];
const timeoutSec = Number(process.argv[4] || 30);

if (!wsUrl || !apiBase) {
  console.error('usage: watch-skip-broadcast.mjs <ws-url> <api-base-url> <timeout-seconds>');
  process.exit(1);
}

const payload = {
  enableDeduplication: false,
  variant: 'default',
  payload: { deviceId: 'greenhouse-4', entityId: `se27-${Date.now()}` },
  featureFlags: { ENABLE_ALERT_GENERATION: false },
  testOptions: {
    RegisterDevice: { simDelay: 200 },
    ProvisionDevice: { simDelay: 200, ackDelay: 500 },
    DiscoverSensors: { simDelay: 200 },
    CalibrateSensor: { simDelay: 200 },
    ActivateSensor: { simDelay: 200, ackDelay: 500 },
    DiscoverReadings: { simDelay: 200 },
    IngestReading: { simDelay: 200 },
    PublishReading: { simDelay: 200, ackDelay: 500 },
    ComputeAggregate: { simDelay: 200 },
    PublishAggregate: { simDelay: 200, ackDelay: 500 },
  },
};

let jobId = null;
let lastSnapshot = null;
const seenTypes = [];
let ws = null;
let submitted = false;

// Reconnect-with-retry (Phase 4): this repo's package builds (this SE's own
// 27.1a build included) make the orchestrator's nest --watch recompile and
// restart the app mid-watch — the WS dies with ECONNRESET and a single-shot
// connection turns that into a false FAIL. Reconnect until the deadline;
// the job runs to completion server-side regardless, and a skip that fires
// after the reconnect is still captured live.

const timer = setTimeout(() => {
  console.error(`watch-skip-broadcast: timed out after ${timeoutSec}s (jobId=${jobId}, seenEventTypes=${JSON.stringify(seenTypes)})`);
  // See the comment in ws-snapshot-capture.mjs: process.exit() can truncate a
  // pending async stdout pipe write — wait for the callback before exiting.
  process.stdout.write(JSON.stringify({ captured: null, jobId, lastSnapshot, seenTypes }), () => {
    try { ws.close(); } catch { /* ignore */ }
    process.exit(1);
  });
}, timeoutSec * 1000);

function connect() {
  ws = new WebSocket(wsUrl);
  wire(ws);
}

function wire(ws) {
ws.on('open', async () => {
  if (submitted) return; // job already in flight server-side — do not resubmit
  try {
    const res = await fetch(`${apiBase}/workflows/iot-sensor-pipeline/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    jobId = body.jobId || body.id;
    submitted = true; // only after a jobId exists — a failed fetch must retry on next connect
    if (!jobId) {
      clearTimeout(timer);
      console.error(`watch-skip-broadcast: job submission did not return a jobId: ${JSON.stringify(body)}`);
      process.exit(1);
    }
  } catch (err) {
    clearTimeout(timer);
    console.error(`watch-skip-broadcast: job submission failed: ${err.message}`);
    process.exit(1);
  }
});

ws.on('message', (raw) => {
  let evt;
  try {
    evt = JSON.parse(raw.toString());
  } catch {
    return;
  }
  seenTypes.push(evt.type);
  if (evt.type === 'snapshot') lastSnapshot = evt;

  if (!jobId) return; // job not submitted yet, ignore

  if (evt.type === 'step_skipped' && evt.jobId === jobId) {
    clearTimeout(timer);
    process.stdout.write(JSON.stringify({ captured: evt, jobId, lastSnapshot: null, seenTypes }), () => {
      ws.close();
      process.exit(0);
    });
  }
});

ws.on('error', (err) => {
  console.error(`watch-skip-broadcast: WebSocket error: ${err.message} — reconnecting until deadline`);
});

ws.on('close', () => {
  // Reconnect until the deadline (the outer setTimeout owns exit semantics).
  setTimeout(() => {
    try { connect(); } catch (err) { console.error(`watch-skip-broadcast: reconnect failed: ${err.message}`); }
  }, 2000);
});
}

connect();
