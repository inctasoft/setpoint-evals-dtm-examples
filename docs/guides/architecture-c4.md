# Architecture — C4 Context & Container Views

Two orientation diagrams for a reader arriving fresh: **who/what talks to the system** (C1)
and **what the system is made of** (C2), plus a pair of **deployment views** showing how the
container set changes with the bus profile. For the full mechanics — the callback protocol,
retry/ACK state machine, fan-out cascades — see [system-architecture.md](system-architecture.md)
and the rest of this directory; this page stays deliberately shallow.

## C1 — System Context

DTM is a single system with three kinds of external actors: a caller that submits work
(REST API — a person via `curl`/Postman, or another service), an operator watching it run
(the Monitor Dashboard, in a browser), and the workflow's own domain data (each workflow
owns a source database of the entities it validates/submits against — order-processing's
customers/orders, iot-sensor-pipeline's devices/sensors, infra-provisioning's
environments/networks/compute).

```mermaid
C4Context
    title DTM — System Context

    Person(operator, "Operator / Stakeholder", "Watches jobs run, browses Setpoint Evals, drills into step history")
    Person_Ext(caller, "API Caller", "Submits jobs — curl, a script, or an upstream service")

    System(dtm, "DTM Orchestrator", "Generic distributed task orchestration engine with pluggable workflows")

    SystemDb_Ext(sourceDb, "Workflow Source DB(s)", "One PostgreSQL DB per workflow — the domain entities Validate/Submit steps read and write")

    Rel(caller, dtm, "POST /api/v1/workflows/:name/jobs", "HTTPS/JSON")
    Rel(operator, dtm, "Watches jobs, runs Setpoint Evals", "HTTPS + WebSocket")
    Rel(dtm, sourceDb, "Validate reads, Submit writes", "SQL, via Lambda workers")
```

## C2 — Container View

Inside the system boundary: the **Orchestrator** (NestJS) is the state-machine brain — it
owns job/step lifecycle, delegates work over SQS, and reconciles worker callbacks and Kafka
ACKs. **Lambda workers** are stateless per-step handlers, one per `Validate*`/`Submit*`/
`Discover*`/`Plan*`/`Apply*` step type, running in LocalStack in dev. The **Monitor** is a
separate Preact SPA that talks to the Orchestrator's REST + WebSocket surface — it renders
job state and, via the Orchestrator's own **Evals module**, browses and re-runs the
Setpoint Eval estate without ever shelling out itself (the Evals module re-issues a README's
own Payload through the same generic job API a caller would use).

```mermaid
C4Container
    title DTM — Container View

    Person(operator, "Operator / Stakeholder")
    Person_Ext(caller, "API Caller")

    System_Boundary(dtm, "DTM Orchestrator System") {
        Container_Boundary(orchBoundary, "Orchestrator (NestJS)") {
            Container(orchestrator, "Orchestrator Core", "NestJS", "Job/step state machine, delegation, callback + ACK reconciliation, feature flags, outcome rules")
            Container(evals, "Evals Module", "NestJS module", "Discovers SE READMEs on disk, exposes list/detail/run — run() re-POSTs the README's own Payload, never shells out")
        }
        Container(monitor, "Monitor Dashboard", "Preact + Vite SPA", "Dashboard (live jobs, DAG viz, drill-down) + Scenarios (browse/run SEs) tabs")
        Container(workers, "Lambda Workers", "Node.js Lambda handlers", "One handler per step type per workflow; poller mode in dev (ESM/LocalStack Pro only)")
        ContainerDb(dtmDb, "DTM DB", "PostgreSQL", "dtm_jobs / dtm_steps — the engine's own state, workflow-agnostic")
        ContainerQueue(sqs, "SQS Queues", "LocalStack", "One queue per step type; poller or Lambda ESM delivery")
        ContainerQueue(kafka, "Kafka", "Kafka + Zookeeper", "Cascade completion/ACK topics, per-entity")
    }

    ContainerDb_Ext(sourceDb, "Workflow Source DB(s)", "PostgreSQL x3", "order-processing / iot-sensor-pipeline / infra-provisioning domain data")

    Rel(caller, orchestrator, "Job API", "HTTPS/JSON")
    Rel(operator, monitor, "Browses", "HTTPS")
    Rel(monitor, orchestrator, "All REST + live events, incl. eval list/detail/run", "HTTPS + WebSocket")
    Rel(orchestrator, evals, "Delegates eval discovery/run", "in-process")
    Rel(orchestrator, dtmDb, "Reads/writes state", "TypeORM/SQL")
    Rel(orchestrator, sqs, "Delegates step work", "AWS SDK")
    Rel(sqs, workers, "Polls / invokes", "SQS poller or Lambda ESM")
    Rel(workers, sourceDb, "Validate reads, Submit writes", "TypeORM/SQL")
    Rel(workers, orchestrator, "Step progress callback", "HTTP POST")
    Rel(orchestrator, kafka, "Publishes completion events", "Kafka producer")
    Rel(kafka, orchestrator, "ACK events", "Kafka consumer")
```

## C3 — Deployment views by bus profile

The same engine deploys two ways (see [bus-profiles.md](bus-profiles.md) for the full
runbook). **aws** (the default): tasks travel SQS via LocalStack with sqs-pollers
invoking Lambda workers; events travel Kafka with Zookeeper. **full-zmq**
(`BUS_PROFILE=zmq`): tasks travel a ZeroMQ ROUTER/DEALER pair between the orchestrator
and per-workflow `zmq-worker-host` containers; events travel a ZeroMQ PUB/PULL pair
between the orchestrator and the dev-ack-simulator's zmq client — no broker containers
at all.

```mermaid
C4Deployment
    title DTM — Deployment view, aws profile (default)

    Deployment_Node(host, "Docker host", "docker compose: docker-compose.yml + .kafka.yml + .workers.yml") {
        Deployment_Node(dtm, "Docker network 'dtm'") {
            Container(orch, "dtm-orchestrator", "NestJS", "State machine; SqsTransport + KafkaEventBus")
            Container(db, "dtm-db", "PostgreSQL", "dtm_jobs / dtm_steps / dtm_dead_letters")
            Container(localstack, "dtm-localstack", "LocalStack", "SQS queues + Lambda workers (PERSISTENCE=0)")
            Container(pollers, "dtm-sqs-poller-xN", "Node.js", "Polls SQS, invokes Lambdas (dev)")
            Container(kafka, "dtm-kafka + dtm-zookeeper", "Kafka", "Completion/ACK topics")
            Container(sim, "dtm-dev-ack-simulator", "NestJS", "Simulated target-system ACKs (Kafka)")
        }
    }

    Rel(orch, localstack, "Delegates step work", "AWS SDK/SQS")
    Rel(pollers, localstack, "Poll + invoke", "SQS + Lambda API")
    Rel(localstack, orch, "Worker callbacks", "HTTP POST")
    Rel(orch, kafka, "Publishes completion events", "producer")
    Rel(sim, kafka, "Subscribe completions, publish ACKs", "consumer/producer")
    Rel(kafka, orch, "ACK events", "consumer")
```

```mermaid
C4Deployment
    title DTM — Deployment view, full-zmq profile (BUS_PROFILE=zmq, zero brokers)

    Deployment_Node(host, "Docker host", "docker compose: docker-compose.yml + .zmq.yml, profile zmq-tasks") {
        Deployment_Node(dtm, "Docker network 'dtm'") {
            Container(orch, "dtm-orchestrator", "NestJS", "ZmqTransport + ZmqEventBus; ROUTER :5557 tasks, PUB :5558 events, PULL :5559 acks")
            Container(db, "dtm-db", "PostgreSQL", "dtm_jobs / dtm_steps / dtm_dead_letters — the durability anchor")
            Container(wh1, "dtm-zmq-worker-host-order-processing", "Node.js DEALER", "In-process handlers, one container per workflow (scalable)")
            Container(wh2, "dtm-zmq-worker-host-iot-sensor-pipeline", "Node.js DEALER", "Same host image, iot workflow")
            Container(wh3, "dtm-zmq-worker-host-infra-provisioning", "Node.js DEALER", "Same host image, infra workflow")
            Container(sim, "dtm-dev-ack-simulator", "NestJS zmq client", "SUB :5558, PUSH :5559")
        }
    }

    Rel(wh1, orch, "HELLO/heartbeat; RECEIVED acks", "DEALER→ROUTER [topic, json] envelopes")
    Rel(orch, wh1, "Task dispatch (fair-queue per queue)", "ROUTER→DEALER")
    Rel(wh1, orch, "Step progress callbacks", "HTTP POST (unchanged)")
    Rel(orch, sim, "Completion events", "PUB→SUB 'event' envelopes")
    Rel(sim, orch, "ACK events", "PUSH→PULL 'event' envelopes")
```

Notes on the zmq view:

- **Reliability is explicit, not brokered.** Task re-delivery comes from the redelivery
  engine (`dtm_steps` delegation leases → `dtm_dead_letters`); event re-publish comes
  from the event-republish scan. The sockets are fire-and-forget by design.
- **Worker callbacks stay HTTP.** Only the task and event legs changed transports;
  handler code is identical on both profiles.

## Notes for readers coming from the mechanics docs

- The Evals module is **read-only over the filesystem, write-only over the same job API a
  human caller uses** — it has no special execution privilege. See
  `services/orchestrator/src/evals/` and `MAINTENANCE-TASKS.md`'s sibling security-gate
  pattern (`ENABLE_EVAL_RUN_API`) for the guard.
- "Workflow Source DB(s)" is plural by design — each of the 3 example workflows owns an
  independent PostgreSQL database with its own schema; the Orchestrator itself never queries
  them directly (see `CLAUDE.md` → "Data Access Boundary").
- This page intentionally omits the callback/ACK/retry state machine, fan-out cascade
  mechanics, and feature-flag layering — those are [system-architecture.md](system-architecture.md)'s
  job, not this one's.
