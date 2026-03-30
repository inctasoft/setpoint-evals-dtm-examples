# WorkflowDefinition Contract

Every DTM workflow must export a `WorkflowDefinition` object. This is the single configuration file that tells the DTM orchestrator how to execute your workflow.

**Interface**: `packages/core/src/interfaces/workflow-definition.interface.ts`
**Reference implementation**: `workflows/order-processing/workflow.config.ts`

## Top-Level Fields

```typescript
interface WorkflowDefinition {
  name: string;                                    // Required
  description: string;                             // Required
  variants: Record<string, WorkflowVariant>;       // Required
  steps: Record<string, StepDefinition[]>;         // Required
  cascades: CascadeConfig[];                         // Required
  outcomeRules: OutcomeRule[];                      // Required
  cascadeCriticalityRules: CascadeCriticalityRule[];  // Required
  notificationRules?: NotificationRule[];           // Optional
  loggingRules?: LoggingRule[];                     // Optional
  featureFlags?: FeatureFlagConfig;                 // Optional
}
```

## Variants

Variants define different execution modes for the same workflow. Each variant gets its own step DAG.

```typescript
variants: {
  default: { description: 'Standard mode', isDefault: true },
  batch: { description: 'Batch processing mode' },
}
```

> **Note:** Variant names are workflow-specific. Each workflow defines its own variants to suit its domain (e.g., `default` / `batch`, `quick-order` / `full-order`).

- One variant **must** have `isDefault: true`
- The variant name is passed in the job creation request
- Steps are keyed by variant name

## Steps (Step DAG)

Steps define the work units and their dependency graph. Each variant has its own step array.

```typescript
interface StepDefinition {
  step: string;              // Unique identifier
  description: string;       // Human-readable
  functionName: string;      // Lambda function name
  queueName: string;         // SQS queue name
  dependencies: string[];    // Step names that must complete first
  requiresAcknowledgement?: boolean;  // Wait for external ACK?
  fanOut?: FanOutConfig;     // Fan-out discovery config
  isChildStep?: boolean;     // True for dynamically created children
  itemIdInputField?: string;  // Field name for child item ID
  timeoutMs?: number;        // IN_PROGRESS timeout (default: 30min)
  metadata?: Record<string, unknown>;  // Passed to workers
}
```

### Dependency Resolution

Steps with **empty dependencies** (`[]`) start immediately in parallel.
Steps with dependencies wait for **all** listed steps to reach COMPLETED.

```typescript
// These two run in parallel (no dependencies):
{ step: 'ValidateCustomer', dependencies: [] },
{ step: 'ValidateProduct', dependencies: [] },

// This waits for ValidateCustomer:
{ step: 'ValidateOrder', dependencies: ['ValidateCustomer'] },

// This waits for BOTH:
{ step: 'SubmitCustomer', dependencies: ['ValidateCustomer'] },
```

### Fan-Out Steps

Discovery steps use the `fanOut` field to create N child steps dynamically:

```typescript
{
  step: 'DiscoverLineItems',
  dependencies: ['ValidateOrder'],
  fanOut: {
    enabled: true,
    childStepType: 'ValidateLineItem',
    itemIdField: 'lineItemId',
    childStepChain: ['ValidateLineItem', 'SubmitLineItem'],
  },
}
```

The discovery worker returns a list of item IDs. For each ID, the orchestrator creates the full `childStepChain`.

## Cascades (FK Dependencies)

Cascades define how entities relate through foreign keys and what Kafka topics to use for publishing and ACKs.

```typescript
interface CascadeConfig {
  cascadeName: string;             // Cascade identifier
  dependsOn: string[];             // Parent cascade names
  fkFields: Record<string, string>; // { outputField: parentCascadeName }
  transformStep: string;           // Which step produces this cascade's output
  kafkaTopic?: string;             // Publish completed data here
  ackTopic?: string;               // Listen for ACKs here
  isFanOutParent?: boolean;        // Uses discovery + children
  discoveryStep?: string;          // Discovery step name
  fkMapLookupFields?: Record<string, string>;  // FK lookup by record field (cascade-level)
}
```

### FK Injection Example

```typescript
{
  cascadeName: 'order',
  dependsOn: ['customer'],
  fkFields: { ext_customer_id: 'customer' },
  transformStep: 'SubmitOrder',
  kafkaTopic: 'order-processing.order.completed',
  ackTopic: 'order-processing.order.ack',
}
```

When `consumer` receives an ACK with `externalId: "abc-123"`, the orchestrator injects `ext_consumer_id: "abc-123"` into the `orders` payload before publishing.

## Outcome Rules

Rules evaluated in priority order (lowest number = highest priority). First matching rule wins.

```typescript
interface OutcomeRule {
  id: string;                              // Unique identifier
  description: string;                     // Human-readable
  priority: number;                        // Lower = evaluated first
  condition: (ctx: JobContext) => boolean;  // Match predicate
  outcome: (ctx: JobContext) => OutcomeResult;  // Result producer
}
```

The `JobContext` provides:
- `cascadeCounts`: Successful cascades by name
- `failedCounts`: Failed cascades by name
- `emptyCascades`: Cascades with zero records found
- `stepStatuses`: Status of every step by name

### Pattern: Priority Ranges

```
10-49:  Error conditions (consumer not found, critical failure)
50-99:  Warning conditions (partial success, optional cascade missing)
100:    Full success (all cascades processed)
200+:   Fallback rules (catch-all)
```

## Cascade Criticality Rules

Define which cascades must succeed for the job to be considered successful.

```typescript
interface CascadeCriticalityRule {
  cascadeName: string;
  criticality: 'required' | 'optional' | 'conditional';
  allowEmpty: boolean;       // Is 0 records acceptable?
  minCount?: number;         // Minimum required count
  condition?: (ctx: JobContext) => boolean;  // For 'conditional'
}
```

- **required**: Job fails if this cascade fails
- **optional**: Job can succeed even if this cascade fails
- **conditional**: Required only when `condition()` returns true

## Feature Flags

Three-layer resolution: workflow defaults -> env vars -> per-request overrides.

```typescript
interface FeatureFlagConfig {
  defaults: Record<string, unknown>;
  clientOverridable?: string[];
}
```

Resolution order:
1. `featureFlags.defaults` (from this config)
2. Environment variable `FEATURE_FLAG_ENABLE_DEDUPLICATION=false`
3. Per-request body (only if flag is listed in `clientOverridable`)

## See Also

- State machine: `docs/guides/step-status-machine.md`
- Creating a workflow: `docs/guides/creating-a-workflow.md`
- Reference implementation: `workflows/order-processing/workflow.config.ts`
- Template: `workflows/00-template/workflow.config.ts`
