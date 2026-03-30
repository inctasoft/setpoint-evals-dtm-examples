# Request Lifecycle (End-to-End)

Complete trace of a request through the DTM system, from API call to job completion.

## Overview

```
Client → API → Job Created → Steps Created → SQS → Worker → Callback → Kafka → ACK → Cascade → Complete
```

## Phase 1: Job Initiation

### 1.1 API Request

**Endpoint**: `POST /api/v1/workflows/:workflowName/jobs`

```json
{
  "variant": "default",
  "payload": {
    "customerId": 1,
    "orderId": 1
  },
  "deduplicationKey": "customer-1",
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 }
  }
}
```

**Controller**: `workflow.controller.ts` → `initiateWorkflowJob()`

### 1.2 Workflow Resolution

1. `WorkflowRegistryService.getWorkflow(workflowName)` → returns `WorkflowConfigService`
2. Validates workflow is enabled
3. Resolves variant (explicit or default from config)

### 1.3 Deduplication Check (if enabled)

If `ENABLE_MIGRATION_REQUESTS_DEDUPLICATION=true` or `enableDeduplication: true` in request:
- Hash request payload
- Check for existing job with same hash in `pending`/`processing` state
- If found, return existing `jobId` (no new job created)

### 1.4 Job Creation

1. Create `dtm_jobs` row: status=`PENDING`, workflow_name, payload, submitted_at
2. Publish `JobSubmittedEvent` to Kafka (if enabled)
3. Call `orchestrationService.startJob(jobId)`

### 1.5 Step Creation & Initial Delegation

`startJob()`:
1. Load variant step definitions from `WorkflowDefinition.steps[variant]`
2. Create `dtm_steps` rows for ALL steps (status=`PENDING`)
3. Update job status to `PROCESSING`
4. Call `continueJob(jobId)` — enters the decision tree

First `continueJob()` call: all steps are `PENDING`, no failures → **Case 4**: find ready steps (steps with empty `dependencies[]`) → delegate root steps in parallel.

## Phase 2: Worker Execution

### 2.1 SQS Delegation

`delegationService.delegateStep()`:
1. **Atomic claim**: `claimForDelegation()` — UPDATE step WHERE status='pending' (prevents race condition RC4)
2. Build `LambdaStepPayload`:
   ```json
   {
     "jobId": "uuid",
     "stepId": "uuid",
     "stepValue": "ValidateCustomer",
     "stepType": "ValidateCustomer",
     "input": { "customerId": 1 },
     "callbackUrl": "http://orchestrator:3000/api/v1/callback/step-progress",
     "correlationId": "trace-id",
     "testOptions": { "simDelay": 500 }
   }
   ```
3. Send to SQS queue (e.g., `order-validate-customer`)
4. Store `sqs_message_id` on step
5. Update step status to `DELEGATED`

### 2.2 SQS Poller Picks Up Message

`sqs-poller/poller.ts`:
1. Long-polls all queues (discovered from workflow configs at startup)
2. Receives message, extracts `stepValue`
3. Routes to correct handler via `handler-registry.ts`

### 2.3 Worker Executes

Worker handler:
1. Sends `in_progress` callback (optional)
2. Queries source database using TypeORM entity
3. Transforms/processes data
4. Sends `completed` or `failed` callback with output data

### 2.4 Callback Received

`callbackService.processCallback()`:
1. **Guard RC1**: Reject if step is already in terminal state
2. Update step with callback data (output, recordsProcessed, etc.)
3. Apply `testOptions.maxRetries` override if present
4. For `completed` steps:
   - If step `requiresAcknowledgement` → check cascade dependencies
   - If dependencies met → publish to Kafka → set `WAITING_FOR_ACK`
   - If no ACK needed → set `COMPLETED`
5. For `failed` steps:
   - If retries remaining → step stays in `IN_PROGRESS_RETRYING` (SQS re-delivers)
   - If retries exhausted → set `FAILED`
6. Call `continueJob(jobId)`

## Phase 3: ACK & Cascade

### 3.1 Kafka Publish

For steps with `requiresAcknowledgement: true`:
- Publish to `<workflow-prefix>.<cascade>.completed` topic
- Message includes step output, cascade data, FK values
- Step moves to `WAITING_FOR_ACK`

**Note**: `WAITING_FOR_ACK` is classified as **in-progress**, NOT completed. Dependent steps must wait.

### 3.2 Dev ACK Simulator

In development, `dev-ack-simulator` listens on completion topics:
1. Receives completion message
2. Looks up workflow-specific `ack-defaults.ts` for custom ACK payload
3. Falls back to generic payload (UUID + timestamp) if no custom defaults
4. Publishes ACK to `<workflow-prefix>.<cascade>.ack` topic
5. Respects `testOptions` (ackDelay, skipAck, crashBeforeAck)

### 3.3 ACK Received

`acknowledgement.handler.ts`:
1. Receives ACK from Kafka
2. Updates step: `ack_received_at`, `ack_metadata` (stores externalId, etc.)
3. Sets step status to `COMPLETED`
4. Triggers cascade check: `cascadePublishService.checkAndPublishCascade()`

### 3.4 FK Cascade Injection

`cascade-publish.service.ts`:
1. Check if this cascade's ACK enables any downstream transforms
2. For each dependent cascade in cascade config:
   - Check if ALL parent cascades have ACK'd (or are empty)
   - Extract FK values from ACK metadata (e.g., `ext_customer_id`)
   - Inject FK into downstream step's input
3. If all dependencies met → downstream transform's Kafka publish proceeds

### 3.5 continueJob() Orchestration Loop

After each callback/ACK, `continueJob()` re-evaluates:
- New steps may now be ready (dependencies satisfied)
- Ready steps get delegated
- Cycle continues until all steps reach terminal state

## Phase 4: Job Completion

### 4.1 All Steps Terminal

When `continueJob()` finds no pending and no in-progress steps:

**No failures**: Case 2 → `completeJob()` → status `COMPLETED`

**With failures**: Case 1 → `evaluateOutcome()`:
1. Build `JobContext` from step statuses and cascade configs
2. Evaluate outcome rules in priority order (first match wins)
3. Result: `FAILED` (critical cascade failed), `PARTIAL_SUCCESS` (optional cascade failed), or `COMPLETED`

### 4.2 Job Update

1. Calculate statistics (totalRecordsProcessed, duration)
2. Publish `JobCompletedEvent` to Kafka
3. Update job status and `completed_at`

## Timing Reference

| Phase | Typical Duration (dev) | Notes |
|-------|----------------------|-------|
| Job creation + step delegation | <1s | Database operations |
| Worker execution | 1-5s | Depends on source DB query + simDelay |
| Kafka publish | <1s | — |
| ACK roundtrip (dev-ack-simulator) | 5-30s | Kafka consumer lag |
| Total (simple job, no fan-out) | ~10-15s | quick-order variant |
| Total (full job with ACK) | ~25-70s | default variant with fan-out |

## Sequence Diagram

See `docs/diagrams/request-lifecycle.mermaid` for the visual sequence diagram.
