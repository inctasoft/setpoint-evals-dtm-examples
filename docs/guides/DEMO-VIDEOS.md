# Demo Video Recordings

Record videos of the DTM Operations Dashboard during workflow execution using Playwright.

## Prerequisites

1. **Infrastructure running** — `pnpm infra` (orchestrator + workers + DB + Kafka + SQS)
2. **Monitor dashboard running** — `cd apps/monitor && pnpm dev` (serves at http://localhost:5173)
3. **Chromium installed** — `npx playwright install chromium` (one-time)

## Quick Start

```bash
# Record ALL demo videos (4 tests: 3 individual workflows + 1 multi-job)
pnpm ste:playwright:demos

# Record a single workflow
pnpm ste:playwright:demo:order    # order-processing with retry recovery
pnpm ste:playwright:demo:iot      # iot-sensor-pipeline
pnpm ste:playwright:demo:infra    # infra-provisioning
pnpm ste:playwright:demo:multi    # all 3 workflows simultaneously
```

## Output

Videos are saved to:
```
ste-playwright/test-results/videos/
```

Each test produces a `.webm` video file (1280x900, Chromium recording).
Screenshots are also captured on test completion.

## How It Works

The `demo-videos` Playwright project:

1. Launches Chromium with video recording enabled
2. Opens the DTM Operations Dashboard at `http://localhost:5173`
3. Triggers workflow(s) via the orchestrator API
4. The dashboard updates in real-time via WebSocket (`/ws/events`)
5. Waits for job completion, then holds the final frame for 3-4 seconds
6. Saves the video file and screenshot

### Architecture

```
Playwright (browser)
  │  opens
  ▼
apps/monitor/           ◄──── WebSocket ────── orchestrator:3000/ws/events
  (Vite dev at :5173)                              │
                                                   │ broadcasts events
                                                   │
  Playwright (API client) ──── HTTP POST ──────► /api/v1/workflows/{name}/jobs
                                                   │
                                                   ▼
                                              SQS → Lambda workers → Callback
```

## Available Demos

| Demo | Script | What it shows |
|------|--------|---------------|
| Order Processing | `demo:order` | Retry recovery — steps fail twice then succeed |
| IoT Pipeline | `demo:iot` | Clean execution of sensor data pipeline |
| Infra Provisioning | `demo:infra` | Infrastructure stack provisioning flow |
| Multi-Job | `demo:multi` | All 3 workflows running concurrently |

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DASHBOARD_URL` | `http://localhost:5173` | Monitor dashboard URL |
| `ORCHESTRATOR_PORT_HOST` | `3002` | Orchestrator host port |

## Running Evals + Demos Together

```bash
# Run all core evals first, then record demos
pnpm ste:playwright:core && pnpm ste:playwright:demos

# Run everything (core + workflow evals + demos)
pnpm ste:playwright
```
