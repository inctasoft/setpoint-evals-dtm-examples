#!/usr/bin/env node
// ws-snapshot-capture.mjs — connect to the orchestrator's /ws/events, send
// request_snapshot, print the FIRST `snapshot` event's JSON to stdout, exit 0.
// Used by SE-27 (status-vocabulary parity, live snapshot capture) and SE-28
// (StepSnapshot.childCount) instead of duplicating a WS client in each test.sh.
//
// Usage: node ws-snapshot-capture.mjs <ws-url> <timeout-seconds>
//   node setpoint-evals/shared/ws-snapshot-capture.mjs ws://localhost:3002/ws/events 15
//
// Exit codes: 0 = snapshot captured (JSON on stdout), 1 = timeout/error (message on stderr).
import WebSocket from 'ws';

const url = process.argv[2];
const timeoutSec = Number(process.argv[3] || 15);

if (!url) {
  console.error('usage: ws-snapshot-capture.mjs <ws-url> <timeout-seconds>');
  process.exit(1);
}

const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error(`ws-snapshot-capture: timed out after ${timeoutSec}s waiting for a snapshot event`);
  try { ws.close(); } catch { /* ignore */ }
  process.exit(1);
}, timeoutSec * 1000);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'request_snapshot' }));
});

ws.on('message', (raw) => {
  let evt;
  try {
    evt = JSON.parse(raw.toString());
  } catch {
    return; // ignore malformed frames
  }
  if (evt.type === 'snapshot') {
    clearTimeout(timer);
    // IMPORTANT: process.exit() can truncate a large stdout write to a pipe —
    // Node's stdout write to a non-TTY pipe is async, and exit() force-closes
    // before the buffer flushes (reproduced: silent truncation at exactly 64KiB
    // with a ~20-job snapshot). Wait for the write callback before exiting.
    process.stdout.write(JSON.stringify(evt), () => {
      ws.close();
      process.exit(0);
    });
  }
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error(`ws-snapshot-capture: WebSocket error: ${err.message}`);
  process.exit(1);
});
