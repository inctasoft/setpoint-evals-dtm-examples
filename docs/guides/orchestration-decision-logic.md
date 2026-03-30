# Orchestration Decision Logic (continueJob)

The orchestration "brain" lives in `services/orchestrator/src/orchestration/orchestration.service.ts`.

The `continueJob(jobId)` method is called after **every** step state change (completion, failure, ACK receipt). It analyzes the current state of all steps and decides what to do next.

## When Is continueJob() Called?

| Trigger | Service | What Happened |
|---------|---------|---------------|
| Step callback (success/failure) | `callback.service.ts` | Worker finished, step updated to COMPLETED or retry/FAILED |
| ACK received | `acknowledgement.handler.ts` | Dev-ack-simulator sent ACK, step moved from WAITING_FOR_ACK to COMPLETED |
| Fan-out children complete | `fan-out.service.ts` | All child steps done, parent updated |
| Maintenance task recovery | `orphaned-job-recovery.task.ts` | Stuck job detected, continueJob() retried |

## Step Classification

On entry, all steps for the job are fetched and classified:

| Category | Statuses Included | Meaning |
|----------|-------------------|---------|
| `completedSteps` | COMPLETED, PARTIAL_SUCCESS | Dependencies satisfied — downstream steps can proceed |
| `pendingSteps` | PENDING | Not yet started |
| `failedSteps` | FAILED | Permanently failed (retries exhausted) |
| `inProgressSteps` | DELEGATED, IN_PROGRESS, IN_PROGRESS_RETRYING, WAITING_FOR_ACK, WAITING_FOR_CHILDREN | Currently executing or waiting |

**Critical**: WAITING_FOR_ACK is classified as **in-progress**, NOT completed. This means dependent steps must wait until the ACK arrives before their dependencies are satisfied.

## Decision Tree (4 Cases)

### Case 1: Failed Steps Exist (`failedSteps.length > 0`)

1. **Skip dependent pending steps**: `markDependentStepsAsSkipped()` walks the dependency graph and marks any PENDING step whose dependencies include a FAILED step as SKIPPED.

2. **Re-fetch remaining state** (pending and in-progress counts may have changed after skipping).

3. **Sub-cases**:
   - **All terminal** (no pending, no in-progress): Evaluate outcome rules → FAILED or PARTIAL_SUCCESS
   - **No pending, some in-progress**: Wait for in-progress steps to finish (they'll trigger another continueJob() call)
   - **Still pending**: Independent branches exist with satisfied dependencies → **fall through to Case 4** to delegate them

**This fall-through is critical.** Without it, a failure on one branch would block delegation of independent branches. For example, if ValidatePayment fails but SubmitOrder just completed, SubmitShipment (which depends on ValidateShipment + SubmitOrder) should still be delegated.

### Case 2: All Steps Completed

If `steps.length === completedSteps.length`, every step succeeded. Call `completeJob()` → job status becomes COMPLETED.

### Case 3: In-Progress Steps, No Pending

If steps are still executing (DELEGATED, IN_PROGRESS, WAITING_FOR_ACK, etc.) and there are no PENDING steps left, just wait. Those in-progress steps will trigger `continueJob()` again when they finish.

**Note**: This only short-circuits if `pendingSteps.length === 0`. If pending steps exist, we fall through to Case 4.

### Case 4: Delegate Ready Steps

`findReadySteps()` checks each PENDING step's dependencies against `completedSteps`:
- If ALL dependencies are in `completedSteps` → step is ready
- If ANY dependency is missing → step waits

Ready steps are delegated:
- **Single step**: `delegateStep()` with full dependency output data
- **Multiple steps**: `delegateMultipleSteps()` for parallel delegation

Each delegation uses atomic `claimForDelegation()` to prevent race conditions from concurrent `continueJob()` calls.

## Outcome Rule Evaluation

When Case 1 reaches "all terminal", `evaluateOutcome()` runs:

1. **Build step status map**: `{ "ValidateCustomer": "completed", "ValidatePayment": "failed", ... }`

2. **Build cascade counts from cascade config**: For each cascade in the workflow's cascade configuration:
   - Count output steps with COMPLETED status → `cascadeCounts[cascadeName]`
   - Count output/input steps with FAILED status → `failedCounts[cascadeName]`
   - Track which cascades were attempted

3. **Build JobContext**: `{ jobId, workflowVariant, cascadeCounts, failedCounts, emptyCascades, attemptedCascades, stepStatuses }`

4. **Evaluate rules**: Call `wfConfig.determineOutcome(ctx)` which iterates outcome rules in priority order. First matching rule wins.

5. **Execute result**:
   - `jobStatus: 'failed'` → `failJob()`
   - `jobStatus: 'partial_success'` → `partialSuccessJob()`
   - `jobStatus: 'completed'` → `completeJob()`

See `docs/guides/outcome-rules.md` for full outcome rules documentation.

## Dependency Resolution

`findReadySteps()` uses the workflow's step definitions to check dependencies:

```typescript
// A step is "ready" when ALL its dependencies are in completedSteps
const isReady = stepDef.dependencies.every(dep =>
  completedSteps.some(s => s.stepValue === dep)
);
```

Steps with empty `dependencies: []` are root steps — always ready at job start.

### Example: Order-Processing Default Variant

```
ValidateCustomer  []                                → Ready at start (root)
ValidateProduct   []                                → Ready at start (root)
SubmitCustomer   [ValidateCustomer]                 → Ready when ValidateCustomer completes
ValidateOrder    [ValidateCustomer]                  → Ready when ValidateCustomer completes
SubmitOrder      [ValidateOrder, SubmitCustomer]     → Ready when BOTH complete
ValidatePayment  [ValidateOrder]                     → Ready when ValidateOrder completes
SubmitPayment    [ValidatePayment, SubmitOrder]      → Ready when BOTH complete
```

## Race Condition Prevention

Four documented race conditions are prevented:

| ID | Scenario | Guard |
|----|----------|-------|
| RC1 | Duplicate callback for already-completed step | Terminal state check rejects callback |
| RC2 | Discovery callback + child callback arrive simultaneously | Discovery defers continueJob() |
| RC3 | Step callback + ACK callback arrive simultaneously | ACK defers if step not yet WAITING_FOR_ACK |
| RC4 | Multiple continueJob() calls try to delegate same step | Atomic `claimForDelegation()` (DB-level row lock) |

## Debugging Tips

### Job stuck in PROCESSING with all steps COMPLETED
- Check if any transform step is in WAITING_FOR_ACK (ACK hasn't arrived yet)
- Check dev-ack-simulator logs for Kafka consumer lag
- Run: `docker exec dtm-db psql -U dtm_user -d dtm -c "SELECT step_value, status FROM dtm_steps WHERE job_id = '<id>' ORDER BY step_value"`

### Step stuck in PENDING when dependencies are met
- Verify the dependency is in COMPLETED status (not WAITING_FOR_ACK)
- Check orchestrator logs for `continueJob` calls
- The orphaned-job-recovery maintenance task (every 30s in dev) should catch this

### STE timing out despite steps completing
- ACK roundtrip through Kafka takes ~5-30s (dev-ack-simulator consumer lag)
- Default-variant jobs with ACK steps take ~25-70s total
- Ensure STE `poll_job` timeout is generous (600s recommended for default-variant)
- Ensure `ORCHESTRATOR_URL` points to port 3002 (not 3000)
