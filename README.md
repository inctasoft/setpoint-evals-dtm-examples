# Setpoint Evals — A Working Example

> A real, runnable codebase built around **Setpoint Evals (SEs)** — shell-based end-to-end tests
> that act as long-horizon acceptance criteria for AI coding agents. Clone, run, copy the pattern.
>
> **Status:** clean-clone validated — `pnpm install && pnpm run build && ./scripts/local-env.sh start --standalone --orchestrator && ./scripts/local-env.sh deploy-workers && ./setpoint-evals/run-all.sh --all-workflows` runs **28/28 SEs to PASS** (13 core + 5 per workflow × 3 workflows) with zero manual intervention. Core engine: 9m33s.
>
> Companion article: [Setpoint Evals: Giving AI Coding Agents a Long Horizon](https://inctasoft.com/blog/setpoint-evals).
> Theory: [The Setpoint Problem](https://inctasoft.com/blog/setpoint-problem).

The example domain is **DTM — a Distributed Task Manager** with three pluggable workflows
(`order-processing`, `iot-sensor-pipeline`, `infra-provisioning`). Together they showcase
fan-out processing, cascade FK injection, conditional steps, retries, dead-letter queues,
and end-to-end acknowledgement.

## Architecture

```mermaid
graph LR
    A[Source System] -->|Read| B[Worker Pool]
    C[API / Kafka] -->|1 Request| D[Orchestrator]
    D <--> E[PostgreSQL]
    D -->|2 Delegate| F[SQS]
    F -->|3 Process| B
    B -->|4 Callback| D
    D -->|5 Publish| G[Kafka]
    G --> H[Target System]
```

**Flow**: Steps Delegate → Process → Callback repeat for each step in the workflow configuration.
Steps that publish to Kafka enter `WAITING_FOR_ACK`, blocking until the target system acknowledges.

### Key Features
- Parallel execution of independent steps
- Configurable step dependencies with domain-specific verbs
- Fan-out processing (Discovery step creates N child steps)
- Cascade FK injection (parent ACK data flows to child steps)
- Kafka-triggered workflows; deduplication; idempotency
- Simulated delays and failures for testing
- Automatic retries with Dead-Letter Queues
- Configurable outcome rules per workflow
- Two-tier **Setpoint Eval** suite (core engine + per-workflow)

### Components

This is a **pnpm monorepo**:

- **Orchestrator** (`services/orchestrator/`) — NestJS workflow engine
- **Lambda Workers** (`workflows/*/workers/`) — per-workflow Lambda handlers
- **SQS Poller** (`tools/sqs-poller/`) — DEV ONLY: polls SQS for local development
- **Dev ACK Simulator** (`tools/dev-ack-simulator/`) — DEV ONLY: simulates target-system ACKs
- **Core Packages** (`packages/`) — shared entities, Kafka producer/consumer, worker SDK
- **Workflows** (`workflows/`) — pluggable workflow definitions with workers and tests

## Quick Start

### Prerequisites

- Docker + Docker Compose
- Node.js 22+ and pnpm 10+
- AWS CLI (for LocalStack interaction from host scripts)

### Run it

```bash
# 1. Install + build (postinstall creates a default .env from .env.example)
pnpm install
pnpm run build

# 2. Start infrastructure + orchestrator (Kafka, Postgres, LocalStack, dev-ack-simulator)
./scripts/local-env.sh start --standalone --orchestrator

# 3. Deploy Lambda workers (poller mode = default; ESM mode requires LocalStack Pro)
./scripts/local-env.sh deploy-workers

# 4. Run the full Setpoint Eval suite (28 evals: 13 core + 5 per workflow × 3 workflows)
./setpoint-evals/run-all.sh --all-workflows

# 5. Access services (host ports)
# Orchestrator API: http://localhost:3002/api/v1
# Health:           http://localhost:3002/api/v1/health
# Swagger UI:       http://localhost:3002/api-docs
# Kafka UI:         http://localhost:8090
# Monitor (Vite):   http://localhost:5173 (start with --monitor)
```

> Step 1 runs the full build (packages → workflows → orchestrator → handlers → tools → frontend).
> The dev-ack-simulator and orchestrator bind-mount `workflows/*/dist` and `tools/*/dist` from
> the host, so an unbuilt tree means a crashloop. `local-env.sh start` will rebuild on demand,
> but running `pnpm run build` first is faster and easier to debug.
>
> `postinstall` only ever CREATES `.env` — it never refreshes one that already exists, so an
> aged checkout (an old `.env` that predates newly-added keys in `.env.example`) can silently
> boot with missing config. `local-env.sh start` self-heals this on every run: it diffs `.env`
> against `.env.example`, warns loudly about any missing keys, and auto-appends them (dev
> defaults, verbatim from `.env.example`) before starting anything. If a service is already
> running when this fires, recreate it explicitly — a bare `docker restart` does NOT re-read
> `.env` (`docker compose --env-file .env -f docker-compose.yml --profile db --profile
> orchestrator up -d --force-recreate orchestrator`).

### Deployment Modes

**Poller Mode** (default):
```bash
./scripts/local-env.sh deploy-workers --poller   # 10 sqs-poller replicas
```
Reliable on free LocalStack. The poller invokes deployed Lambdas via the LocalStack Lambda API.

**ESM Mode** (parallel via Lambda Event Source Mappings — requires LocalStack Pro):
```bash
export ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT=true
./scripts/local-env.sh deploy-workers --esm
```
The free LocalStack version has known flakiness with ESM v2; without the env var above the
script silently falls back to poller mode.

**Debug-Server Mode** (full breakpoint support):
```bash
./scripts/local-env.sh start --standalone        # infra only, no orchestrator container
./scripts/local-env.sh deploy-workers --debug-server
# Press F5 in VS Code to launch orchestrator + handlers locally with breakpoints
```

Switch between modes anytime without restarting infrastructure:
```bash
./scripts/local-env.sh deploy-workers --poller
./scripts/local-env.sh deploy-workers --esm
```

### Access Databases

DTM Core DB:
```
Host: localhost:5448  Database: dtm  Username: dtm_user
```
Workflow Source DBs:
```
Order Processing:    localhost:5449  (order_processing_db / order_user)
IoT Sensor Pipeline: localhost:5450  (iot_sensor_pipeline_db / iot_user)
Infra Provisioning:  localhost:5451  (infra_provisioning_db / infra_user)
```

## Setpoint Evals

A two-tier shell-based test suite. **The SEs are the long-horizon acceptance criteria** — they
post real requests to the running orchestrator, poll for state changes, and assert the
end-to-end behaviour. They run on the live Docker stack, not on mocks.

```bash
# Core engine SEs (13 tests — retries, DLQ, deduplication, concurrency, maintenance)
./setpoint-evals/run-all.sh

# Per-workflow SEs (5 tests each)
./workflows/order-processing/setpoint-evals/run-all.sh
./workflows/iot-sensor-pipeline/setpoint-evals/run-all.sh
./workflows/infra-provisioning/setpoint-evals/run-all.sh

# Everything (28 evals total)
./setpoint-evals/run-all.sh --all-workflows
```

A single SE:
```bash
./setpoint-evals/SE-01-retry-transient-failure/test.sh
```

Parallel mode is the default; sequential mode is `--in-band`.

### Unit tests
```bash
pnpm test          # services/orchestrator unit tests
pnpm test:cov      # with coverage
```

## Monitoring

```bash
# Health
curl http://localhost:3002/api/v1/health

# Logs
./scripts/local-env.sh logs --follow

# SQS / DB / API observers
./scripts/monitor-sqs-messages.sh
./scripts/monitor-jobs-db.sh
./scripts/monitor-events-api.sh
```

**API Documentation**: http://localhost:3002/api-docs (Swagger UI)

## Project Structure

```
.
├── services/
│   └── orchestrator/               # NestJS workflow engine
│       ├── src/
│       │   ├── ingestion/          # Job creation API
│       │   ├── orchestration/      # Workflow state machine (the brain)
│       │   ├── delegation/         # SQS delegation
│       │   ├── callback/           # Worker callbacks and Kafka publishing
│       │   ├── jobs/               # Job queries
│       │   ├── kafka/              # Kafka event handlers and triggers
│       │   └── auth/               # SuperTokens guard (DISABLE_AUTH=true in dev)
│       └── test/
├── tools/
│   ├── dev-ack-simulator/          # DEV: simulates target-system ACKs
│   └── sqs-poller/                 # DEV: polls SQS, dispatches to Lambdas
├── packages/
│   ├── core/                       # Shared interfaces, enums, DTOs
│   ├── database/                   # TypeORM entities for the core DB
│   ├── errors/                     # Error classes and codes
│   ├── kafka-producer/
│   ├── kafka-consumer/
│   └── worker-sdk/
├── workflows/
│   ├── 00-template/                # New workflow starter template
│   ├── order-processing/           # Parallel root steps, fan-out, optional entities
│   ├── iot-sensor-pipeline/        # Nested fan-out, feature flags, conditional steps
│   ├── infra-provisioning/         # Deep cascade, long ACK timeouts, wide parallel branches
│   └── plan-execution/             # Plan-execution workflow (chunked execution)
├── setpoint-evals/                 # Core engine SEs (13)
│   ├── run-all.sh                  # Suite runner (parallel + destructive phases)
│   ├── analyze-results.sh          # Result compactor
│   └── SE-01-retry-transient-failure/ # ... 13 individual evals
├── setpoint-evals-playwright/      # Optional Playwright-based UI evals
├── docs/                           # Architecture & operations guides
├── scripts/                        # CLI tools
├── CLAUDE.md                       # AI agent project guide
├── docker-compose.yml              # Base infrastructure
├── docker-compose.kafka.yml        # Kafka services
└── docker-compose.workers.yml      # Lambda workers and SQS poller
```

## Development

```bash
# Start full stack
./scripts/local-env.sh start --standalone --orchestrator

# Stop / purge / reset
./scripts/local-env.sh stop
./scripts/local-env.sh purge       # Clear DB only
./scripts/local-env.sh purge --full # + SQS + Kafka
./scripts/local-env.sh reset        # Purge + redeploy

# pnpm workspace
pnpm install                                       # always from root
pnpm --filter "@dtm/orchestrator" run start:dev   # run a single package
pnpm run build                                     # build everything
```

### Docker container naming
All project containers use the `dtm-` prefix. Always filter when listing:
```bash
docker ps --filter "name=dtm-"
```
Never stop / restart containers without the `dtm-` prefix — they belong to other projects.

### LocalStack recovery
Restarting LocalStack wipes ALL state (queues, Lambdas). To recover:
```bash
./scripts/local-env.sh deploy-workers --poller --count=10
docker restart dtm-orchestrator
```

## Documentation

- [docs/MASTER-INDEX.md](docs/MASTER-INDEX.md) — use-case-based navigation
- [docs/guides/system-architecture.md](docs/guides/system-architecture.md) — engine architecture
- [docs/guides/race-condition-prevention.md](docs/guides/race-condition-prevention.md) — callback protocol & race-condition guards
- [docs/guides/database-schema.md](docs/guides/database-schema.md) — schema reference
- [setpoint-evals/README.md](setpoint-evals/README.md) — core engine SE catalog
- [CLAUDE.md](CLAUDE.md) — AI agent project guide

## License

MIT — see [LICENSE](LICENSE).
