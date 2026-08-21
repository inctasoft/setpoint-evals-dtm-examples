# Apps

Frontend applications for DTM.

## Contents

### `monitor/`

A terminal-themed real-time monitoring dashboard built with Vite + Preact. Displays job progress, step status, queue stats, and workflow execution in a retro terminal aesthetic.

**Features:**
- Real-time updates via WebSocket (`ws://localhost:3002/ws/events`)
- REST polling fallback when WebSocket disconnects
- Job timeline, step waterfall, and queue depth visualizations

**Running:**
```bash
cd apps/monitor && pnpm dev
# Opens at http://localhost:5173
```
