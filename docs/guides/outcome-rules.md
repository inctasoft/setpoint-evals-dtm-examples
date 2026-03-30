# Outcome Rules & Cascade Criticality

Outcome rules determine the final job status (COMPLETED, PARTIAL_SUCCESS, or FAILED) when a job has both successful and failed steps. They are defined per-workflow in `workflows/<name>/workflow.config.ts`.

## Core Concept

Not all cascade failures are equal. In an e-commerce pipeline, failing to process a customer record should fail the entire job (the customer is the central cascade). But failing to process a payment record might be acceptable — the order can still proceed, and payment can be retried later.

Outcome rules formalize this distinction through **cascade criticality**.

## Cascade Criticality

Each cascade in a workflow's cascade configuration has a `criticality` field:

```typescript
// In workflow.config.ts → CASCADE_CRITICALITY array
{ cascadeName: 'customer', criticality: 'required', allowEmpty: false, minCount: 1 }
{ cascadeName: 'order',    criticality: 'required', allowEmpty: false, minCount: 1 }
{ cascadeName: 'lineItem', criticality: 'optional', allowEmpty: true }
{ cascadeName: 'payment',   criticality: 'optional', allowEmpty: true }
{ cascadeName: 'shipment',  criticality: 'optional', allowEmpty: true }
```

| Criticality | Failure Impact | Example |
|-------------|---------------|---------|
| `required` | Job FAILED | Customer, Order — cannot proceed without these cascades |
| `optional` | Job PARTIAL_SUCCESS | LineItem, Payment, Shipment — job partially succeeds |

## Outcome Rule Structure

Each rule has:

```typescript
interface OutcomeRule {
  id: string;              // Unique identifier (e.g., 'critical-cascade-failed')
  description: string;     // Human-readable description
  priority: number;        // Lower = evaluated first. First match wins.
  condition: (ctx: JobContext) => boolean;   // Predicate
  outcome: (ctx: JobContext) => OutcomeResult; // Result generator
}
```

Rules are evaluated in **priority order** (ascending). The **first** rule whose `condition()` returns true wins.

## JobContext (Input to Rules)

Built by `evaluateOutcome()` in `orchestration.service.ts`:

```typescript
interface JobContext {
  jobId: string;
  workflowVariant: string;          // 'default', 'quick-order', etc.
  cascadeCounts: Record<string, number>;    // Successful output count per cascade
  failedCounts: Record<string, number>;    // Failed output/input count per cascade
  emptyCascades: string[];          // Cascades with allowEmpty where no data was found
  attemptedCascades: string[];      // Cascades that had at least one step executed
  stepStatuses: Record<string, string>;    // Step name → status map
}
```

### How Cascade Counts Are Built

For each cascade in the cascade config:
1. Find all output steps matching `cascade.outputStep`
2. Count COMPLETED/PARTIAL_SUCCESS output steps → `cascadeCounts[cascadeName]`
3. Count FAILED output steps → `failedCounts[cascadeName]`
4. If no output steps succeeded, check input steps for FAILED → also counts as `failedCounts`
5. If any step (output or input) exists → cascade was "attempted"

## Example: Order-Processing Workflow Rules

### Rule 1: `critical-cascade-failed` (Priority 10)
**Condition**: Any required cascade (customer, order) was attempted but has zero successes and is not empty.
**Result**: FAILED
**Example**: ValidateCustomer fails (customerId 99999 not found) → customer attempted, 0 successes → FAILED

### Rule 2: `full-success` (Priority 20)
**Condition**: Every attempted cascade either succeeded or was validly empty, with zero failures.
**Result**: COMPLETED
**Example**: All 6 cascades validate and submit successfully → COMPLETED

### Rule 3: `partial-success-optional-failed` (Priority 30)
**Condition**: All required cascades succeeded AND at least one optional cascade failed.
**Result**: PARTIAL_SUCCESS
**Example**: Customer and Order succeed, but ValidatePayment fails (paymentId 99999) → SubmitPayment skipped → payment has failures → PARTIAL_SUCCESS

### Rule 4: `fallback-unknown` (Priority 100)
**Condition**: Always true (catch-all).
**Result**: FAILED
**Purpose**: Safety net for edge cases not covered by other rules.

## OutcomeResult (Output)

```typescript
interface OutcomeResult {
  jobStatus: 'completed' | 'partial_success' | 'failed';
  reason: string;           // Human-readable explanation
  warnings: string[];       // Non-fatal issues
  errors: string[];         // Fatal issues
  metadata: Record<string, unknown>; // Additional data (failed cascades, counts, etc.)
}
```

## How the Orchestrator Uses Outcome Rules

In `orchestration.service.ts` → `continueJob()` → Case 1 (all steps terminal, some failed):

```
1. job = findById(jobId)
2. wfConfig = getWorkflowConfig(job)  // Resolves correct workflow from registry
3. allSteps = findByJobId(jobId)
4. outcome = evaluateOutcome(job, allSteps, wfConfig)
5. Log: "Job {id}: Outcome rule '{rule}' → {status}. Reason: {reason}"
6. Switch on outcome.result.jobStatus:
   - 'partial_success' → partialSuccessJob(jobId, reason)
   - 'failed' → failJob(jobId, reason)
```

## PARTIAL_SUCCESS Job Status

Added to the `JobStatus` enum in `packages/database/src/entities/job.entity.ts`:
```typescript
export enum JobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  PARTIAL_SUCCESS = "partial_success",  // ← New
  FAILED = "failed",
  CANCELLED = "cancelled",
}
```

`partialSuccessJob()` calculates statistics, publishes a `JobCompletedEvent` to Kafka with PARTIAL_SUCCESS status, and updates the job record.

## Writing Outcome Rules for a New Workflow

When creating a new workflow, define rules in `workflow.config.ts`:

1. Identify which cascades are critical vs optional
2. Define CASCADE_CRITICALITY array with `criticality` and `allowEmpty` fields
3. Write OUTCOME_RULES array with priority-ordered predicates
4. Always include a fallback rule at priority 100
5. Export rules in the WorkflowDefinition: `outcomeRules: OUTCOME_RULES, cascadeCriticalityRules: CASCADE_CRITICALITY`

Test with STEs that exercise each rule:
- Happy path → full-success rule → COMPLETED
- Critical cascade failure → critical-cascade-failed rule → FAILED
- Optional cascade failure → partial-success rule → PARTIAL_SUCCESS
