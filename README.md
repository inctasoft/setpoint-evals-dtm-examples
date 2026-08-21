# Setpoint Evals — Watch a Workflow Engine Keep Its Promises

> Developed privately since **March 2026**; the public history begins with the **August 2026** relaunch as a single squashed snapshot.

> A **setpoint eval** (SE) is a small executable contract: a script that drives the real
> running system — real HTTP, real queues, real databases — waits for what actually
> happened, asserts on it, and prints one verdict: **PASS** or **FAIL**. One bit. A suite
> of them is a high-dimensional definition of done — the **setpoint** an AI coding agent,
> or a human team, is held to.

This repository exists to make that pattern easy to steal. The workflow engine inside is
**the example system** — real enough to be worth holding to promises (fan-out, retries,
dead-letter queues, cascading failures), small enough to run on a laptop. **63 setpoint
evals** surround it, and every one doubles as a plain-language contract that business and
engineering read on the same page. When a step is meant to fail, you watch it fail
*exactly where it should* — and nowhere else.

![A live distributed-task run: the failure of one step spreads across the graph while unaffected branches stay green.](docs/media/hero.gif)

## The pattern

### One directory per eval

Every SE is one directory holding the executable check and the contract it certifies —
CI enforces this layout on every PR:

```
setpoint-evals/SE-01-retry-transient-failure/
├── test.sh     # drives the LIVE stack — real requests, real queues — then asserts
└── README.md   # the contract: metadata, a plain-language (gherkin) scenario,
                # and a mermaid diagram of the flow under test
```

Readable by business, runnable by CI, writable by an agent. The README states the
setpoint in a sentence a stakeholder can read; the mermaid diagram draws the flow;
`test.sh` proves it against the running system — no mocks.

### SE-first, red-first

The evals are written **before** the feature is built — a handful per feature, and at
least one designed to fail against the plausible-but-wrong implementation, not just the
missing one. If you can't write that eval, you don't understand the feature yet;
discovering that costs minutes before the build and days after it.

A new SE must also go **red first**: run it against a world where the feature is broken
and watch it fail. A check born green has proven exactly one thing — that it can print
green.

### Fake-green defenses

An untested sensor is worse than no sensor, because it reads as one. Concrete defenses in
this repo against checks that lie:

- **Expected failures are first-class.** An SE anchored `**Expected outcome:**
  EXPECTED-FAIL` in its README goes green by *failing* (`XFAIL`) — and **unexpectedly
  passing is a red `UPASS` that fails the whole run**, so a sensor that stops sensing is
  caught the day it happens.
- **Honest skips.** An eval that cannot apply (an SQS-semantics SE under the ZeroMQ bus
  profile, say) exits through the `se_skip` sentinel and is reported `SKIP` — visible in
  the summary, never silently green.
- **Gates that self-test.** The CI hygiene job first proves it *can* fail (a deliberate
  positive control) before scanning anything; a gate that cannot go red is not a gate.
- **A structure gate.** `scripts/validate-se-readmes.sh` runs in CI and keeps every eval
  in the canonical layout above — undocumented tests can't accumulate beside the
  contract-bearing ones.
- **One verdict protocol.** The runner classifies every eval into
  `PASS · FAIL · TIMEOUT · SKIP · XFAIL · UPASS` and records the verdict as the last
  line of the eval's log — no ambiguous outcomes to argue about after the fact.

### Green merges

When the SEs are green and the pipeline is green, the work ships — nobody waits for a
human to skim the diff. Review moves from the code to the setpoint: humans decide what
should be true; machines verify that it is.

### Adopt it in your repo

1. Copy one SE directory as a template
   (`setpoint-evals/SE-01-retry-transient-failure/` is a simple one), plus the runner
   (`setpoint-evals/run-all.sh` + `setpoint-evals/shared/helpers.sh`) and the layout gate
   (`scripts/validate-se-readmes.sh`).
2. On your next feature, write the SEs before the source — and aim at least one at the
   plausible-but-wrong implementation. Watch each go red, then build until the suite is
   green.
3. Wire the layout gate into CI so the contract layer can't silently rot.

## The example system

The worked example is **DTM — a Distributed Task Manager**: a workflow engine that fans work
out, retries what's flaky, and reports precisely what happened. Three example workflows —
**order processing**, an **IoT sensor pipeline**, and **infrastructure provisioning** —
each stress a different edge: a partial failure, an explosive fan-out, a cascading collapse.
Below, each one is filmed running its most revealing scenario end-to-end.

## See it run

Three short recordings, straight from the live dashboard. Click a poster to play the video.

### 1. A payment fails — but the order survives

Ada's Beans Cafe set one rule: *a failed payment must never sink the order.* Here the card
never clears (it's a deliberately unresolvable payment). Watch the engine honour the rule in
real time — the customer, the order, and the shipment all complete, while the payment step
retries on its own, gives up honestly, and is marked failed. Only the work that genuinely
depended on that payment is skipped. The job lands **PARTIAL_SUCCESS**: it broke where it was
supposed to, and left everything else standing.

<a href="docs/media/order-processing-partial-payment-failure.mp4">
  <img src="docs/media/order-processing-partial-payment-failure-poster.png" width="100%"
       alt="Order-processing demo: the full-screen graph with the payment step retrying, its live attempt timeline open, and the order still completing." />
</a>

> ▶ [Play the order-processing demo](docs/media/order-processing-partial-payment-failure.mp4) (~1 min)

### 2. One health check becomes eighteen

Nobody knows in advance how much work a single request will become. Greenhouse 3 has three
sensors — and checking them fans out into eighteen individual readings, each tracked on its
own row from discovery to completion. Run it and watch the map *grow* as the engine learns the
fleet, then close itself once every branch has finished. The job lands **COMPLETED**, with
dozens of tracked steps that began life as six.

<a href="docs/media/iot-double-fan-out.mp4">
  <img src="docs/media/iot-double-fan-out-poster.png" width="100%"
       alt="IoT demo: a COMPLETED job whose six declared steps expanded into dozens of tracked readings across a nested fan-out." />
</a>

> ▶ [Play the IoT double-fan-out demo](docs/media/iot-double-fan-out.mp4) (~50 sec)

### 3. One failure, a contained blast radius

Break something on purpose and *watch* the blast radius instead of guessing it. Here the
compute stage is rigged to fail. The engine retries every instance before condemning it, then
the failure travels the map: storage, DNS, and the load balancer are skipped because they sat
on top of compute; the certificate falls two hops further down; and network and environment —
which never needed compute — stand untouched and green. The job lands **FAILED**, with a
picture of exactly what that means.

<a href="docs/media/infra-cascade-failure.mp4">
  <img src="docs/media/infra-cascade-failure-poster.png" width="100%"
       alt="Infra-provisioning demo: a FAILED job whose compute failure is skipped down the dependency chain while two independent branches survive." />
</a>

> ▶ [Play the infra cascade-failure demo](docs/media/infra-cascade-failure.mp4) (~1.5 min)

---

Every demo above is also an executable test: the same contract a stakeholder reads is the
setpoint the engine — and any AI coding agent working on it — is held to.

> Companion article: [Setpoint Evals: Giving AI Coding Agents a Long Horizon](https://inctasoft.com/blog/setpoint-evals).
> Theory: [The Setpoint Problem](https://inctasoft.com/blog/setpoint-problem).

The rest of this README is the practitioner's guide: clone it, run it, and copy the pattern.
The three workflows (`order-processing`, `iot-sensor-pipeline`, `infra-provisioning`) together
showcase fan-out processing, cascade FK injection, conditional steps, retries, dead-letter
queues, and end-to-end acknowledgement.

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

### Two ways to run it

The engine's two messaging legs — **tasks** (orchestrator → worker) and **events**
(publish/ack) — are pluggable. It runs on **AWS primitives** (SQS + Lambda via
LocalStack, Kafka via Zookeeper — the default above), or on **a single docker network
with zero brokers**: one environment variable swaps both legs to ZeroMQ.

```bash
BUS_PROFILE=zmq ./scripts/local-env.sh start --zmq
```

That profile replaces the SQS pollers with per-workflow `zmq-worker-host` containers
(ROUTER/DEALER task dispatch) and the Kafka ACK path with a PUB/PULL event bus —
Postgres stays the durability anchor, so nothing is silently lost. Mixed modes (zmq
tasks + Kafka events, or the reverse) are first-class. See
[docs/guides/bus-profiles.md](docs/guides/bus-profiles.md) for the full runbook:
profiles, capability matrix, env reference, and the dual-profile test procedure.

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
- **ZMQ Worker Host** (`tools/zmq-worker-host/`) — DEV ONLY: runs the same handlers in-process over ZeroMQ (`QUEUE_TRANSPORT=zmq`)
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

# 4. Run the full Setpoint Eval suite (63 evals: 36 core + 9 per workflow × 3 workflows)
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
# Core engine SEs (36 tests — retries, DLQ, deduplication, concurrency, maintenance, bus profiles)
./setpoint-evals/run-all.sh

# Per-workflow SEs (9 tests each)
./workflows/order-processing/setpoint-evals/run-all.sh
./workflows/iot-sensor-pipeline/setpoint-evals/run-all.sh
./workflows/infra-provisioning/setpoint-evals/run-all.sh

# Everything (63 evals total)
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

### Continuous Integration

CI (`.github/workflows/ci.yml`) runs entirely on GitHub-hosted runners — free for public
repos, and fork PRs execute inside GitHub's ephemeral per-job VMs, never on maintainer
infrastructure.

An SE-first repo still runs a conventional pipeline. The layers are complementary — unit
tests and Setpoint Evals answer different questions, and neither replaces the other:

| CI job | Layer | What it proves |
|---|---|---|
| Format & Lint | static analysis | prettier + type-aware ESLint across the workspace |
| Unit Tests (orchestrator) | conventional tests | the orchestrator's jest suite — fast, per-function/module contracts |
| Public-Repo Vocabulary Hygiene | repo hygiene | diff-scoped denylist scan, with a self-test proving the gate can fail |
| Setpoint Eval README/layout hygiene | SE structure | every SE ships the canonical `test.sh` + `README.md` + mermaid layout |

**Where the SEs fit.** The Setpoint Evals are this repo's centerpiece: long-horizon
acceptance criteria that drive the live Docker stack end to end. They are a *sensor layer*
— each SE states its setpoint in prose + mermaid, then asserts it against the running
system, which makes the suite legible to humans and AI agents alike. They deliberately do
**not** replace unit testing: unit tests pin functions and modules, SEs pin whole-system
behaviour. The converse also holds — packages without jest suites don't get placeholder
tests invented to pad CI; conventional coverage grows only where a real per-unit contract
exists.

CI runs the SE *structure* gate (every eval stays documented in the canonical layout), not
the full 63-eval suite: that suite stands up ~13 containers on 5 locally-built images and
takes 30-45 minutes a run, so it stays a local/on-demand gate
(`./setpoint-evals/run-all.sh --all-workflows`) until the proven-green CI dispatch job
tracked in issue #75 lands.

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
│   ├── sqs-poller/                 # DEV: polls SQS, dispatches to Lambdas
│   ├── zmq-worker-host/            # DEV: in-process workers over ZeroMQ (zmq task profile)
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
├── setpoint-evals/                 # Core engine SEs (36)
│   ├── run-all.sh                  # Suite runner (parallel + destructive phases)
│   ├── analyze-results.sh          # Result compactor
│   └── SE-01-retry-transient-failure/ # ... 36 individual evals
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
- [docs/guides/bus-profiles.md](docs/guides/bus-profiles.md) — aws / mixed / full-zmq profiles runbook
- [docs/guides/system-architecture.md](docs/guides/system-architecture.md) — engine architecture
- [docs/guides/race-condition-prevention.md](docs/guides/race-condition-prevention.md) — callback protocol & race-condition guards
- [docs/guides/database-schema.md](docs/guides/database-schema.md) — schema reference
- [setpoint-evals/README.md](setpoint-evals/README.md) — core engine SE catalog
- [CLAUDE.md](CLAUDE.md) — AI agent project guide

## License

MIT — see [LICENSE](LICENSE).
