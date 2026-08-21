# Services

This directory contains the **production operational code** for DTM.

## Contents

### `orchestrator/`

The DTM Orchestrator is the core service — a NestJS application that manages distributed workflow execution.

**What it does:**
- Receives job requests via REST API
- Delegates steps to Lambda workers via SQS
- Processes worker callbacks and orchestrates step progression
- Manages fan-out (parent→child discovery) and cascade (FK injection)
- Publishes events to Kafka for external consumption
- Provides WebSocket gateway for real-time monitoring

**Key entry points:**
- `src/orchestration/orchestration.service.ts` — the "brain" (`continueJob()` decision tree)
- `src/callback/callback.service.ts` — processes worker callbacks
- `src/ingestion/ingestion.service.ts` — job submission API
- `src/websocket/events.gateway.ts` — WebSocket event broadcasting

**Running locally:**
```bash
# Via Docker (recommended)
./scripts/local-env.sh start --standalone --orchestrator

# Direct (debug mode)
pnpm dev
```

**Port mapping:** 3002 (host) → 3000 (container)

See `docs/guides/system-architecture.md` for the full architecture guide.
