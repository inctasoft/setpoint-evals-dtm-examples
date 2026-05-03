# Step Status State Machine

The DTM engine manages step lifecycle through a 10-state state machine with strict transition rules and race condition guards.

## Step States (10 Total)

| Status | Description | Terminal? | Accepts Callbacks? |
|--------|-------------|-----------|-------------------|
| `PENDING` | Initial state, waiting to be scheduled | No | Yes |
| `DELEGATED` | Step sent to Lambda via SQS | No | Yes |
| `IN_PROGRESS` | Lambda actively processing | No | Yes |
| `IN_PROGRESS_RETRYING` | Failed but retrying via SQS | No | Yes |
| `COMPLETED` | Successfully finished | **Yes** | No |
| `WAITING_FOR_ACK` | Transform step waiting for Kafka ACK | **Yes** | No |
| `WAITING_FOR_CHILDREN` | Discovery step waiting for fan-out children | No | Yes |
| `FAILED` | Permanently failed | **Yes** | No |
| `SKIPPED` | Skipped due to dependency failure | **Yes** | No |
| `PARTIAL_SUCCESS` | Fan-out parent with some children failed | **Yes** | No |

**Critical Distinction**: `WAITING_FOR_CHILDREN` is NOT terminal (the fan-out service transitions it when all children complete), while `WAITING_FOR_ACK` IS terminal (the terminal-state guard rejects callbacks).

## State Transition Diagram

See `docs/diagrams/step-status-state-machine.mermaid` for the visual diagram.

### Standard Flow (Extract/Transform)
```
PENDING → DELEGATED → IN_PROGRESS → COMPLETED
```

### Retry Flow
```
IN_PROGRESS → IN_PROGRESS_RETRYING → IN_PROGRESS → COMPLETED
                    ↓ (max retries)
                  FAILED
```

### ACK Flow (Transform Steps with requiresAcknowledgement)
```
IN_PROGRESS → COMPLETED → [orchestrator publishes to Kafka] → WAITING_FOR_ACK
                                                                     ↓ (ACK received)
                                                                  COMPLETED
                                                                     ↓ (ACK timeout)
                                                                  FAILED
```

### Fan-Out Flow (Discovery Steps)
```
IN_PROGRESS → COMPLETED → WAITING_FOR_CHILDREN → COMPLETED (all children done)
                                                → PARTIAL_SUCCESS (some failed)
                                                → FAILED (critical children failed)
```

### Dependency Failure Flow
```
Any step → SKIPPED (when a dependency fails and the step cannot proceed)
```

## Terminal State Guards

The orchestrator enforces **four layers of protection** to prevent race conditions:

### Guard 1: Primary (callback.service.ts)
```typescript
const TERMINAL_STATUSES = new Set([
  StepStatus.COMPLETED,
  StepStatus.WAITING_FOR_ACK,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
  StepStatus.PARTIAL_SUCCESS,
]);

// At entry to handleStepProgress()
if (TERMINAL_STATUSES.has(step.status)) {
  this.logger.warn(`Rejecting callback for step ${stepId} in terminal state`);
  return;
}
```

### Guard 2: Defense-in-Depth (step.repository.ts)
Same terminal-state check at the repository level as a secondary guard.

### Guard 3: ACK Handler (acknowledgement.handler.ts)
Checks `status !== WAITING_FOR_ACK` before processing an ACK message.

### Guard 4: Atomic Delegation Claim (delegation.service.ts)
Prevents double-delegation when concurrent `continueJob()` calls race to delegate the same step:
```typescript
// step.repository.ts — only the first caller wins
async claimForDelegation(id: string): Promise<boolean> {
  const result = await this.repo.update(
    { id, status: StepStatus.PENDING },
    { status: StepStatus.DELEGATED },
  );
  return (result.affected ?? 0) > 0;
}
```
The `PENDING → DELEGATED` transition is atomic at the database level. If two concurrent calls try to claim the same step, only one gets `affected=1`; the other gets `affected=0` and skips the SQS send.

## Race Conditions (Solved)

| ID | Problem | Solution | Location |
|----|---------|----------|----------|
| RC1 | Discovery step marked COMPLETED before children created | Defer status update, create children first | `fan-out.service.ts` |
| RC2 | Child transform triggers `continueJob()` before WAITING_FOR_ACK set | Defer continueJob for ACK-requiring steps | `callback.service.ts` |
| RC3 | SQS re-delivery overwrites step output after downstream delegation | Terminal-state guard rejects stale callbacks | `callback.service.ts`, `step.repository.ts` |
| RC4 | Concurrent `continueJob()` calls delegate the same PENDING steps | Atomic `claimForDelegation()`: `UPDATE WHERE status='pending'` | `delegation.service.ts`, `step.repository.ts` |

## Maintenance Task Recovery

Each non-terminal state has a maintenance task that recovers stuck steps:

| Stuck State | Recovery Task | Action |
|-------------|---------------|--------|
| `IN_PROGRESS` > timeout | `stuck-in-progress.task.ts` | Auto-fail (uses per-step `timeoutMs`, default 30min) |
| `WAITING_FOR_ACK` > threshold | `stuck-acknowledgement.task.ts` | Alert + optional auto-fail |
| `WAITING_FOR_CHILDREN` > timeout | `stuck-waiting-for-children.task.ts` | Re-evaluate children, complete if all done |
| `DELEGATED` > 10min | `stuck-delegated.task.ts` | Re-delegate to SQS |
| `PENDING` with satisfied deps | `stuck-pending.task.ts` | Delegate (orphan recovery) |

## Job States (5 Total)

| Status | Description |
|--------|-------------|
| `PENDING` | Job created, no steps started |
| `PROCESSING` | At least one step active |
| `COMPLETED` | All steps completed successfully |
| `FAILED` | Critical step failed |
| `CANCELLED` | Job cancelled by user |

```
PENDING → PROCESSING → COMPLETED
              ├──→ FAILED
              └──→ CANCELLED
```

## See Also

- Diagram: `docs/diagrams/step-status-state-machine.mermaid`
- Race conditions: `docs/guides/race-condition-prevention.md` (RC1-RC4)
- Maintenance tasks: `docs/guides/MAINTENANCE-TASKS.md`
- WAITING_FOR_CHILDREN feature: `CHANGELOG/features/2026-02-05-waiting-for-children-status.md`
- SE coverage: 4 maintenance SEs test recovery for each stuck state:
  - SE 10: `setpoint-evals/10-stuck-waiting-for-children-recovery/` -- WAITING_FOR_CHILDREN recovery
  - SE 11: `setpoint-evals/11-stuck-delegated-recovery/` -- DELEGATED re-delegation
  - SE 12: `setpoint-evals/12-stuck-pending-recovery/` -- PENDING with satisfied deps
  - SE 13: `setpoint-evals/13-in-progress-auto-timeout/` -- IN_PROGRESS auto-fail (sequential only)
