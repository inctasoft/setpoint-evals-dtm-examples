# DTM Glossary

Canonical terms used throughout the DTM (Distributed Task Manager) codebase.

## Core Concepts

| Term | Definition |
|------|-----------|
| **Workflow** | A named procedure definition containing a step DAG, cascades, outcome rules, and criticality rules. Registered at boot via `workflow.config.ts`. |
| **Job** | A single execution instance of a workflow, created via the API or Kafka trigger. Tracks overall status and holds the request payload. |
| **Step** | A unit of work within a job, delegated to a Lambda worker via SQS. Each step has a status (10-state machine), input/output data, and retry tracking. |
| **Child Step** | A step created dynamically by fan-out from a discovery step. Has a `parentStepId`, `childIndex`, and `childItemId`. |
| **Variant** | An alternative step DAG within the same workflow (e.g., `default` vs `quick-order`). Selected at job creation time. |

## Cascade System

| Term | Definition |
|------|-----------|
| **Cascade** | A named data domain within a workflow that groups related steps (input + output), defines FK dependencies, Kafka topics, and criticality. Configured via `CascadeConfig`. |
| **Cascade Name** | String identifier for a cascade (e.g., `'customer'`, `'order'`, `'lineItem'`). Used as the key in FK maps, criticality rules, and outcome evaluation. |
| **Cascade Criticality** | Whether a cascade is `required`, `optional`, or `conditional` for job success. Drives outcome rule evaluation. |
| **FK Extractor** | A workflow-defined function on a cascade that extracts foreign key values from parent ACK metadata before publishing child data. |

## Fan-Out

| Term | Definition |
|------|-----------|
| **Fan-Out** | Pattern where a discovery step returns N item IDs, and the orchestrator creates N child step chains (one per item). |
| **Item** | A specific record discovered during fan-out (e.g., one order line item, one sensor). Each item becomes a set of child steps. |
| **Item ID** | The identifier of a fan-out item, stored as `child_item_id` on the child step. Passed to child workers via `itemIdInputField`. |
| **Discovery Step** | The parent step that discovers items. Configured with `FanOutConfig` specifying `itemIdField` and `childStepChain`. |

## Orchestration

| Term | Definition |
|------|-----------|
| **continueJob()** | The orchestration brain. Called after every callback, evaluates a 4-case decision tree to determine next actions. |
| **Delegation** | Sending a step to a Lambda worker via SQS. Uses atomic `claimForDelegation()` to prevent double-delegation. |
| **Outcome Rule** | A priority-ordered predicate evaluated when all steps reach terminal state. First match determines final job status (`completed`, `partial_success`, `failed`). |
| **ACK (Acknowledgement)** | External confirmation received via Kafka after a step's data is published. Transitions step from `WAITING_FOR_ACK` to `COMPLETED`. |

## Step Status Machine

| Status | Terminal? | Description |
|--------|-----------|-------------|
| `PENDING` | No | Created, waiting for dependencies |
| `DELEGATED` | No | Sent to SQS, awaiting worker pickup |
| `IN_PROGRESS` | No | Worker is actively processing |
| `IN_PROGRESS_RETRYING` | No | Failed but retrying via SQS |
| `WAITING_FOR_CHILDREN` | No | Discovery step waiting for fan-out children |
| `WAITING_FOR_ACK` | Yes* | Worker completed, awaiting external ACK |
| `COMPLETED` | Yes | Fully done (worker + ACK if required) |
| `FAILED` | Yes | All retries exhausted |
| `SKIPPED` | Yes | Skipped (dependency failed or feature-gated) |
| `PARTIAL_SUCCESS` | Yes | Fan-out parent where some children failed |

*`WAITING_FOR_ACK` is terminal for callbacks (rejects new callbacks) but dependent steps must wait for ACK to arrive before proceeding.

## Bus-Agnosticism (Phases 1–4)

| Term | Definition |
|------|-----------|
| **QueueTransport** | Pluggable task-dispatch abstraction (`services/orchestrator/src/transport/`). Implementations: `SqsTransport` (default), `CloudTasksTransport`, `ZmqTransport`. Selected by `QUEUE_TRANSPORT`. |
| **EventBus** | Pluggable event abstraction (`services/orchestrator/src/event-bus/`) for transformed-data publishes, job lifecycle events, and ACKs. Implementations: `KafkaEventBus` (default), `ZmqEventBus`. Selected by `EVENT_BUS`. Disjoint from QueueTransport. |
| **BUS_PROFILE** | Umbrella env switch. `zmq` expands to `QUEUE_TRANSPORT=zmq` + `EVENT_BUS=zmq`; `aws` is the default world. Explicit per-var env wins over the umbrella. |
| **zmq-worker-host** | Per-workflow DEALER container (`tools/zmq-worker-host/`) that HELLO-registers its queues with the orchestrator's ROUTER, heartbeats, receipt-acks tasks, and runs the same workflow handlers in-process. |
| **Worker Registry** | Orchestrator-side zmq worker fleet table (HELLO → alive, heartbeat → refresh, silence → dead/unroutable). Exposed at `GET /api/v1/workers` under `QUEUE_TRANSPORT=zmq`. |
| **Redelivery Engine** | Orchestrator-driven task redelivery (maintenance task). Re-dispatches steps whose delegation lease (`dtm_steps.lease_expires_at`) expired; dead-letters attempt-exhausted steps into `dtm_dead_letters`. Active when the task transport declares `redelivery: 'orchestrator'` (zmq) or `REDELIVERY_ENGINE_FORCE_ENABLED=true`. |
| **Event-Republish Scan** | Orchestrator-driven dropped-publish recovery (maintenance task). Re-publishes un-ACKed steps past `EVENT_REPUBLISH_LEASE_SECONDS`. Active when the event bus declares `droppedPublishRecovery: 'orchestrator'` (zmq) or `EVENT_REPUBLISH_SCAN_FORCE_ENABLED=true`. |
| **taskHandle / attemptNumber** | Bus-neutral wire names for a task dispatch (compat aliases: `sqsMessageId` / `sqsReceiveCount`). Under zmq, taskHandle is an orchestrator-minted uuid and attemptNumber is the synthetic `dtm_steps.attempt_count`. |
| **eventTopic** | Bus-neutral primary name for a cascade's publish topic (compat alias: `kafkaTopic`). Readers resolve `eventTopic ?? kafkaTopic`. |
