# Tools

Development-only utilities for local testing and simulation. **None of these are deployed to production.**

## Contents

### `sqs-poller/`

A custom SQS poller that replaces LocalStack's native Event Source Mappings (ESM) for local development. It polls SQS queues and invokes Lambda handlers either via LocalStack's Lambda API or in-process (debug-server mode).

**Why it exists:** The free LocalStack version has known flakiness with ESM v2. The poller provides reliable, sequential message processing for development and testing.

**Modes:**
- **Container mode** — runs as a Docker container alongside LocalStack (default)
- **Debug-server mode** — runs on the host, executes all handlers in-process (great for debugging)

### `zmq-worker-host/`

The DEALER side of the `zmq` task transport (`QUEUE_TRANSPORT=zmq`). Connects to the orchestrator's ROUTER socket, HELLO-registers the queues of ONE workflow (`WORKFLOW_NAME`), heartbeats, receipt-acks tasks, and invokes the same workflow `handlerMap` in-process — like the sqs-poller's debug-server mode, with workflow handler code byte-untouched.

**Why it exists:** Phase 2 of the bus-agnosticism program — proves the task path can run on a non-SQS transport (mixed mode: zmq tasks + Kafka events unchanged). One container per workflow, compose-scaled for replicas (`docker-compose.zmq.yml`, profile `zmq-tasks`; SE-31/32/33).

### `dev-ack-simulator/`

Simulates external system acknowledgements for development. Listens to `dtm.jobs.completed` Kafka topics and automatically publishes ACK messages to `dtm.*.ack` topics.

**Why it exists:** In production, acknowledgements come from an external system. This simulator enables full end-to-end workflow testing without that dependency.

## Future Tools

Planned additions to this directory:
- `graphql-simulator/` — simulate GraphQL API responses for workflows that query external APIs
- `oauth-simulator/` — simulate OAuth provider for authentication-dependent workflows
- `rest-api-simulator/` — simulate REST API endpoints for integration testing

## Running

Tools are started automatically by `local-env.sh`:
```bash
# Starts orchestrator + poller + dev-ack-simulator
./scripts/local-env.sh start --standalone --orchestrator
./scripts/local-env.sh deploy-workers
```
