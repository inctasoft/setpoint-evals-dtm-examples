# Bus Profiles — aws, mixed modes, and full-zmq

The bus-agnosticism program made the engine's two messaging legs **pluggable**:

- **Tasks** (step dispatch, orchestrator → worker) travel a `QueueTransport`
  (`services/orchestrator/src/transport/`): `sqs` (default), `cloud-tasks`, or `zmq`.
- **Events** (transformed-data publishes, job lifecycle, acknowledgements) travel an
  `EventBus` (`services/orchestrator/src/event-bus/`): `kafka` (default) or `zmq`.

The two abstractions are disjoint by design — any task transport composes with any event
bus. This page is the operator's map: what each profile is, how to bring it up, what each
transport honestly declares, and the two operational hazards that will bite you if you
skip them.

## The profiles

| Profile | Tasks | Events | Brokers required |
|---------|-------|--------|------------------|
| **aws** (default) | SQS via LocalStack + sqs-pollers + Lambda workers | Kafka + Zookeeper | LocalStack, Kafka, Zookeeper (+ Kafka UI) |
| **zmq-tasks + kafka-events** (mixed) | zmq ROUTER/DEALER + `zmq-worker-host` containers | Kafka + Zookeeper | Kafka, Zookeeper |
| **sqs-tasks + zmq-events** (mixed) | SQS via LocalStack + sqs-pollers | zmq PUB/PULL + dev-ack-simulator zmq client | LocalStack |
| **full-zmq** | zmq ROUTER/DEALER + `zmq-worker-host` containers | zmq PUB/PULL + dev-ack-simulator zmq client | **none — a single docker network** |

Mixed modes are first-class: `QUEUE_TRANSPORT` and `EVENT_BUS` are independent switches.
Only the two listed defaults (`aws`, `zmq`) have an umbrella name (see below).

## `BUS_PROFILE` vs per-var env (precedence)

`BUS_PROFILE` is the umbrella switch for the two common cases:

- `BUS_PROFILE=zmq` expands to `QUEUE_TRANSPORT=zmq` + `EVENT_BUS=zmq`
- `BUS_PROFILE=aws` is today's world (sqs + kafka)

Precedence — **explicit per-var env ALWAYS wins over the umbrella**, which wins over the
built-in defaults:

```
QUEUE_TRANSPORT / EVENT_BUS   >   BUS_PROFILE   >   defaults (sqs / kafka)
```

So `BUS_PROFILE=zmq` + `EVENT_BUS=kafka` is exactly the Phase 2 mixed mode, and an
unknown `BUS_PROFILE` value fails the boot loudly. The expansion happens at process
start in `services/orchestrator/src/config/bus-profile.ts` (and the matching shim in the
dev-ack-simulator); per-var defaults are validated by joi in
`services/orchestrator/src/config/config.validation.ts`.

## Bring-up per profile

### aws (default)

```bash
pnpm install && pnpm run build
./scripts/local-env.sh start --standalone --orchestrator
./scripts/local-env.sh deploy-workers          # poller mode is the default
```

### zmq-tasks + kafka-events (mixed mode)

```bash
# .env: QUEUE_TRANSPORT=zmq   (or QUEUE_TRANSPORT=zmq docker compose --env-file ...)
docker compose --env-file .env \
  -f docker-compose.yml -f docker-compose.kafka.yml -f docker-compose.zmq.yml \
  --profile db --profile orchestrator --profile dev-tools --profile kafka \
  --profile zmq-tasks up -d
```

### full-zmq (zero brokers)

```bash
# One command (sets BUS_PROFILE=zmq through the compose passthrough):
BUS_PROFILE=zmq ./scripts/local-env.sh start --zmq

# …or by hand — note what is NOT included: no docker-compose.kafka.yml,
# no docker-compose.workers.yml, no sqs-pollers:
printf '\nBUS_PROFILE=zmq\n' >> .env
docker compose --env-file .env -f docker-compose.yml -f docker-compose.zmq.yml \
  --profile db --profile orchestrator --profile dev-tools --profile zmq-tasks up -d
```

The full-zmq container set is just `dtm-db`, `dtm-orchestrator`,
`dtm-dev-ack-simulator` (zmq client), and `dtm-zmq-worker-host-<workflow>-<n>`
(plus the per-workflow source DBs). No `dtm-kafka`, `dtm-zookeeper`, `dtm-kafka-ui`,
`dtm-localstack`, or `dtm-sqs-poller-*`.

## Capability matrix (what each transport honestly declares)

Consumers branch on these declared capabilities, never on the concrete class. The
declarations live in the transports themselves and are pinned by jest
(`transport-capabilities.spec.ts`, `event-bus.interface.spec.ts`).

### Task transports (`TaskTransportCapabilities`)

| Capability | SQS (`SqsTransport`) | Cloud Tasks (`CloudTasksTransport`) | ZeroMQ (`ZmqTransport`) |
|------------|----------------------|-------------------------------------|-------------------------|
| `stats` | `native` (GetQueueAttributes) | `none` (no depth API — panel shows nothing) | `native` (transport-owned buffer + receipt-ack depth) |
| `redelivery` | `bus` (visibility-timeout redrive) | `bus` (retryConfig) | `orchestrator` (redelivery engine, `dtm_steps` leases) |
| `attemptCounter` | `native` (ApproximateReceiveCount) | `synthetic` | `synthetic` (`dtm_steps.attempt_count` injected per dispatch) |
| `dlq` | `native` (redrive policy → DLQ) | `table` | `table` (`dtm_dead_letters` via the engine) |

The zmq task transport is the first one that activates the **redelivery engine**
(`redelivery: 'orchestrator'`): it re-dispatches lease-expired steps and dead-letters
attempt-exhausted ones into `dtm_dead_letters`. The DLQ column in its status feed is
honestly `0` — dead letters are table rows, not a per-queue bus structure.

### Event buses (`EventBusCapabilities`)

| Capability | Kafka (`KafkaEventBus`) | ZeroMQ (`ZmqEventBus`) |
|------------|--------------------------|-------------------------|
| `droppedPublishRecovery` | `bus` (brokered durability; the 30-min stuck-ack task is the only net) | `orchestrator` (PUB/SUB drops silently with no subscriber; the **event-republish scan** re-publishes un-ACKed steps past `EVENT_REPUBLISH_LEASE_SECONDS`) |

The zmq event bus is honest about fire-and-forget: `publish()` reports acceptance, not
delivery. Reliability comes from the republish scan, never from the socket.

## Environment variable reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `BUS_PROFILE` | unset | Umbrella: `zmq` → `QUEUE_TRANSPORT=zmq` + `EVENT_BUS=zmq`; `aws` = today |
| `QUEUE_TRANSPORT` | `sqs` | Task transport: `sqs` · `cloud-tasks` · `zmq` |
| `EVENT_BUS` | `kafka` | Event bus: `kafka` · `zmq` |
| `ZMQ_TASKS_ENDPOINT` | `tcp://0.0.0.0:5557` | Orchestrator ROUTER bind (tasks); worker hosts connect to `tcp://orchestrator:5557` |
| `ZMQ_TASK_ACK_TIMEOUT_MS` | `2000` | Receipt-ack wait per zmq task dispatch |
| `ZMQ_WORKER_SILENCE_MS` | `15000` | Heartbeat silence after which a zmq worker is marked dead (size ~3× the heartbeat interval) |
| `ZMQ_WORKER_SWEEP_INTERVAL_MS` | `5000` | Worker-registry sweeper cadence |
| `ZMQ_HEARTBEAT_INTERVAL_MS` | `5000` | Worker-host heartbeat cadence (worker-host containers) |
| `ZMQ_TASKS_PORT_HOST` | `5557` | Optional host port mapping for the ROUTER (debugging) |
| `ZMQ_EVENTS_ENDPOINT` | `tcp://0.0.0.0:5558` | Orchestrator PUB bind (events out); subscribers connect to `tcp://orchestrator:5558` |
| `ZMQ_ACKS_ENDPOINT` | `tcp://0.0.0.0:5559` | Orchestrator PULL bind (acks in); ack publishers connect to `tcp://orchestrator:5559` |
| `ZMQ_EVENTS_PORT_HOST` | `5558` | Optional host port mapping for the PUB socket |
| `ZMQ_ACKS_PORT_HOST` | `5559` | Optional host port mapping for the PULL socket |
| `EVENT_REPUBLISH_LEASE_SECONDS` | `60` | Un-ACKed publish age before the event-republish scan re-publishes |
| `EVENT_REPUBLISH_SCAN_FORCE_ENABLED` | `false` | Force the republish scan on (SE escape hatch; auto-on under `EVENT_BUS=zmq`) |
| `REDELIVERY_LEASE_SECONDS` | `300` | Delegation lease stamped at each dispatch; the redelivery engine re-dispatches past it |
| `REDELIVERY_ENGINE_FORCE_ENABLED` | `false` | Force the redelivery engine on (SE escape hatch; auto-on under `QUEUE_TRANSPORT=zmq`) |

## Operational procedure: the dual-profile SE matrix

The core estate (36 SEs) runs green under BOTH profiles — that is the program's
acceptance gate. SQS/Kafka-semantic SEs skip honestly under zmq (SE-01, SE-02, SE-20,
SE-25, SE-29); everything else runs.

### aws leg

```bash
./setpoint-evals/run-all.sh --quick --ci-mode
```

### full-zmq leg

```bash
cp .env /tmp/env-backup
printf '\nBUS_PROFILE=zmq\n' >> .env
docker stop dtm-kafka dtm-zookeeper dtm-kafka-ui dtm-localstack \
  $(docker ps -q --filter name=dtm-sqs-poller)
docker compose --env-file .env -f docker-compose.yml -f docker-compose.zmq.yml \
  --profile db --profile orchestrator --profile dev-tools --profile zmq-tasks up -d
./setpoint-evals/run-all.sh --quick --ci-mode
```

### CRITICAL: restore afterward (two gotchas)

**1. The dev-ack-simulator bakes its bus env at recreate time.** It reads `.env` via
compose `env_file`, so a zmq leg leaves the container zmq-flavored — and an aws leg run
afterward stalls every ACK-dependent SE (`WAITING_FOR_ACK` forever, because the
simulator is listening on the zmq event bus while the orchestrator publishes to Kafka).
The restore is NOT just removing lines from `.env`:

```bash
cp /tmp/env-backup .env     # or: remove BUS_PROFILE/QUEUE_TRANSPORT/EVENT_BUS lines
docker compose --env-file .env -f docker-compose.yml \
  --profile db --profile orchestrator --profile dev-tools \
  up -d --no-deps --force-recreate orchestrator dev-ack-simulator   # BOTH, always
curl -sf http://localhost:3002/api/v1/health   # must return ok before you run anything
```

(The SE scripts that flip env — SE-29..36 — already do exactly this in their EXIT traps.
What they can't protect is YOU flipping env by hand.)

**2. LocalStack `PERSISTENCE=0`.** Any stop/restart/recreate of `dtm-localstack` wipes
ALL deployed Lambda functions (and SQS queues are re-created by the init scripts, but
the functions are not). After any LocalStack bounce, before running anything
worker-touching on the aws profile:

```bash
./scripts/local-env.sh deploy-workers --poller --count=10
```

## Operational hazard: the shared `dtm-` stack

The compose project name is a single global `dtm` (`COMPOSE_PROJECT_NAME=dtm` in
`.env`). On a shared host, every worktree and every concurrent agent session drives the
SAME containers by name:

- **A second session can restart the fleet mid-suite.** A `docker compose ... recreate`
  of `dtm-localstack` from any worktree wipes all deployed Lambda functions
  (`PERSISTENCE=0`), and SE-01/SE-02/SE-13-class evals fail as casualties minutes later
  with what looks like retry breakage. If worker-touching SEs fail mysteriously, check
  `aws --endpoint-url=http://localhost:4567 lambda list-functions` before suspecting the
  engine.
- **Destructive SEs flip env and stop containers.** SE-29..36 recreate the orchestrator
  and dev-ack-simulator, stop brokers (SE-36 stops kafka, zookeeper, kafka-ui AND
  localstack — the LocalStack stop wipes deployed Lambdas mid-suite, which is exactly
  why SE-36's trap restores them and why a `deploy-workers` is needed before the next
  aws leg). Never run two estates (or an estate and a manual debugging session) against
  the same `dtm-` stack concurrently.
- The same single-project rule is why `CLAUDE.md` insists: always filter
  `docker ps --filter "name=dtm-"` and never stop non-`dtm-` containers.

## Optional follow-up: a zmq-profile demo recording

Not produced (docs phase). If recorded, it would show, in one short pass: the
zero-broker bring-up (`start --zmq` — visibly no kafka/localstack containers), a
quick-order job running end-to-end on the dashboard with the worker fleet visible in
`GET /api/v1/workers`, a `docker kill` of a worker-host mid-task and the redelivery
engine re-dispatching the step, and the resulting `dtm_dead_letters` row surfaced in the
monitor. Recording mechanics would follow `guides/DEMO-VIDEOS.md`.

## See also

- [architecture-c4.md](architecture-c4.md) — C4 views including the zmq deployment view
- [MAINTENANCE-TASKS.md](MAINTENANCE-TASKS.md) — redelivery-engine + event-republish-scan
- [DOCKER-ECOSYSTEM.md](DOCKER-ECOSYSTEM.md) — compose files and profiles
- [ENV-FILES-USAGE.md](ENV-FILES-USAGE.md) — environment file mechanics
- `CLAUDE.md` → "Bus Profile (`BUS_PROFILE`, Phase 4)"
