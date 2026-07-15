# SE 11: Stuck Delegated Recovery

## Setpoint Eval Metadata

**Timeout**: 120s
**Isolation**: parallel-safe
**Category**: maintenance

## Purpose

Tests the **StuckDelegatedTask** maintenance task, which re-delegates steps stuck in `DELEGATED` status (sent to SQS but never picked up by a worker).

```mermaid
sequenceDiagram
    participant TEST as Test Script
    participant DB as Database
    participant TASK as MaintenanceTask
    participant SQS as SQS

    Note over TEST: Step 1: Normal completion
    TEST->>DB: Job completes successfully

    Note over TEST: Step 2: Simulate stuck delegation
    TEST->>DB: SET ValidateCustomer = 'delegated'
    TEST->>DB: SET started_at = 15 min ago
    TEST->>DB: SET job = 'processing'

    Note over TASK: Step 3: Recovery
    TASK->>DB: Find steps in DELEGATED > timeout
    TASK->>SQS: Re-send SQS message
    SQS->>DB: Worker processes, step progresses
```

## Scenario

1. Start a batch job (consumer 1001)
2. Wait for successful completion
3. Set ValidateCustomer back to `delegated` with `started_at` = 15 min ago
4. Set job back to `processing`
5. Trigger maintenance task
6. Verify step progressed past `delegated` (re-delegation succeeded)

## What This Tests

- Detection of stuck delegated steps
- Re-delegation to SQS
- Worker successfully processes the re-delegated message
- Step progresses to completion after re-delegation

## Test Data

- **Consumer**: 1001

## Parallel Safety

**Safe** -- uses unique `externalSystemId`, no shared resources.

## Simulates

- Lost SQS messages
- SQS poller downtime during initial delegation
- Lambda deployment failures
- Queue URL misconfigurations

## Related

- **Task**: `services/orchestrator/src/maintenance/tasks/stuck-delegated.task.ts`
- **API**: `POST /maintenance/tasks/stuck-delegated/execute`
