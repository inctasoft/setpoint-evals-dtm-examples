---
paths:
  - "docker-compose*"
  - "**/Dockerfile*"
  - "scripts/local-env.sh"
---
# Docker Rules

- Container prefix: `dtm-` (via COMPOSE_PROJECT_NAME=dtm)
- Orchestrator: port 3002 (host) → 3000 (container)
- Dev ACK Simulator: port 3003 (host) → 3001 (container)
- The ack simulator's dist/ is volume-mounted for dev iteration (build on host, restart container)
- Workflow config files are volume-mounted read-only from `workflows/{wf}/dist/`
- The old `front-end` service has been removed — use `apps/monitor/` instead
- Monitor dashboard runs via Vite dev server (port 5173), not Docker
- Use `--monitor` flag (not `--front-end`) with `local-env.sh start`
- Docker profiles: `db`, `orchestrator`, `dev-tools`, `poller` (no `web-ui`)
