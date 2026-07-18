# DTM - Distributed Task Manager - Claude Code Project Guide

## Project Overview

Generic distributed task orchestration engine with pluggable workflows.

**Stack**: NestJS orchestrator + Lambda workers + PostgreSQL + Kafka + SQS
**Monorepo**: pnpm workspaces (`packages/`, `services/`, `tools/`, `workflows/`)

## Architecture (Critical Knowledge)

### Core Concepts
- **Workflow -> Job -> Steps**: Each workflow defines a set of steps with domain-appropriate names
- **WorkflowDefinition contract**: Injected at startup, not hardcoded. Lives in `workflows/<name>/workflow.config.ts`
- Steps can run in **parallel** when they have no dependencies
- **Modes**: Single (one entity per step), Fan-Out (discovery -> N child steps)

### Two-Phase Step Pattern
Each entity requires 2+ steps: Phase 1 (validate/fetch from source) -> Phase 2 (submit/push to target, with ACK).
Fan-out cascades add a Discovery step: Discover -> Phase1 x N -> Phase2 x N.
Each workflow uses domain-appropriate verbs: Order Processing uses Validate/Submit, IoT uses Register/Provision/Ingest/Publish, Infra uses Plan/Apply.

### Data Flow
```
API/Kafka -> Orchestrator -> SQS -> Lambda -> HTTP Callback -> Kafka Publish -> WAITING_FOR_ACK -> ACK -> Job Complete
```

### Data Access Boundary (FUNDAMENTAL)
**Orchestrator NEVER accesses workflow source databases directly.** Workers query source databases and return data via callback.

### Pluggable Workflow Architecture
The Orchestrator is a generic, domain-agnostic workflow engine. Workflow-specific logic lives entirely in:
- `workflows/<name>/workflow.config.ts` -- Step definitions, dependencies, cascade config
- `workflows/<name>/workers/` -- Lambda handlers that access source databases
- `workflows/<name>/source-db/` -- TypeORM entities for the source database
- `workflows/<name>/dev-tools/ack-defaults.ts` -- Dev ACK simulator payload generators

### Multi-Workflow Registry
The `WorkflowRegistryService` holds a `Map<string, WorkflowConfigService>` of all registered workflows:
- **Registration**: Workflows are scanned from `workflows/*/workflow.config.ts` at boot via `WorkflowLoaderModule.forRoot()`
- **Resolution**: All services resolve the correct workflow per-request via `job.workflowName`
- **Management API**: `GET /api/v1/workflows`, `POST /api/v1/workflows/:name/enable|disable`
- **Generic Job API**: `POST /api/v1/workflows/:workflowName/jobs` -- workflow-agnostic job creation

### Registered Workflows

| Workflow | Cascades | Steps | Showcases |
|----------|----------|-------|-----------|
| `order-processing` | 6 | 12 | Parallel root steps, single fan-out, optional cascades, multiple variants |
| `iot-sensor-pipeline` | 5 | 12 | Double/nested fan-out, feature flags, conditional steps, empty discovery |
| `infra-provisioning` | 7 | 15 | Deep cascade (5 levels), long ACK timeouts, wide parallel branches, cascade failure propagation |

## Databases

### Core DB (`dtm`)
- **Host port**: 5448 (container: 5432)
- **User**: dtm_user
- **Tables**: `dtm_jobs`, `dtm_steps`
- **Connect**: `docker exec dtm-db psql -U dtm_user -d dtm`

### Workflow Source DBs
Each workflow defines its own source database:

| Workflow | Container | Port | Database | User |
|----------|-----------|------|----------|------|
| order-processing | dtm-order-processing-source-db | 5449 | order_processing_db | order_user |
| iot-sensor-pipeline | dtm-iot-sensor-pipeline-source-db | 5450 | iot_sensor_pipeline_db | iot_user |
| infra-provisioning | dtm-infra-provisioning-source-db | 5451 | infra_provisioning_db | infra_user |

> ⚠️ **TWO live copies of every source DB exist — the Lambda workers do NOT read the containers above.** `deploy-workers` points `<WORKFLOW>_DB_HOST` at **`dtm-db`**, which hosts its own `order_processing_db` / `iot_sensor_pipeline_db` / `infra_provisioning_db`, created by `scripts/docker/init-all-databases.sh`. Since 2026-07-16 that script loads the **canonical seed files** (`workflows/*/source-db/init-scripts/01-schema-and-seed.sql`, mounted via `docker-compose.yml`) instead of an inlined copy — the inlined copy silently drifted and every worker-touching SE failed with "not found in source database" while the dedicated containers looked perfectly seeded. **Never inline seed SQL into init-all-databases.sh.** When debugging "row not found" from a worker, query `dtm-db`, not the dedicated container. Seed changes require wiping the `postgres_data` volume (dtm-db init scripts only run on first boot).

### Other Services
- **Orchestrator**: port 3002 (host) → 3000 (container). API base: `http://localhost:3002/api/v1`
- **Monitor Dashboard**: port 5173 (Vite dev server). Source: `apps/monitor/` (Preact + Vite terminal-themed UI). Start: `cd apps/monitor && pnpm dev`. Connects via WebSocket (`ws://localhost:3002/ws/events`) with REST polling fallback. **Phase 4b (multi-workflow):** persistent header `WorkflowSelector` (GET `/api/v1/workflows`, localStorage-persisted) filters the job table and preselects the Scenarios suite tab; per-workflow step DAG (client-built mermaid from GET `/api/v1/workflows/:name`'s `stepsByVariant` deps, SE-23); right-side `TabbedPanel` = SQS / Kafka Topics (GET `/api/v1/kafka/topics`, admin-client read-only, SE-20) / Events / Payloads (GET `/api/v1/jobs/:id`, now includes step `input`/`output`) / Throughput (GET `/api/v1/metrics/throughput?windowMinutes=&workflow=`, SE-21) / Flags (GET `/api/v1/workflows/:name/flags`, SE-22).
- **LocalStack**: port 4567 (SQS endpoint: `http://localhost:4567`)
- **Kafka**: port 9093 (host) → 29092 (internal broker)
- **Dev ACK Simulator**: port 3003 (host) → 3001 (container)
- **Kafka UI**: port 8090

### Lambda Worker Deployment Mode (IMPORTANT)
**Default: Poller mode.** ESM (Event Source Mapping) mode is DISABLED by default.

The free LocalStack version has known flakiness with ESM v2 (mixed mode race conditions,
container auto-restart conflicts). All development and testing uses **Poller mode** exclusively.

To enable ESM (only if you have a LocalStack Pro license):
```bash
export ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT=true
./scripts/local-env.sh deploy-workers --esm
```

See `docs/guides/DEPLOYMENT-MODES.md` for full details.

### Port Mapping & ORCHESTRATOR_URL
The orchestrator listens on port 3000 inside its container, mapped to **port 3002** on the host.
Workflow SE `helpers.sh` already defaults to the host-mapped port —
`ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:${ORCHESTRATOR_PORT_HOST:-3002}/api/v1}"` —
so running from the **host** (outside Docker) needs **no override**; this is what
`./setpoint-evals/run-all.sh --all-workflows` and a standalone
`bash workflows/order-processing/setpoint-evals/run-all.sh` both do by default (verified 2026-07-17).
Only override `ORCHESTRATOR_URL` if you've remapped the host port in `docker-compose.yml`:
```bash
ORCHESTRATOR_URL="http://localhost:<your-port>/api/v1" bash workflows/order-processing/setpoint-evals/run-all.sh
```
**Common pitfall**: SEs failing with HTTP 000 or connection refused usually means the stack isn't up, not a port mismatch.

## Key Configuration Files

| Purpose | File |
|---------|------|
| Workflow definition | `workflows/<name>/workflow.config.ts` |
| WorkflowDefinition interface | `packages/core/src/interfaces/workflow-definition.interface.ts` |
| Callback handling | `services/orchestrator/src/callback/callback.service.ts` |
| Fan-out orchestration | `services/orchestrator/src/orchestration/fan-out.service.ts` |
| Cascade publish | `services/orchestrator/src/orchestration/cascade-publish.service.ts` |
| ACK handling | `services/orchestrator/src/kafka/handlers/acknowledgement.handler.ts` |
| Orchestration brain | `services/orchestrator/src/orchestration/orchestration.service.ts` |
| Outcome rules (per-workflow) | `workflows/<name>/workflow.config.ts` (OUTCOME_RULES section) |
| Outcome evaluation | `services/orchestrator/src/workflow-loader/workflow-config.service.ts` (determineOutcome) |
| SQS poller queues | `tools/sqs-poller/src/poller.ts` |
| Dynamic queue discovery | `tools/sqs-poller/src/queue-discovery.ts` |
| Lambda handler registry | `tools/sqs-poller/src/handler-registry.ts` |
| Workflow registry | `services/orchestrator/src/workflow-loader/workflow-registry.service.ts` |
| Generic workflow endpoint | `services/orchestrator/src/ingestion/workflow.controller.ts` |
| Workflow management API | `services/orchestrator/src/workflow-loader/workflow-management.controller.ts` |
| Lambda deployment | `workflows/*/workers/scripts/deploy-to-localstack.js` |
| Core DB entities | `packages/database/src/entities/` |

## Glossary

See `docs/glossary.md` for the canonical DTM vocabulary (Workflow, Job, Step, Cascade, Item, Variant, etc.).

## Deep-Dive Guides & Diagrams

For detailed explanations beyond this summary, see:

### Architecture & Orchestration
| Guide | What It Covers |
|-------|---------------|
| `docs/guides/system-architecture.md` | Complete 9-section architecture breakdown (2270 lines) |
| `docs/guides/orchestration-decision-logic.md` | continueJob() decision tree, race conditions, debugging |
| `docs/guides/outcome-rules.md` | Cascade criticality, outcome rule evaluation |
| `docs/guides/step-status-machine.md` | Full state machine (10 states, transitions, terminal guards) |
| `docs/guides/race-condition-prevention.md` | 4 fixed race conditions with callback flow diagram |
| `docs/guides/workflow-definition-contract.md` | Every WorkflowDefinition field explained |
| `docs/guides/creating-a-workflow.md` | Step-by-step new workflow guide |

### Features & Capabilities
| Guide | What It Covers |
|-------|---------------|
| `docs/guides/FEATURES.md` | Simulated delays, deduplication, Kafka ACK, test options |
| `docs/guides/PER-REQUEST-DEDUPLICATION.md` | Deduplication system details |
| `docs/guides/MAINTENANCE-TASKS.md` | 4 maintenance tasks, scheduling, manual API, security gates |
| `docs/guides/feature-summary.md` | Quick feature overview |
| `docs/guides/request-lifecycle.md` | End-to-end request trace (API → Job → SQS → Worker → Callback → ACK) |
| `docs/guides/callback-contract.md` | Worker callback HTTP contract (request/response formats) |
| `docs/guides/database-schema-overview.md` | Core tables, columns, relationships, JSONB fields |

### Infrastructure & Operations
| Guide | What It Covers |
|-------|---------------|
| `docs/guides/DEPLOYMENT-MODES.md` | ESM vs Poller, standalone vs integrated, scaling |
| `docs/guides/DOCKER-ECOSYSTEM.md` | Docker layering, compose files, container dependencies |
| `docs/guides/LOCALSTACK-CONFIGURATION.md` | AWS emulation tuning (Lambda, SQS) |
| `docs/guides/ENV-FILES-USAGE.md` | Environment file configuration |
| `docs/guides/env-validation.md` | Env var validation, preflight checks |
| `docs/guides/KAFKA-CONNECTIVITY-FIX.md` | Kafka debugging |
| `docs/guides/api-version-configuration.md` | API versioning |

### Testing & Development
| Guide | What It Covers |
|-------|---------------|
| `docs/guides/retry-testing-examples.md` | Retry logic testing patterns |
| `docs/guides/worker-testing-guide.md` | Lambda worker development and testing |
| `docs/guides/quick-start-api-testing.md` | API testing examples |
| `docs/guides/quick-start-kafka-consumer.md` | Kafka consumer setup |

### Diagrams (`docs/diagrams/`)
| Diagram | Visualizes |
|---------|-----------|
| `architecture.mermaid` | High-level system overview |
| `architecture-detailed.mermaid` | Detailed module diagram |
| `continuejob-decision-tree.mermaid` | continueJob() 4-case flowchart |
| `step-status-state-machine.mermaid` | Step status transitions |
| `callback-flow-race-prevention.mermaid` | Race condition guards |
| `cascade-fk-flow.mermaid` | FK cascade injection sequence |
| `fan-out-lifecycle.mermaid` | Discovery → children → aggregation |
| `partial-success-flow.mermaid` | Partial success handling |
| `docker-layering.mermaid` | Docker Compose 4-layer architecture |
| `request-lifecycle.mermaid` | End-to-end request sequence |

## Orchestration Decision Logic (continueJob)

The "brain" of the system is `orchestration.service.ts` → `continueJob()`. Called after every step completion/failure, it decides what happens next.

### Decision Tree (4 Cases)

```
continueJob(jobId)
│
├── Fetch all steps, classify: completed, pending, failed, inProgress
│
├── Case 1: failedSteps > 0
│   ├── Skip pending steps whose dependencies failed (markDependentStepsAsSkipped)
│   ├── Re-check: any pending or in-progress left?
│   │   ├── All terminal → evaluateOutcome() → FAILED or PARTIAL_SUCCESS
│   │   ├── No pending, some in-progress → Wait for in-progress to finish
│   │   └── Still pending → Fall through to Case 4 (independent branches)
│
├── Case 2: all steps completed → completeJob() → COMPLETED
│
├── Case 3: in-progress steps exist AND no pending → Wait
│
└── Case 4: pending steps exist → findReadySteps() → delegate all ready
    ├── Single ready step → delegateStep()
    └── Multiple ready steps → delegateMultipleSteps()
```

### Key Concepts
- **completedSteps** includes COMPLETED and PARTIAL_SUCCESS (both satisfy dependencies)
- **inProgressSteps** includes DELEGATED, IN_PROGRESS, IN_PROGRESS_RETRYING, WAITING_FOR_ACK, WAITING_FOR_CHILDREN
- **WAITING_FOR_ACK is NOT completed** — dependent steps wait until ACK arrives
- **Independent branches**: When a step fails, other branches with satisfied dependencies still proceed (Case 1 falls through to Case 4)
- **Atomic delegation**: `claimForDelegation()` prevents double-delegation from concurrent `continueJob()` calls

### Outcome Rule Evaluation
When all steps are terminal and some failed, `evaluateOutcome()` runs:
1. Builds `JobContext` from step statuses and cascade configs
2. Evaluates workflow outcome rules in priority order (first match wins)
3. Returns FAILED, PARTIAL_SUCCESS, or COMPLETED based on cascade criticality
See `docs/guides/outcome-rules.md` for full details.

## Cascade Criticality & Outcome Rules

Workflows define cascade criticality in their `workflow.config.ts`:
- **Required** cascades (`criticality: 'required'`): Failure → job FAILED
- **Optional** cascades (`criticality: 'optional'`): Failure → job PARTIAL_SUCCESS

Example (order-processing): Customer and Order are required; LineItem, Payment, Shipment are optional.

Outcome rules are priority-ordered predicates evaluated after all steps reach terminal state:
```
Priority 10: critical-entity-failed  → FAILED (customer/order failed)
Priority 20: full-success            → COMPLETED (all cascades OK)
Priority 30: partial-success         → PARTIAL_SUCCESS (critical OK, optional failed)
Priority 100: fallback               → FAILED (safety net)
```

JobContext fields used by predicates: `cascadeCounts`, `failedCascadeCounts`, `attemptedCascades`, `emptyCascades`, `stepStatuses`.

## Step Status State Machine

### Terminal states (reject callbacks)
COMPLETED, WAITING_FOR_ACK, FAILED, SKIPPED, PARTIAL_SUCCESS

### Accepting states (process callbacks)
PENDING, DELEGATED, IN_PROGRESS, IN_PROGRESS_RETRYING, WAITING_FOR_CHILDREN

**Note**: `WAITING_FOR_CHILDREN` is used by discovery steps waiting for fan-out children. It is NOT terminal.

### Race Condition Guards
Four race conditions have been fixed. See `docs/guides/race-condition-prevention.md`.
- RC1-3 (Callback flow): Terminal-state guard, discovery deferral, ACK deferral
- RC4 (Delegation): Atomic `claimForDelegation()` prevents double-delegation from concurrent `continueJob()` calls

## TestOptions Architecture
Task-type-keyed: `Record<string, TestOptionSet>`
Each step type has 8 configurable fields: simDelay, failureAfter, failOnAttempts, failForItemIds, ackDelay, skipAck, crashBeforeAck, ackPayload.
Workers look up by stepType: `testOptions[message.stepType]`

## Setpoint Evals (SE) System

Two-tier hierarchy. Every SE dir is `SE-<NN>-<kebab-name>/` (zero-padded), filesystem-
autodiscovered — no hand-maintained eval lists. Core SEs carry per-SE README metadata
(`**Timeout**`, `**Isolation**: parallel-safe|destructive`, `**Category**`); a missing
README (the pre-v2 legacy workflow-SE estate) degrades to defaults rather than erroring.
Full contract: `server-config/docs/setpoint-eval-conventions.md`.

### Core SEs (`setpoint-evals/`) -- 28 tests
Test generic engine capabilities (retry, DLQ, deduplication, concurrency, maintenance tasks,
leader election, schema integrity, Setpoint Evals discovery/run API, DAG/activity endpoints).
Count grows with the engine — treat any number in prose as a snapshot, not a contract; the
directory listing is the source of truth (`ls setpoint-evals/ | grep ^SE-`).
```bash
./setpoint-evals/run-all.sh                        # Run all core SEs
./setpoint-evals/run-all.sh --all-workflows        # Run core + all workflow SEs
```

### Workflow SEs (`workflows/<name>/setpoint-evals/`) -- per-workflow tests, 9 each (27 total)
Test workflow-specific functionality (entity extraction, FK cascade, fan-out). Each suite's
`run-all.sh` is a 3-line delegator to the SAME core runner (`--dir` pointed at itself) —
no forked runner logic. Defaults to `--in-band` (sequential): these SEs share the core
`dtm_jobs`/`dtm_steps` tables with every other suite and were never verified concurrently.
Per-workflow SE catalogs (name, purpose, expected status) live in each workflow's own
README.md, not duplicated here.
```bash
./workflows/order-processing/setpoint-evals/run-all.sh        # order-processing SEs
./workflows/iot-sensor-pipeline/setpoint-evals/run-all.sh     # iot-sensor-pipeline SEs
./workflows/infra-provisioning/setpoint-evals/run-all.sh      # infra-provisioning SEs
```

### Helper Architecture (Two-Layer Chain)
```
setpoint-evals/shared/helpers.sh                              # Generic layer (initiate_job, poll_job, se_skip, qdelay)
workflows/<name>/setpoint-evals/shared/helpers.sh             # Workflow layer (adds workflow-specific helpers)
```

### Common Options
```bash
./setpoint-evals/run-all.sh --parallel          # Default: parallel-safe evals parallel, destructive sequential
./setpoint-evals/run-all.sh --in-band           # Sequential execution
./setpoint-evals/run-all.sh --max-parallel=8    # Limit concurrent tests (default: 6)
./setpoint-evals/run-all.sh --skip-purge        # Skip initial purge
./setpoint-evals/run-all.sh --skip-checks       # Skip preflight checks
./setpoint-evals/run-all.sh --category maintenance  # Run only SEs whose README declares this Category
./setpoint-evals/run-all.sh --all-workflows     # Include all workflow SEs
./setpoint-evals/run-all.sh --eval 01           # Run one SE (id or name substring); repeatable; --se is an alias
./setpoint-evals/run-all.sh --dir <path>        # Discover/run SEs under another directory (workflow delegation)
./setpoint-evals/run-all.sh --list              # Print discovered execution order, run nothing
./setpoint-evals/run-all.sh --quick             # Exports SE_QUICK=1 for SEs that opt in via README `**Quick**: yes`
```

Per-eval verdict (last line of each log, `VERDICT:<durationSeconds>`): `PASS` · `FAIL` ·
`TIMEOUT` · `SKIP` (test.sh exited 77 via `se_skip`) · `XFAIL`/`UPASS` (only for an SE
anchored `**Expected outcome:** EXPECTED-FAIL` in its README — failing as expected is
green `XFAIL`, unexpectedly passing is a red `UPASS` and fails the run).

### Parallel Tuning
```bash
./setpoint-evals/run-parallel-sweep.sh                        # Find optimal --max-parallel value
./setpoint-evals/run-parallel-sweep.sh --values "4 6 8 10 0"  # Test specific values
./setpoint-evals/run-parallel-sweep.sh --runs-per-value 3      # Multiple runs per value
```

## Continuous Integration

`.github/workflows/ci.yml` runs 4 real jobs on every PR + push to `master`, plus one
scheduled placeholder:

| Job | What it checks | Local equivalent |
|-----|-----------------|-------------------|
| `format-lint` | Prettier + type-aware ESLint (builds `packages/*` first — an unbuilt `@dtm/core` resolves `StepStatus.*` to `error` and produces false-positive unsafe-access lint failures) | `pnpm run build:packages && pnpm run format:check && pnpm run lint:check` |
| `unit-tests` | Orchestrator Jest suite | `cd services/orchestrator && npx jest` |
| `hygiene` | Public-repo vocabulary denylist scan, diff-scoped on PR/push (self-tests it can actually fail first) | `bash scripts/hygiene/scan.sh --self-test` then pipe a diff through `scripts/hygiene/scan.sh` |
| `se-structure` | SE README/mermaid layout, diff-scoped | `bash scripts/validate-se-readmes.sh --base <sha>` (or `--all` for the whole estate) |
| `se-full-stack-quick` | **Placeholder only** — echoes why it can't run (GitHub-hosted runners can't reliably host Kafka + 4x Postgres + LocalStack + Lambda). It intentionally claims nothing. | — |

**The real SE gate is NOT CI** — no GitHub-hosted job actually boots the stack and runs
the 55-eval estate. Per `docs/setpoint-eval-conventions.md`, that evidence is local
execution output pasted into the PR body: run
`./scripts/local-env.sh start --standalone --orchestrator`,
`./scripts/local-env.sh deploy-workers`, then
`./setpoint-evals/run-all.sh --all-workflows --quick` (or a workflow-scoped subset),
and paste the summary table. A PR with 4/4 CI jobs green but no pasted SE evidence has
NOT been verified — CI alone proves lint/build/unit/hygiene, not orchestration behavior.

## Scripts

| Command | Purpose |
|---------|---------|
| `./scripts/local-env.sh start` | Start all Docker services |
| `./scripts/local-env.sh stop` | Stop all Docker services |
| `./scripts/local-env.sh deploy-workers` | Build and deploy Lambda workers |
| `./scripts/local-env.sh deploy-workers --poller --count=5` | Deploy with poller mode |
| `./scripts/local-env.sh purge` | Purge all data (queues, DBs) |
| `./scripts/local-env.sh reset` | Full reset (purge + redeploy) |

## Docker Operations

### Container Naming Convention
All project containers use `dtm-` prefix (from `COMPOSE_PROJECT_NAME=dtm` in `.env`).
When listing containers, ALWAYS filter: `docker ps --filter "name=dtm-"`
NEVER stop/restart containers that don't have the `dtm-` prefix.

### Container Inventory

| Container | Service | Compose File |
|-----------|---------|--------------|
| dtm-orchestrator | API server (3002) | docker-compose.yml |
| dtm-db | Core DB (5448) | docker-compose.yml |
| dtm-order-processing-source-db | Order Processing DB (5449) | workflows/order-processing/docker-compose.order-processing.yml |
| dtm-iot-sensor-pipeline-source-db | IoT Sensor DB (5450) | workflows/iot-sensor-pipeline/docker-compose.iot-sensor-pipeline.yml |
| dtm-infra-provisioning-source-db | Infra Provisioning DB (5451) | workflows/infra-provisioning/docker-compose.infra-provisioning.yml |
| dtm-localstack | AWS emulator (4567) | docker-compose.workers.yml |
| dtm-dev-ack-simulator | ACK simulator (3003) | docker-compose.yml |
| dtm-kafka | Kafka broker (9093) | docker-compose.kafka.yml |
| dtm-zookeeper | Zookeeper | docker-compose.kafka.yml |
| dtm-kafka-ui | Kafka UI (8090) | docker-compose.kafka.yml |
| dtm-sqs-poller-{N} | SQS pollers (scalable) | docker-compose.workers.yml |

### LocalStack Restart Recovery
Restarting LocalStack wipes ALL state. Recovery:
1. Queues auto-recreate via init hook
2. Redeploy workers: `./scripts/local-env.sh deploy-workers --poller --count=10`

## Coding Standards

### Naming Conventions
- **TypeScript**: camelCase (variables), PascalCase (classes)
- **Database**: snake_case
- **Env vars**: SCREAMING_SNAKE_CASE
- **Files**: kebab-case
- **SQS queue names**: `<workflow-prefix>-<step-type>-<entity>` (e.g., `order-validate-customer`, `iot-discover-sensors`, `infra-apply-compute`). Each workflow uses a unique prefix to avoid collisions.
- **Workflow config exports**: camelCase of workflow name + `Workflow` suffix (e.g., `orderProcessingWorkflow`, `iotSensorPipelineWorkflow`, `infraProvisioningWorkflow`)
- **Datasource env vars**: `<WORKFLOW_SCREAMING_SNAKE>_DB_HOST` / `_DB_PORT` (e.g., `ORDER_PROCESSING_DB_HOST`, `IOT_SENSOR_PIPELINE_DB_HOST`, `INFRA_PROVISIONING_DB_HOST`). Used by workers and `local-env.sh` debug-server mode.

### pnpm Workspace Auto-Discovery
`pnpm-workspace.yaml` uses glob patterns (`workflows/*`, `workflows/*/source-db`, `workflows/*/workers`) so new workflow packages are automatically discovered. No manual edit to `pnpm-workspace.yaml` is needed when adding a new workflow.

### TypeScript Rules
- Use `interface` over `type` for object shapes
- Use TypeORM repositories, never raw SQL
- Use `class-validator` for DTO validation
- All Lambda workers must always callback (success or failure)

### Testing
- Unit tests: `cd services/orchestrator && npx jest`
- Core SEs: `./setpoint-evals/run-all.sh`
- Workflow SEs: `./workflows/order-processing/setpoint-evals/run-all.sh`
- All SEs: `./setpoint-evals/run-all.sh --all-workflows`

### Documentation Structure (Three-Layer Model)
- **Layer 1 - Core**: `docs/` -- Engine architecture, callback protocol, fan-out, cascade
- **Layer 2 - Workflow**: `workflows/<name>/docs/` -- Domain-specific schemas, entity dependencies
- **Layer 3 - SEs**: `setpoint-evals/` + `workflows/<name>/setpoint-evals/` -- Living documentation (each has README + diagrams)
- `CLAUDE.md` -- AI agent project guide
- `CHANGELOG/` -- Core engine change history
- `workflows/<name>/CHANGELOG/` -- Workflow-specific change history
- `DIFFICULTIES-LOG.md` -- **Live issue tracker (agent self-improvement)**. Only UNRESOLVED items. When an issue is resolved, DELETE the entry entirely — git history is the changelog. If a fix was quick (< 5 min), don't log it at all. If a fix reveals a reusable pattern, add it to the agent's memory files, not here.

## Workflow Directory

### order-processing
- **README**: `workflows/order-processing/README.md`
- **Workflow config**: `workflows/order-processing/workflow.config.ts`
- **Workers**: `workflows/order-processing/workers/` (12 handlers)
- **Source DB**: `workflows/order-processing/source-db/` (6 entities, port 5449)
- **SEs**: `workflows/order-processing/setpoint-evals/` (9 tests)
- **Showcases**: Parallel root steps, single fan-out, optional cascades, multiple variants (default + quick-order)

### iot-sensor-pipeline
- **README**: `workflows/iot-sensor-pipeline/README.md`
- **Workflow config**: `workflows/iot-sensor-pipeline/workflow.config.ts`
- **Workers**: `workflows/iot-sensor-pipeline/workers/` (12 handlers)
- **Source DB**: `workflows/iot-sensor-pipeline/source-db/` (5 entities, port 5450)
- **SEs**: `workflows/iot-sensor-pipeline/setpoint-evals/` (9 tests)
- **Showcases**: Double/nested fan-out, feature flags, conditional steps, empty discovery handling

### infra-provisioning
- **README**: `workflows/infra-provisioning/README.md`
- **Workflow config**: `workflows/infra-provisioning/workflow.config.ts`
- **Workers**: `workflows/infra-provisioning/workers/` (15 handlers)
- **Source DB**: `workflows/infra-provisioning/source-db/` (7 entities, port 5451)
- **SEs**: `workflows/infra-provisioning/setpoint-evals/` (9 tests)
- **Showcases**: Deep cascade FK chains (5 levels), long ACK timeouts (10min), wide parallel branches, cascade failure -> SKIPPED propagation

## Adding a New Workflow (Integration Checklist)

When creating a new workflow, these integration points **must** be updated beyond the workflow directory itself:

### 1. Workflow Directory (`workflows/<name>/`)
- `package.json` — name: `@dtm-workflows/<name>`, dependency on `@dtm/core`
- `tsconfig.json` — ES2020, CommonJS
- `workflow.config.ts` — exported named variable (e.g., `myWorkflowWorkflow`)
- `dev-tools/ack-defaults.ts` — ACK payload generators
- `source-db/` — TypeORM entities, datasource config, init SQL, own `package.json` (`@dtm-workflows/<name>-typeorm`)
- `workers/` — handler files, `index.ts` exporting `handlerMap: Record<string, handler>`, own `package.json` (`@dtm-workflows/<name>-workers`)
- `docker-compose.<name>.yml` — **MUST include `networks: dtm: external: true`** or DB won't be reachable
- `setpoint-evals/` — run-all.sh, shared/helpers.sh, test directories

### 2. SQS Poller Integration (`tools/sqs-poller/`)
- `src/queue-discovery.ts` — import workflow config, add to `WORKFLOW_CONFIGS` array
- `src/handler-registry.ts` — import `handlerMap`, spread into `handlerRegistry`
- `package.json` — add 3 optionalDependencies: `@dtm-workflows/<name>`, `<name>-workers`, `<name>-typeorm`
- `tsconfig.json` — add path mappings for all 3 packages (config, workers, typeorm). **Note**: `experimentalDecorators` and `emitDecoratorMetadata` must be `true` (already set) because typeorm entity `.ts` files are resolved via path mappings

### 3. local-env.sh (`scripts/local-env.sh`)
- Add `COMPOSE_<NAME>` variable pointing to the docker-compose file
- `start_standalone()` — add `docker compose up` for the new source DB
- `start_integrated()` — same
- `stop_all()` — add `docker compose down`
- `clean_all()` — add `docker compose down -v`
- Debug-server env vars — add `<NAME>_DB_HOST` and `<NAME>_DB_PORT`
- `show_access_urls()` — add DB port
- `show_help()` — add to service list

### 4. Documentation
- `CLAUDE.md` — update Registered Workflows table, Workflow Source DBs table, Container Inventory, Workflow Directory section, SE catalog
- `workflows/<name>/README.md` — document domain model, step DAG, capabilities showcased

### Template
Copy `workflows/00-template/` as a starting point. See existing workflows (especially `order-processing` as simplest) for reference.

## Cursor Rules Reference

AI assistant rules in `.cursor/*.mdc`:
- `architecture.mdc` -- DTM engine architecture (generic)
- `worker-writer.mdc` -- Worker development guide
- `testing.mdc` -- Testing standards
- `code-quality.mdc` -- Code quality
- `safety.mdc` -- Safety and security
- Plus workflow-specific rules in `workflows/<name>/.cursor/`

## Worker Callback Contract

Workers report progress via HTTP POST to the orchestrator.

### Endpoint
`POST /api/v1/callback/step-progress` (port 3002 from host, 3000 from container)

### Payload (`StepProgressDto`)
```typescript
{
  jobId: string;                    // UUID
  stepId: string;                   // UUID
  status: 'in_progress' | 'completed' | 'failed';
  output?: Record<string, unknown>; // For completed steps — step result data
  error?: string;                   // For failed steps
  recordsProcessed?: number;
  recordsFailed?: number;
  retryMetadata?: {
    sqsMessageId: string;
    sqsReceiveCount: number;
    processingTimeMs: number;
    isRetry: boolean;
  };
}
```

### Processing Flow
1. Guard: reject callbacks for terminal-state steps (prevents SQS re-delivery overwrites)
2. `in_progress` → update step status, return
3. `completed` → update step, check if ACK required → publish to Kafka → `WAITING_FOR_ACK`
4. `failed` → check retries remaining → exhaust retries → `FAILED` or wait for SQS retry
5. Call `continueJob()` to determine next steps

See `docs/guides/callback-contract.md` for full details.

## Database Schema (Core)

Two tables in `dtm` database:

### `dtm_jobs`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Job identifier |
| `workflow_name` | VARCHAR | Workflow config name (e.g., 'order-processing') |
| `type` | VARCHAR | Variant (e.g., 'default', 'quick-order') |
| `status` | ENUM | pending, processing, completed, partial_success, failed, cancelled |
| `payload` | JSONB | Filters, testOptions, featureFlags |
| `submitted_at` | TIMESTAMP | Job creation time |
| `started_at` | TIMESTAMP | Orchestration start |
| `completed_at` | TIMESTAMP | Job completion |
| `results` | JSONB | Final statistics (totalRecordsProcessed, etc.) |
| `error` | TEXT | Error message if failed |

### `dtm_steps`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Step identifier |
| `job_id` | UUID FK | Parent job |
| `step_value` | VARCHAR | Step name (e.g., 'ValidateCustomer') |
| `status` | ENUM | pending, delegated, in_progress, completed, failed, skipped, etc. |
| `input` | JSONB | Input parameters sent to worker |
| `output` | JSONB | Output data from worker callback |
| `sqs_message_id` | VARCHAR | SQS message tracking |
| `retry_count` / `max_retry_count` | INT | Retry tracking |
| `execution_history` | JSONB | Array of all attempt records |
| `kafka_published_at` | TIMESTAMP | When published to Kafka |
| `ack_received_at` | TIMESTAMP | When ACK arrived |
| `ack_metadata` | JSONB | ACK payload data (externalId, etc.) |
| `parent_step_id` | UUID FK | Parent step (fan-out children) |
| `child_index` | INT | Child position (0-based) |
| `child_item_id` | VARCHAR | Item ID for this child |
| `child_count` | INT | Total children (parent steps only) |

See `docs/guides/database-schema-overview.md` for full details including relationships and indexes.

## Feature Flags (Three-Layer Resolution)

```
Layer 1 (Lowest):  WorkflowDefinition.featureFlags.defaults
    ↓ overridden by
Layer 2:           Environment variables (FEATURE_FLAG_{KEY}=value)
    ↓ overridden by (gated by ENABLE_REQUEST_FEATURE_FLAGS=true)
Layer 3 (Highest): Per-request overrides in job payload
    ↑ only if key is in featureFlags.clientOverridable[]
```

Env var convention: camelCase flag → SCREAMING_SNAKE_CASE env var
Example: `enableDeduplication` → `FEATURE_FLAG_ENABLE_DEDUPLICATION`

## Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPOSE_PROJECT_NAME` | `dtm` | Docker container prefix |
| `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` | `true` (dev) | Allow testOptions delays in callbacks |
| `ENABLE_DEV_ACK_SIMULATOR` | `true` (dev) | Auto-ACK Kafka messages |
| `ENABLE_DEDUPLICATION` | `false` | Request deduplication |
| `ENABLE_REQUEST_FEATURE_FLAGS` | `true` (dev) | Allow per-request flag overrides |
| `MAINTENANCE_SCHEDULER_ENABLED` | `true` | Automatic maintenance task scheduling |
| `PUBLISH_EVENTS_TO_KAFKA` | `true` | Enable Kafka event publishing |
| `ORCHESTRATOR_CALLBACK_URL` | `http://orchestrator:3000` | Callback URL for workers (container context) |
| `KAFKA_BROKER` | `dtm-kafka:29092` | Kafka broker (container context) |
| `AWS_SQS_ENDPOINT` | `http://localstack:4566` | SQS endpoint (container context) |

See `docs/guides/ENV-FILES-USAGE.md` for full list and `docs/guides/env-validation.md` for validation rules.

## Debugging Quick Reference

### Database Inspection
```bash
# Check job status
docker exec dtm-db psql -U dtm_user -d dtm -c \
  "SELECT id, workflow_name, status, started_at FROM dtm_jobs ORDER BY submitted_at DESC LIMIT 5"

# Check step statuses for a job
docker exec dtm-db psql -U dtm_user -d dtm -c \
  "SELECT step_value, status, retry_count FROM dtm_steps WHERE job_id = '<JOB_ID>' ORDER BY step_value"

# Check workflow source DB (example: order-processing)
docker exec dtm-order-processing-source-db psql -U order_user -d order_processing_db -c \
  "SELECT * FROM customers LIMIT 5"
```

### Service Logs
```bash
docker logs dtm-orchestrator --tail 50 -f     # Orchestrator
docker logs dtm-dev-ack-simulator --tail 50 -f # ACK simulator
docker logs dtm-sqs-poller-1 --tail 50 -f     # SQS poller
```

### Kafka UI
Open `http://localhost:8090` — inspect topics, messages, consumer lag.

### Common Issues
| Symptom | Cause | Fix |
|---------|-------|-----|
| HTTP 000 / connection refused | Wrong port (3000 vs 3002) | Use `ORCHESTRATOR_URL="http://localhost:3002/api/v1"` |
| SE POST gets 404 `{"message":"Cannot POST /api/v1/workflows/...","error":"Not Found"}` (raw-Nest shape, NOT the orchestrator's `{"code":"NOT_FOUND",...}` filter shape) and nothing in `docker logs dtm-orchestrator` | **No `.env.local` in this checkout/worktree** → helpers fall back to `.env` → `ORCHESTRATOR_PORT=3000` (container-internal) → the request hits whatever else binds host port 3000 (e.g. connectivity-tester, a NestJS app that answers with a plausible 404) | `cp .env.local.example .env.local` — MANDATORY in every fresh worktree (gitignored files don't come along) |
| Worker fails "X not found in source database" while the dedicated source-db container clearly has the row | Workers read the `dtm-db` copies, not the dedicated containers (see Workflow Source DBs warning above) | Query `dtm-db`; if it's stale, wipe `postgres_data` volume and restart so init-all-databases.sh reloads the canonical seed files |
| Step stuck in WAITING_FOR_ACK | ACK not arrived from dev-ack-simulator | Check simulator logs, Kafka consumer lag |
| Step stuck in PENDING | Dependencies not met (check if parent is WAITING_FOR_ACK) | Wait for ACK or check continueJob() logs |
| SE timeout despite steps completing | ACK roundtrip takes ~5-30s | Increase poll timeout to 600s |
| Workers not receiving messages | LocalStack restarted | Redeploy: `./scripts/local-env.sh deploy-workers --poller --count=10` |
