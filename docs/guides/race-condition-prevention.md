# Race Condition Prevention in Callback Flow

**Last Updated**: 2026-02-09
**Status**: Critical Fixes Applied

## Overview

The DTM engine handles asynchronous callbacks from Lambda workers. When multiple steps complete simultaneously (especially in fan-out scenarios), when SQS re-delivers messages, or when concurrent orchestration calls race to delegate the same steps, race conditions can cause premature job completion, output corruption, or double-delegation.

This document explains the four race conditions discovered and the fixes applied, with diagrams illustrating each one.

---

## Step State Machine

All guards are based on the step state machine. Understanding valid transitions is key to understanding where guards are needed.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Step created

    PENDING --> DELEGATED: SQS message sent
    DELEGATED --> IN_PROGRESS: Lambda sends in_progress callback
    DELEGATED --> IN_PROGRESS_RETRYING: Lambda fails (retries available)

    IN_PROGRESS --> COMPLETED: Lambda sends completed callback
    IN_PROGRESS --> IN_PROGRESS_RETRYING: Lambda fails (retries available)
    IN_PROGRESS --> FAILED: Lambda fails (retries exhausted)

    IN_PROGRESS_RETRYING --> IN_PROGRESS: Lambda retries, sends in_progress
    IN_PROGRESS_RETRYING --> COMPLETED: Lambda retries, succeeds
    IN_PROGRESS_RETRYING --> FAILED: Retries exhausted

    COMPLETED --> WAITING_FOR_ACK: Kafka publish (Transform steps)
    WAITING_FOR_ACK --> COMPLETED: ACK received

    DELEGATED --> WAITING_FOR_CHILDREN: Discovery step (fan-out)
    WAITING_FOR_CHILDREN --> COMPLETED: All children succeeded
    WAITING_FOR_CHILDREN --> PARTIAL_SUCCESS: Some children failed
    WAITING_FOR_CHILDREN --> FAILED: All children failed

    COMPLETED --> [*]
    FAILED --> [*]
    SKIPPED --> [*]
    PARTIAL_SUCCESS --> [*]

    note right of COMPLETED: Terminal state\n(guard rejects callbacks)
    note right of WAITING_FOR_ACK: Terminal state\n(guard rejects callbacks)
    note right of FAILED: Terminal state\n(guard rejects callbacks)
    note right of SKIPPED: Terminal state\n(guard rejects callbacks)
    note right of PARTIAL_SUCCESS: Terminal state\n(guard rejects callbacks)
    note right of WAITING_FOR_CHILDREN: NOT terminal\n(fan-out service transitions it)
```

**Guard rule**: Once a step enters a **terminal state** (`COMPLETED`, `WAITING_FOR_ACK`, `FAILED`, `SKIPPED`, `PARTIAL_SUCCESS`), all further Lambda callbacks are rejected. Only specific internal transitions are allowed (e.g., `COMPLETED` -> `WAITING_FOR_ACK` by the callback service itself, or `WAITING_FOR_ACK` -> `COMPLETED` by the ACK handler).

**Note**: `WAITING_FOR_CHILDREN` is NOT a terminal state. It is used by discovery steps waiting for fan-out children to complete. The fan-out service transitions it to `COMPLETED`, `PARTIAL_SUCCESS`, or `FAILED` when all children are done.

---

## Race Condition #1: Discovery Step Completion

### Problem

**Location**: `callback.service.ts` - Discovery step handling

**Scenario**:
1. DiscoverLineItems Lambda completes with 3 item IDs
2. Callback marks step as `COMPLETED`
3. `continueJob()` sees all upfront steps as "completed"
4. Job is marked complete
5. THEN child steps (ValidateLineItem, SubmitLineItem) are created
6. Children never execute because job already "completed"

### Diagram: Without Fix (Bug)

```mermaid
sequenceDiagram
    participant Lambda as DiscoverLineItems Lambda
    participant CB as CallbackService
    participant DB as Database
    participant Orch as OrchestrationService

    Lambda->>CB: COMPLETED callback (3 item IDs)
    CB->>DB: updateStepFromCallback(COMPLETED)
    Note over DB: Step marked COMPLETED
    CB->>Orch: continueJob()
    Note over Orch: All upfront steps done!
    Orch->>DB: Job marked COMPLETED
    CB->>DB: handleDiscoveryComplete() creates 3 children
    Note over DB: Children created but job already done
```

### Diagram: With Fix (Safe)

```mermaid
sequenceDiagram
    participant Lambda as DiscoverLineItems Lambda
    participant CB as CallbackService
    participant FO as FanOutService
    participant DB as Database

    Lambda->>CB: COMPLETED callback (3 item IDs)
    CB->>CB: Is fan-out discovery? YES
    CB->>CB: Has item IDs? YES
    CB->>DB: Update output ONLY (no status change)
    Note over DB: Output stored, status still DELEGATED
    CB->>FO: handleDiscoveryComplete(itemIds)
    FO->>DB: Set parent to WAITING_FOR_CHILDREN
    FO->>DB: Create 3 child steps
    FO->>DB: Delegate children to SQS
    CB-->>CB: Return early (NO continueJob)
    Note over DB: Safe: children exist before any completion check
```

### Fix Applied

```typescript
// Check for fan-out BEFORE updating status
if (itemIds && itemIds.length > 0) {
  // Do NOT mark as COMPLETED yet!
  await this.stepRepository.update(dto.stepId, { output: { ...dto.output } });
  await this.fanOutService.handleDiscoveryComplete(...);
  return;  // Don't call continueJob() here
}
```

---

## Race Condition #2: Child Transform Step Completion

### Problem

**Location**: `callback.service.ts` - Child step completion handling

**Scenario**:
1. 3 SubmitLineItem Lambdas complete nearly simultaneously
2. Each callback updates step to `COMPLETED`
3. `handleChildStepComplete()` returns `parentComplete: true`
4. `continueJob()` called IMMEDIATELY
5. `continueJob()` sees steps as "completed" -> marks job complete
6. THEN the code changes step to `WAITING_FOR_ACK` (too late!)
7. ACKs arrive but job already "completed"

### Diagram: Without Fix (Bug)

```mermaid
sequenceDiagram
    participant TF as SubmitLineItem Lambda
    participant CB as CallbackService
    participant DB as Database
    participant Orch as OrchestrationService
    participant Kafka as Kafka

    TF->>CB: COMPLETED callback
    CB->>DB: updateStepFromCallback(COMPLETED)
    CB->>CB: handleChildStepComplete() -> parentComplete: true
    CB->>Orch: continueJob()
    Note over Orch: All steps "COMPLETED"
    Orch->>DB: Job marked COMPLETED
    CB->>DB: Set WAITING_FOR_ACK (too late!)
    CB->>Kafka: Publish transformed data
    Note over Kafka: ACK will arrive but job already done
```

### Diagram: With Fix (Safe)

```mermaid
sequenceDiagram
    participant TF as SubmitLineItem Lambda
    participant CB as CallbackService
    participant DB as Database
    participant Kafka as Kafka
    participant ACK as AcknowledgementHandler
    participant Orch as OrchestrationService

    TF->>CB: COMPLETED callback
    CB->>DB: updateStepFromCallback(COMPLETED)
    CB->>CB: handleChildStepComplete() -> parentComplete: true
    CB->>CB: requiresAcknowledgement? YES
    Note over CB: DEFER continueJob()!
    CB->>DB: Set WAITING_FOR_ACK
    CB->>Kafka: Publish transformed data
    CB-->>CB: Return (NO continueJob)
    Note over Kafka: ...time passes...
    Kafka->>ACK: ACK received
    ACK->>DB: Step -> COMPLETED
    ACK->>Orch: continueJob()
    Note over Orch: Now all steps truly done
    Orch->>DB: Job marked COMPLETED
```

### Fix Applied

```typescript
if (childStepResult.parentComplete) {
  if (!stepConfig?.requiresAcknowledgement) {
    await this.orchestrationService.continueJob(dto.jobId);  // Safe
  } else {
    this.logger.log(`Deferring continueJob() - step requires ACK`);
  }
}
```

---

## Correct Flow After Fixes (Races #1 and #2)

### Discovery Steps (Fan-Out Parent)

```
Lambda Completes (DiscoverLineItems)
        |
Check: Is Fan-Out Discovery?
        |
    [YES with item IDs]
        |
Update output (NOT status)
        |
handleDiscoveryComplete()
  - Creates child steps
  - Sets parent to WAITING_FOR_CHILDREN
  - Delegates children
        |
Return (NO continueJob)
        |
... Children Execute ...
        |
All children ACK received
        |
Parent marked COMPLETED
        |
continueJob() -> Job complete
```

### Child Transform Steps

```
Lambda Completes (SubmitLineItem)
        |
updateStepFromCallback() -> status=COMPLETED
        |
handleChildStepComplete()
        |
Check: parentComplete?
        |
    [YES]
        |
Check: requiresAcknowledgement?
        |
    [YES] -> Log "Deferring" -> Continue
    [NO]  -> continueJob() (safe)
        |
Check: requiresAcknowledgement?
        |
    [YES]
        |
Set WAITING_FOR_ACK
        |
Publish to Kafka
        |
Return (NO continueJob)
        |
... ACK Received ...
        |
AcknowledgementHandler
        |
continueJob() -> Job complete
```

---

## Race Condition #3: SQS Re-delivery Overwrites Step Output

### Problem

**Location**: `callback.service.ts` - `handleStepProgress()` entry point

**Scenario**:
1. ValidateCustomer Lambda processes first SQS delivery, sends `COMPLETED` callback with output X
2. Orchestrator stores output X, marks step COMPLETED, delegates SubmitCustomer with output X baked into SQS message
3. SQS re-delivers the same message (visibility timeout expired during processing)
4. ValidateCustomer Lambda processes again, sends `COMPLETED` callback with output Y
5. Orchestrator overwrites output X with output Y -- but SubmitCustomer already has output X

**Affects ALL step types**: Extract, Transform, Discover -- any step that sends callbacks.

### Diagram: Without Fix (Bug)

```mermaid
sequenceDiagram
    participant SQS as SQS Queue
    participant EC as ValidateCustomer Lambda
    participant CB as CallbackService
    participant DB as Database
    participant Orch as OrchestrationService
    participant TC as SubmitCustomer Lambda

    SQS->>EC: Deliver message (attempt 1)
    EC->>CB: COMPLETED callback (output X - possibly bad)
    CB->>DB: Store output X, status=COMPLETED
    CB->>Orch: continueJob()
    Orch->>SQS: Delegate SubmitCustomer (output X baked in)
    Note over SQS: SQS visibility timeout expires
    SQS->>EC: Re-deliver same message (attempt 2)
    EC->>CB: COMPLETED callback (output Y - correct)
    CB->>DB: OVERWRITE output X with Y
    Note over DB: DB now has output Y
    SQS->>TC: SubmitCustomer receives message with output X
    Note over TC: output X has no .consumer field
    TC--xTC: FAILS: "Missing consumer field"
```

### Diagram: With Fix (Safe)

```mermaid
sequenceDiagram
    participant SQS as SQS Queue
    participant EC as ValidateCustomer Lambda
    participant CB as CallbackService
    participant DB as Database
    participant Orch as OrchestrationService
    participant TC as SubmitCustomer Lambda

    SQS->>EC: Deliver message (attempt 1)
    EC->>CB: COMPLETED callback (output X)
    CB->>DB: Store output X, status=COMPLETED
    CB->>Orch: continueJob()
    Orch->>SQS: Delegate SubmitCustomer (output X baked in)
    Note over SQS: SQS visibility timeout expires
    SQS->>EC: Re-deliver same message (attempt 2)
    EC->>CB: COMPLETED callback (output Y)
    CB->>CB: step.status == COMPLETED (terminal!)
    Note over CB: GUARD: Reject duplicate callback
    CB-->>EC: {success: true, "Duplicate ignored"}
    Note over DB: Output X preserved (not overwritten)
    SQS->>TC: SubmitCustomer receives output X
    Note over TC: Processes normally
```

### Fix Applied

```typescript
const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set([
  StepStatus.COMPLETED,
  StepStatus.WAITING_FOR_ACK,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
  StepStatus.PARTIAL_SUCCESS,
]);

if (TERMINAL_STATUSES.has(step.status as StepStatus)) {
  this.logger.warn(`Ignoring duplicate callback for step: already in '${step.status}'`);
  return { success: true, message: `Duplicate callback ignored...` };
}
```

**Defense-in-depth**: Matching guard added in `migration-step.repository.ts` `updateFromCallback()`.

**Accepting states**: `PENDING`, `DELEGATED`, `IN_PROGRESS`, `IN_PROGRESS_RETRYING`, `WAITING_FOR_CHILDREN`

---

## ACK Handler Idempotency Guard

The acknowledgement handler (`acknowledgement.handler.ts`) has its own guard against duplicate Kafka ACK messages. This is the pattern that Race #3's fix was modeled after.

### Diagram: ACK Duplicate Prevention

```mermaid
sequenceDiagram
    participant Kafka as Kafka Consumer
    participant ACK as AcknowledgementHandler
    participant DB as Database
    participant Cascade as CascadePublishService
    participant Orch as OrchestrationService

    Kafka->>ACK: ACK message (first delivery)
    ACK->>DB: findById(stepId)
    Note over ACK: step.status == WAITING_FOR_ACK
    ACK->>DB: updateStatus(COMPLETED)
    ACK->>DB: Store ackMetadata + externalId
    ACK->>Cascade: Check for dependent cascades to publish
    ACK->>Orch: continueJob()

    Note over Kafka: Kafka rebalance / retry
    Kafka->>ACK: ACK message (duplicate)
    ACK->>DB: findById(stepId)
    Note over ACK: step.status == COMPLETED (not WAITING_FOR_ACK!)
    ACK-->>ACK: GUARD: Ignore duplicate ack
    Note over DB: No changes (safe)
```

---

## Complete Callback Flow with All Guards

This diagram shows the full `handleStepProgress()` flow with all race condition prevention points marked.

```mermaid
flowchart TB
    subgraph Lambda["Lambda Worker"]
        L1["Lambda sends callback<br/>(status + output)"]
    end

    subgraph Guards["Entry Guards"]
        G1["1. Verify step exists"]
        G2["2. Verify job exists"]
        G3{"3. TERMINAL STATE<br/>GUARD<br/><br/>step.status in<br/>COMPLETED / WAITING_FOR_ACK /<br/>FAILED / SKIPPED /<br/>PARTIAL_SUCCESS ?"}
        G3Y["Return: Duplicate<br/>callback ignored"]
    end

    subgraph DiscoveryCheck["4. Fan-Out Discovery Check"]
        D1{"Is Fan-Out<br/>Discovery Step?"}
        D2{"Has Item IDs?"}
        D3["Update output ONLY<br/>(no status change)"]
        D4["handleDiscoveryComplete()<br/>- Creates children<br/>- Sets WAITING_FOR_CHILDREN<br/>- Delegates children"]
        D5["Return early<br/>(NO continueJob)"]
    end

    subgraph StepUpdate["5. Step Update"]
        C2["updateStepFromCallback()<br/>(with defense-in-depth guard)"]
    end

    subgraph ChildCheck["6. Child Step Check"]
        CH1{"Is Child Step?"}
        CH2["handleChildStepComplete()"]
        CH3{"All siblings done?"}
        CH4{"Requires ACK?"}
        CH5["continueJob() (safe)"]
        CH6["DEFER continueJob()<br/>(wait for ACK handler)"]
    end

    subgraph AckCheck["7. Acknowledgement Check"]
        A1{"Requires ACK?"}
        A2{"Dependencies met?"}
        A3["Defer publishing"]
        A4{"Has data to publish?"}
        A5["Complete directly<br/>+ continueJob()"]
        A6["Set WAITING_FOR_ACK<br/>(BEFORE Kafka publish)"]
        A7["Publish to Kafka"]
        A8["Return (NO continueJob)"]
    end

    subgraph RetryCheck["8. Retry Check (FAILED only)"]
        R1{"Retries available?"}
        R2["Wait for SQS retry<br/>(NO continueJob)"]
        R3["Retries exhausted"]
    end

    subgraph Fallback["9. Default Path"]
        C3["continueJob()"]
    end

    %% Main flow
    L1 --> G1
    G1 --> G2
    G2 --> G3
    G3 -->|"YES (terminal)"| G3Y
    G3 -->|"NO (accepting)"| D1

    %% Discovery path
    D1 -->|Yes| D2
    D1 -->|No| C2
    D2 -->|"Yes (item IDs)"| D3
    D2 -->|"No (empty)"| C2
    D3 --> D4
    D4 --> D5

    %% Step update
    C2 --> CH1

    %% Child step path
    CH1 -->|Yes| CH2
    CH1 -->|No| A1
    CH2 --> CH3
    CH3 -->|No| A1
    CH3 -->|Yes| CH4
    CH4 -->|No| CH5
    CH4 -->|Yes| CH6
    CH5 --> A1
    CH6 --> A1

    %% ACK check path
    A1 -->|Yes| A2
    A1 -->|"No (+ FAILED)"| R1
    A1 -->|"No (not FAILED)"| C3
    A2 -->|No| A3
    A2 -->|Yes| A4
    A4 -->|No| A5
    A4 -->|Yes| A6
    A6 --> A7
    A7 --> A8

    %% Retry check
    R1 -->|Yes| R2
    R1 -->|No| R3
    R3 --> C3

    %% Styling
    classDef guard fill:#ffcdd2,stroke:#c62828,stroke-width:3px
    classDef safe fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px
    classDef decision fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    classDef critical fill:#e1bee7,stroke:#6a1b9a,stroke-width:3px

    %% Guard points (RED) - race condition prevention
    class G3,G3Y guard

    %% Safe exit points (GREEN)
    class D5,A8,CH6,R2,A3 safe

    %% Decision points (YELLOW)
    class D1,D2,CH1,CH3,CH4,A1,A2,A4,R1 decision

    %% Critical fix points (PURPLE) - status set before action
    class D4,A6 critical
```

---

## Race Condition #4: Double-Delegation from Concurrent continueJob()

### Problem

**Location**: `orchestration.service.ts` → `continueJob()` → `delegation.service.ts`

**Scenario**:
1. ValidateCustomer and ValidateProduct both complete at the same millisecond
2. Both callbacks trigger `continueJob(jobId)` concurrently
3. Both calls read the same DB state: `{ValidateOrder: PENDING, SubmitCustomer: PENDING}`
4. Both identify the same ready steps and call `delegateSteps()`
5. Both send the same steps to SQS → workers process twice → duplicate callbacks
6. Second callback hits a terminal state → SubmitLineItems fails

### Diagram: Without Fix (Bug)

```mermaid
sequenceDiagram
    participant CB1 as Callback (ValidateCustomer)
    participant CB2 as Callback (ValidateProduct)
    participant Orch as OrchestrationService
    participant Del as DelegationService
    participant DB as Database
    participant SQS as SQS

    CB1->>Orch: continueJob(jobId)
    CB2->>Orch: continueJob(jobId)
    Orch->>DB: findByJobId() [CB1]
    Orch->>DB: findByJobId() [CB2]
    Note over DB: Both see ValidateOrder=PENDING
    Orch->>Del: delegateStep(ValidateOrder) [CB1]
    Orch->>Del: delegateStep(ValidateOrder) [CB2]
    Del->>SQS: Send message (1st)
    Del->>SQS: Send message (2nd - DUPLICATE!)
    Del->>DB: markAsDelegated [CB1]
    Del->>DB: markAsDelegated [CB2]
    Note over SQS: Worker processes step TWICE
```

### Diagram: With Fix (Safe)

```mermaid
sequenceDiagram
    participant CB1 as Callback (ValidateCustomer)
    participant CB2 as Callback (ValidateProduct)
    participant Orch as OrchestrationService
    participant Del as DelegationService
    participant DB as Database
    participant SQS as SQS

    CB1->>Orch: continueJob(jobId)
    CB2->>Orch: continueJob(jobId)
    Orch->>DB: findByJobId() [CB1]
    Orch->>DB: findByJobId() [CB2]
    Note over DB: Both see ValidateOrder=PENDING
    Orch->>Del: delegateStep(ValidateOrder) [CB1]
    Del->>DB: claimForDelegation(stepId)<br/>UPDATE WHERE status='pending'
    Note over DB: 1 row affected → CB1 wins
    Del->>SQS: Send message
    Orch->>Del: delegateStep(ValidateOrder) [CB2]
    Del->>DB: claimForDelegation(stepId)<br/>UPDATE WHERE status='pending'
    Note over DB: 0 rows affected → already claimed!
    Del-->>Orch: {success: true} (no-op)
    Note over SQS: Only ONE message sent
```

### Fix Applied

**Step 1**: Atomic claim method in `packages/database/src/repositories/step.repository.ts`:

```typescript
async claimForDelegation(id: string): Promise<boolean> {
  const result = await this.repo.update(
    { id, status: StepStatus.PENDING },
    { status: StepStatus.DELEGATED },
  );
  return (result.affected ?? 0) > 0;
}
```

**Step 2**: Claim-before-delegate in `services/orchestrator/src/delegation/delegation.service.ts`:

```typescript
const claimed = await this.stepRepository.claimForDelegation(dto.stepId);
if (!claimed) {
  this.logger.log(`Step ${dto.stepId} already claimed. Skipping.`);
  return { stepId: dto.stepId, success: true };  // No-op, not an error
}
// Only proceed to SQS send if we won the claim
```

---

## All Race Condition Guards Summary

```mermaid
flowchart LR
    subgraph "Guard Layer 1: Callback Entry"
        G1["Terminal-State Guard<br/>(callback.service.ts)<br/><br/>Rejects ALL callbacks<br/>for terminal steps"]
    end

    subgraph "Guard Layer 2: Repository"
        G2["Defense-in-Depth Guard<br/>(migration-step.repository.ts)<br/><br/>Rejects updateFromCallback<br/>for terminal steps"]
    end

    subgraph "Guard Layer 3: Discovery"
        G3["Discovery Status Defer<br/>(callback.service.ts)<br/><br/>Don't mark COMPLETED<br/>before children created"]
    end

    subgraph "Guard Layer 4: ACK Defer"
        G4["continueJob Defer<br/>(callback.service.ts)<br/><br/>Don't call continueJob<br/>before WAITING_FOR_ACK set"]
    end

    subgraph "Guard Layer 5: ACK Handler"
        G5["ACK Idempotency Guard<br/>(acknowledgement.handler.ts)<br/><br/>Only process ACKs for<br/>WAITING_FOR_ACK steps"]
    end

    subgraph "Guard Layer 6: Delegation"
        G6["Atomic Claim Guard<br/>(delegation.service.ts)<br/><br/>claimForDelegation()<br/>UPDATE WHERE status='pending'"]
    end

    G1 -->|"Blocks"| RC3["Race #3:<br/>SQS Re-delivery"]
    G2 -->|"Blocks"| RC3
    G3 -->|"Blocks"| RC1["Race #1:<br/>Premature Discovery<br/>Completion"]
    G4 -->|"Blocks"| RC2["Race #2:<br/>Premature Job<br/>Completion"]
    G5 -->|"Blocks"| RC_ACK["Duplicate ACK<br/>Messages"]
    G6 -->|"Blocks"| RC4["Race #4:<br/>Double Delegation"]

    classDef guard fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef race fill:#ffcdd2,stroke:#c62828,stroke-width:2px

    class G1,G2,G3,G4,G5,G6 guard
    class RC1,RC2,RC3,RC4,RC_ACK race
```

---

## Key Principles

### 1. Status Before Action
Always ensure the correct status is set BEFORE any action that checks status:
- Set `WAITING_FOR_ACK` BEFORE calling `continueJob()`
- Create children BEFORE checking completion counts

### 2. Defer When Uncertain
If a step requires acknowledgement, NEVER call `continueJob()` immediately:
- Let the ACK handler trigger orchestration
- This ensures proper status transitions

### 3. Check Conditions First
Before updating status, check if it will be changed later:
- Fan-out discovery with children -> don't set COMPLETED
- Transform requiring ACK -> will become WAITING_FOR_ACK

### 4. Reject Duplicates at Terminal States
Once a step reaches a terminal state, reject all further callbacks:
- Prevents SQS re-delivery from overwriting step output
- Prevents downstream steps from receiving stale/wrong data
- Follow the acknowledgement handler pattern: check status first, return early if terminal

---

## Verification

### Database Check
```sql
-- Find jobs completed before their last ACK (should return 0 rows)
SELECT j.id, j.completed_at as job_completed, MAX(s.ack_received_at) as last_ack
FROM dtm_jobs j
JOIN dtm_steps s ON s.job_id = j.id
WHERE j.completed_at IS NOT NULL
GROUP BY j.id, j.completed_at
HAVING j.completed_at < MAX(s.ack_received_at);
```

### SE Verification
```bash
# Run full suite in parallel to verify no race conditions
./setpoint-evals/run-all.sh --all-workflows

# Run parallel sweep to test under different concurrency levels
./setpoint-evals/run-parallel-sweep.sh --values "4 6 8" --runs-per-value 3
```

---

## Related Files

- **RC1-3 Fix Location**: `services/orchestrator/src/callback/callback.service.ts`
- **RC3 Defense-in-depth**: `packages/database/src/repositories/step.repository.ts`
- **RC4 Atomic Claim**: `packages/database/src/repositories/step.repository.ts` (`claimForDelegation()`)
- **RC4 Delegation Guard**: `services/orchestrator/src/delegation/delegation.service.ts`
- **ACK Handler Guard**: `services/orchestrator/src/kafka/handlers/acknowledgement.handler.ts`
- **Fan-Out Service**: `services/orchestrator/src/orchestration/fan-out.service.ts`
- **Diagram**: `docs/diagrams/callback-flow-race-prevention.mermaid`
- **Changelog (Race #1-2)**: `CHANGELOG/bug-fixes/2026-02-04-race-condition-job-completion.md`
- **Changelog (Race #3)**: `CHANGELOG/bug-fixes/2026-02-05-terminal-state-callback-guard.md`
