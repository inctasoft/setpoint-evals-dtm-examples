# DTM Monitor Dashboard

Real-time operations dashboard for the DTM orchestration engine.

## Quick Start

```bash
# Option 1: Via local-env.sh
./scripts/local-env.sh monitor dashboard

# Option 2: Via local-env.sh start flag
./scripts/local-env.sh start --standalone --orchestrator --monitor

# Option 3: Manual
cd apps/monitor && pnpm dev
```

Open **http://localhost:5173** in your browser.

**Prerequisite:** The orchestrator must be running (either in Docker via `--orchestrator` or locally via VS Code).

## Architecture

```
Browser (port 5173)
  │
  ├── WebSocket: ws://localhost:5173/ws/events
  │     └── Vite proxy → ws://localhost:3002/ws/events (orchestrator)
  │
  └── REST fallback: http://localhost:5173/api/v1/jobs
        └── Vite proxy → http://localhost:3002/api/v1/jobs (orchestrator)
```

The Vite dev server proxies both WebSocket and REST requests to the orchestrator on port 3002. The WebSocket gateway is built into the NestJS orchestrator at `services/orchestrator/src/websocket/`.

## UI Panels

### Left Panel: Active Jobs
- Lists all active and recent jobs with workflow name, variant, and progress bar
- Click a job to view its details in the center panel
- Progress shows completed/total steps with color coding (yellow → cyan → green)
- Status icons: pending, processing, completed, failed, partial_success

### Center Panel: Job Detail
- Full job status, creation/completion timestamps, overall progress
- Steps table showing each step's status, duration, error details, retry count
- ACK-waiting indicators for steps pending external Kafka acknowledgement

### Right Panel: SQS Queues
- Real-time queue depths: available messages, in-flight, dead letter queue (DLQ)
- DLQ counts highlighted in red
- Updated every 5 seconds via orchestrator's `SqsStatusService`

### Bottom Panel: Event Log
- Scrollable log of the last 200 events with timestamps
- Color-coded by event type (green=completed, red=failed, yellow=retrying, etc.)
- Shows correlationId for cross-referencing with orchestrator logs

## WebSocket Events

The dashboard receives 10 event types from the orchestrator:

| Event | Description |
|---|---|
| `job_created` | New job initiated with step list |
| `job_completed` | Job reached terminal state |
| `step_started` | Step execution began |
| `step_completed` | Step finished successfully (includes duration) |
| `step_failed` | Step failed (includes error message) |
| `step_retrying` | Step being retried (includes attempt number) |
| `step_ack_waiting` | Step waiting for external Kafka ACK |
| `step_ack_received` | External ACK received for step |
| `sqs_status` | Queue depth snapshot (every 5s) |
| `snapshot` | Bulk job data (sent on initial connect) |

## Connection Resilience

- **WebSocket primary**: Real-time push events with sub-second latency
- **Auto-reconnect**: Exponential backoff (1s → 2s → 4s → ... → 30s max)
- **REST fallback**: 2-second polling of `/api/v1/jobs` when WebSocket is down
- **Status indicator**: Header shows "LIVE" (green) or "OFFLINE" (red)

On reconnect, the dashboard sends `{ type: 'request_snapshot' }` to reload all active jobs.

## Tech Stack

- **Preact** — Lightweight React alternative (3KB gzipped)
- **Vite** — Build tool and dev server with hot module replacement
- **TypeScript** — Type-safe event handling
- **Custom CSS** — Terminal-themed dark mode with no external UI frameworks

## File Structure

```
apps/monitor/src/
├── app.tsx                    # Main layout (3-panel + event log)
├── hooks/use-websocket.ts     # WebSocket state + reconnection + REST fallback
├── types/events.ts            # TypeScript interfaces for all DtmEvent types
├── components/
│   ├── header.tsx             # Title + live/offline status
│   ├── job-list.tsx           # Left panel
│   ├── job-detail.tsx         # Center panel
│   ├── step-row.tsx           # Individual step rendering
│   ├── sqs-panel.tsx          # Right panel
│   ├── event-log.tsx          # Bottom panel
│   ├── progress-bar.tsx       # Reusable progress component
│   └── connection-status.tsx  # Status dot + label
└── styles/terminal.css        # Terminal-theme styling
```
