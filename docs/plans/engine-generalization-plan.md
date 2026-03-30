# DTM Engine Generalization Plan

> **Goal**: Remove all ETL/migration-era naming from the DTM engine core, database schema, and worker SDK. Make DTM a truly generic distributed workflow orchestration engine where all domain-specific terminology lives exclusively in workflow configs.

> **Status**: Historical — this plan is largely completed. Phases 1-8 have been implemented. This document is retained as architectural reference.
>
> **Note**: All `npdPrimaryKey` references have been renamed to `externalId`, and all `npd_*_id` FK field patterns have been renamed to `ext_*_id`. The `migrationType → jobType` rename (Phase 4) is also complete.

---

## Table of Contents

1. [Phase 1: Config Metadata Rename](#phase-1-config-metadata-rename)
2. [Phase 2: Add Explicit `collectDependencyOutputs` Flag](#phase-2-add-explicit-collectdependencyoutputs-flag)
3. [Phase 3: Cascade Config Generalization](#phase-3-cascade-config-generalization)
4. [Phase 4: `migrationType` → `jobType` Rename](#phase-4-migrationtype--jobtype-rename)
5. [Phase 5: `JobType` Enum Generalization](#phase-5-jobtype-enum-generalization)
6. [Phase 6: Database Schema Cleanup](#phase-6-database-schema-cleanup)
7. [Phase 7: Worker SDK Generalization](#phase-7-worker-sdk-generalization)
8. [Phase 8: Documentation & Comment Cleanup](#phase-8-documentation--comment-cleanup)
9. [File Impact Matrix](#file-impact-matrix)
10. [Implementation Order](#implementation-order)
11. [Verification Checklist](#verification-checklist)

---

## Phase 1: Config Metadata Rename

### What
Rename the metadata keys that workflows use to pass configuration to workers:
- `extractConfig` → `sourceConfig`
- `transformConfig` → `processingConfig`

### Why
These names leak ETL framing into what are generic "worker configuration" objects. The actual semantics are:
- **sourceConfig**: Tells the worker _where_ to fetch data from (source database, table, filter key)
- **processingConfig**: Tells the worker _how_ to process data (data type, list of operations)

### Current Structure

```typescript
// sourceConfig (currently extractConfig)
{
  sourceDatabase: string;   // Source system database name
  sourceTable: string;      // Table to query
  filterKey: string;        // Primary key field for filtering
}

// processingConfig (currently transformConfig)
{
  inputDataType: string;    // Entity type being processed
  transformations: string[];// List of processing operations
}
```

> **Note**: The field names _inside_ these configs (`sourceDatabase`, `sourceTable`, `filterKey`, `inputDataType`, `transformations`) are already reasonably generic and don't need renaming.

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `services/orchestrator/src/delegation/dto/step-delegation.dto.ts` | Rename fields `extractConfig` → `sourceConfig`, `transformConfig` → `processingConfig`. Rename interfaces `ExtractConfig` → `SourceConfig`, `TransformConfig` → `ProcessingConfig`. Update JSDoc. |
| 2 | `services/orchestrator/src/aws/sqs.service.ts` | Rename `LambdaStepPayload` fields and interface comments. |
| 3 | `services/orchestrator/src/orchestration/orchestration.service.ts` | 6 sites (lines 167-169, 209-211, 909-911, 975-978) — update `metadata?.extractConfig` → `metadata?.sourceConfig`, same for `transformConfig`. |
| 4 | `services/orchestrator/src/orchestration/fan-out.service.ts` | 3 sites (lines 240-241, 542-544) — same rename. |
| 5 | `services/orchestrator/src/delegation/delegation.service.ts` | 3 sites (lines 70-71, 216-217) — same rename. |
| 6 | `packages/worker-sdk/src/types.ts` | Rename interfaces `ExtractConfig` → `SourceConfig`, `TransformConfig` → `ProcessingConfig`. Rename fields on `ExtractWorkMessage` → `SourceWorkMessage`, `TransformWorkMessage` → `ProcessingWorkMessage`. |
| 7 | `workflows/order-processing/workflow.config.ts` | All step metadata keys: `extractConfig:` → `sourceConfig:`, `transformConfig:` → `processingConfig:` |
| 8 | `workflows/iot-sensor-pipeline/workflow.config.ts` | Same metadata key renames. |
| 9 | `workflows/infra-provisioning/workflow.config.ts` | Same metadata key renames. |
| 10 | `workflows/00-template/workflow.config.ts` | Same metadata key renames (if present). |
| 11 | `services/orchestrator/src/aws/sqs.service.spec.ts` | Update test names and assertions. |
| 12 | `services/orchestrator/src/delegation/delegation.service.spec.ts` | Update test data. |

### Estimated Scope
~12 files, ~50 individual edits (mostly mechanical find-and-replace).

---

## Phase 2: Add Explicit `collectDependencyOutputs` Flag

### What
Add a `collectDependencyOutputs: boolean` field to `StepDefinition` to replace the behavioral heuristic `if (stepDef.metadata?.transformConfig)`.

### Why
Currently, the engine decides how to pass dependency data to workers based on whether `transformConfig` exists in metadata:
- If `transformConfig` exists → call `collectDependencyOutputs()` → merge full output data into `inputData.dependencyData`
- If no `transformConfig` → call `collectDataReferencesFromDependencies()` → pass lightweight references in `inputData.dataReferences`

This couples an implementation detail (config key name) to a behavioral decision. After renaming to `processingConfig`, we'd just be creating the same coupling with a different name.

### Current Heuristic (4 sites)

```typescript
// orchestration.service.ts:885
if (stepDef.metadata?.transformConfig) {
  const dependencyData = this.collectDependencyOutputs(stepDef, completedSteps);
  inputData = { ...(step.input ?? {}), ...(Object.keys(dependencyData).length > 0 && { dependencyData }) };
} else {
  const dataReferences = this.collectDataReferencesFromDependencies(stepDef, completedSteps);
  inputData = { ...(step.input ?? {}), ...(dataReferences.length > 0 && { dataReferences }) };
}

// orchestration.service.ts:949 — same pattern
// delegation.service.ts:193 — same pattern
```

### Proposed Fix

```typescript
// In StepDefinition interface:
export interface StepDefinition {
  // ... existing fields ...

  /**
   * If true, the orchestrator collects full output data from dependency steps
   * and passes it as `inputData.dependencyData`.
   * If false/undefined, passes lightweight data references instead.
   *
   * Typically true for "second-phase" steps (Submit, Apply, Publish, etc.)
   * that need the full data produced by their dependency steps.
   */
  collectDependencyOutputs?: boolean;
}
```

```typescript
// Engine code becomes:
if (stepDef.collectDependencyOutputs) {
  const dependencyData = this.collectDependencyOutputs(stepDef, completedSteps);
  // ...
}
```

### Migration Path for Workflow Configs
Every step that currently has `transformConfig` in metadata should also get `collectDependencyOutputs: true`:

```typescript
// Before:
{
  step: 'SubmitCustomer',
  metadata: { transformConfig: { ... } },
}

// After:
{
  step: 'SubmitCustomer',
  collectDependencyOutputs: true,
  metadata: { processingConfig: { ... } },
}
```

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `packages/core/src/interfaces/workflow-definition.interface.ts` | Add `collectDependencyOutputs?: boolean` to `StepDefinition` |
| 2 | `services/orchestrator/src/orchestration/orchestration.service.ts` | Replace `if (stepDef.metadata?.transformConfig)` → `if (stepDef.collectDependencyOutputs)` at 2 sites (lines 885, 949) |
| 3 | `services/orchestrator/src/delegation/delegation.service.ts` | Replace same heuristic at line 193 |
| 4 | `workflows/order-processing/workflow.config.ts` | Add `collectDependencyOutputs: true` to all Submit* steps |
| 5 | `workflows/iot-sensor-pipeline/workflow.config.ts` | Add `collectDependencyOutputs: true` to all Provision/Activate/Publish/Dispatch steps |
| 6 | `workflows/infra-provisioning/workflow.config.ts` | Add `collectDependencyOutputs: true` to all Apply* steps |
| 7 | `workflows/00-template/workflow.config.ts` | Add flag to transform step template |

### Estimated Scope
~7 files, ~30 edits.

---

## Phase 3: Cascade Config Generalization

### What
1. Rename `EntityCascadeConfig.transformStep` → `EntityCascadeConfig.outputStep`
2. Add `EntityCascadeConfig.inputStep` (replaces hardcoded `Extract` prefix convention)
3. Rename `EntityCascadeConfig.transformedDataKey` → `EntityCascadeConfig.outputDataKey`

### Why

#### `transformStep` → `outputStep`
This field identifies the step that **produces** an entity's data for Kafka publishing. It's not always a "transform" — in order-processing it's `SubmitCustomer`, in IoT it's `ProvisionDevice`, in infra it's `ApplyEnvironment`. The generic name `outputStep` accurately describes its purpose: "the step whose output contains this entity's data."

#### Add `inputStep` (Critical Bug Fix)
**This fixes an active bug.** The outcome evaluation in `orchestration.service.ts:524` uses a hardcoded convention to find extract steps:

```typescript
// BUG: hardcoded Extract prefix — broken after step rename!
const extractStepName = `Extract${entityType.charAt(0).toUpperCase()}${entityType.slice(1)}`;
const extractSteps = steps.filter((s) => s.stepValue === extractStepName);
```

After the step rename (ValidateCustomer, RegisterDevice, PlanEnvironment), this line **never finds any extract steps**, causing:
- `attemptedEntities` to potentially miss entities where only the first-phase step ran
- `failedCounts` to miss first-phase failures when no second-phase step exists

**Fix**: Add `inputStep` to cascade config to explicitly declare the first-phase step:

```typescript
export interface EntityCascadeConfig {
  inputStep?: string;   // First-phase step (e.g., 'ValidateCustomer', 'PlanEnvironment')
  outputStep: string;   // Second-phase step (e.g., 'SubmitCustomer', 'ApplyEnvironment')
  // ...
}
```

Then the engine code becomes:
```typescript
const inputStepName = cascade.inputStep;
const inputSteps = inputStepName
  ? steps.filter((s) => s.stepValue === inputStepName)
  : [];
```

#### `transformedDataKey` → `outputDataKey`
This field names the key in step output containing the entity data array. Current values like `submittedCustomers`, `appliedEnvironments`, `provisionedDevices` are already domain-appropriate — only the _field name_ in the interface needs to be generic.

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `packages/core/src/interfaces/workflow-definition.interface.ts` | Rename `transformStep` → `outputStep`, add `inputStep?`, rename `transformedDataKey` → `outputDataKey` |
| 2 | `services/orchestrator/src/orchestration/orchestration.service.ts` | Update all `cascade.transformStep` refs → `cascade.outputStep`. Fix line 524 to use `cascade.inputStep` instead of `Extract` prefix. Update `transformedDataKey` refs. |
| 3 | `services/orchestrator/src/orchestration/cascade-publish.service.ts` | Update all `transformedDataKey` → `outputDataKey` refs (~15 occurrences) |
| 4 | `services/orchestrator/src/callback/callback.service.ts` | Update `transformedDataKey` → `outputDataKey` refs (~10 occurrences), `transformStep` → `outputStep` |
| 5 | `services/orchestrator/src/workflow-loader/workflow-config.service.ts` | Update all `cascade.transformStep` → `cascade.outputStep` (~12 occurrences) |
| 6 | `services/orchestrator/src/workflow-loader/workflow-management.controller.ts` | Update `transformStep` ref |
| 7 | `services/orchestrator/src/workflow-loader/workflow-management.controller.spec.ts` | Update test data |
| 8 | `workflows/order-processing/workflow.config.ts` | Rename cascade fields, add `inputStep` for each entity |
| 9 | `workflows/iot-sensor-pipeline/workflow.config.ts` | Same |
| 10 | `workflows/infra-provisioning/workflow.config.ts` | Same |
| 11 | `workflows/00-template/workflow.config.ts` | Same |

### Example: Order Processing Cascade (Before → After)

```typescript
// Before:
{
  entityType: 'customer',
  transformStep: 'SubmitCustomer',
  transformedDataKey: 'submittedCustomers',
  // ... other fields
}

// After:
{
  entityType: 'customer',
  inputStep: 'ValidateCustomer',
  outputStep: 'SubmitCustomer',
  outputDataKey: 'submittedCustomers',
  // ... other fields
}
```

### Estimated Scope
~11 files, ~60 edits. **Highest-priority phase** due to the active bug at line 524.

---

## Phase 4: `migrationType` → `jobType` Rename

### What
Rename the `migrationType` field to `jobType` everywhere it appears in the SQS message payload, delegation DTO, and worker SDK types.

### Why
`migrationType` is a legacy name from when DTM was a migration service. The field carries the `JobType` value (e.g., `'membership'`, `'deal'`), which tells workers what type of job this step belongs to. The field should simply be called `jobType` to match its TypeScript type.

### Current Flow
```
orchestration.service.ts → builds StepDelegationDto { migrationType: job.type }
delegation.service.ts → passes dto.migrationType to LambdaStepPayload
sqs.service.ts → sends payload.migrationType as SQS message attribute
worker-sdk/types.ts → BaseWorkMessage { migrationType: string }
```

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `services/orchestrator/src/delegation/dto/step-delegation.dto.ts` | `migrationType` → `jobType` |
| 2 | `services/orchestrator/src/aws/sqs.service.ts` | `LambdaStepPayload.migrationType` → `jobType`, SQS attribute name `migrationType` → `jobType` |
| 3 | `services/orchestrator/src/orchestration/orchestration.service.ts` | All 4 sites building `StepDelegationDto` (lines 165, 207, 907, 973) + parameter name at line 1267 |
| 4 | `services/orchestrator/src/orchestration/fan-out.service.ts` | 2 sites (lines 238, 540) |
| 5 | `services/orchestrator/src/delegation/delegation.service.ts` | 2 sites (lines 66, 214) |
| 6 | `services/orchestrator/src/callback/callback.service.ts` | 1 site (line 62 parameter name) |
| 7 | `packages/worker-sdk/src/types.ts` | `BaseWorkMessage.migrationType` → `jobType` |
| 8 | `services/orchestrator/src/aws/sqs.service.spec.ts` | ~10 test data updates |
| 9 | `services/orchestrator/src/delegation/delegation.service.spec.ts` | ~30 test data updates |

### SQS Message Attribute Rename
The SQS message attribute name changes from `migrationType` to `jobType`:
```typescript
// Before:
migrationType: { DataType: 'String', StringValue: payload.migrationType }
// After:
jobType: { DataType: 'String', StringValue: payload.jobType }
```

**Impact**: If any external system reads SQS message attributes, the attribute name changes. Since workers parse the message body (not attributes), this is a low-risk change. The SQS poller does not use message attributes.

### Estimated Scope
~9 files, ~50 edits (mostly spec files).

---

## Phase 5: `JobType` Enum Generalization

### What
Generalize the `JobType` enum values from domain-specific names to workflow-generic names, OR move `JobType` out of the core database package into workflow-specific config.

### Current Values
```typescript
export enum JobType {
  MEMBERSHIP = "membership",
  MEMBERSHIP_BATCH = "membership_batch",
  DEAL = "deal",
}
```

These are legacy values from the original single-workflow migration service. They don't correspond to the 3 current workflows.

### Option A: Generic Enum (Recommended)
Replace with generic variant names that workflows can extend:

```typescript
export enum JobType {
  DEFAULT = "default",
  BATCH = "batch",
}
```

Each workflow's variants define the actual job type strings. The `Job.type` column is already `varchar(255)` (not an enum column), so it can hold any string value. The TypeScript type is `JobType | string`, confirming this flexibility.

### Option B: Remove Enum, Use String
Since `Job.type` is already typed as `JobType | string`, and each workflow defines its own variants, the `JobType` enum could be removed entirely. The `type` field would become `string`.

### Recommendation
**Option A** — keep a minimal enum with common defaults (`DEFAULT`, `BATCH`) but rely on the `| string` escape hatch for workflow-specific values. This provides IDE autocomplete for common cases without forcing domain-specific values into the core.

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `packages/database/src/entities/job.entity.ts` | Update `JobType` enum values |
| 2 | `packages/database/src/index.ts` | No change (already exports `JobType`) |
| 3 | `packages/database/src/repositories/job.repository.ts` | Update `findByType` references |
| 4 | All spec files using `JobType.MEMBERSHIP` | Update to `JobType.DEFAULT` or the appropriate value |
| 5 | All workflow configs using `JobType` values | Map variants to new enum values |

### Database Migration
A TypeORM migration will be needed to update existing `type` values in `dtm_jobs`. Since the column is `varchar` (not a PostgreSQL enum), this is a simple `UPDATE` statement.

### Estimated Scope
~15 files, ~80 edits (many in spec files).

---

## Phase 6: Database Schema Cleanup

### What
Remove/rename legacy domain-specific fields and types from the core database package.

### 6A: `JobPayload` Cleanup

The `JobPayload` interface in `job.entity.ts` contains legacy domain-specific fields:

| Field | Issue | Action |
|-------|-------|--------|
| `consumerNo?: number` | Domain-specific (PPBO consumer) | Remove — workflows use `input` record |
| `membershipNo?: number` | Domain-specific | Remove |
| `dealId?: string` | Domain-specific | Remove |
| `externalSystemId?: string` | Comment says "migration" | Keep field, fix comment |
| `filters.consumerIds` | Domain-specific | Remove entire `filters` block — move to workflow payload |
| `filters.membershipIds` | Domain-specific | Remove |
| `filters.dealIds` | Domain-specific | Remove |
| `filters.programCodes` | Domain-specific | Remove |
| `testOptions.extractConsumer` | ETL + domain | Remove these 4 named keys |
| `testOptions.extractMembership` | ETL + domain | Remove |
| `testOptions.transformConsumer` | ETL + domain | Remove |
| `testOptions.transformMembership` | ETL + domain | Remove |

**After cleanup**, `JobPayload` becomes:

```typescript
export interface JobPayload {
  description?: string;
  entityId?: string;

  // External system integration
  externalSystemId?: string;
  webhookUrl?: string;

  // Additional filters (workflow-specific, typed by each workflow)
  filters?: Record<string, unknown>;

  // Configuration options
  config?: {
    batchSize?: number;
    skipValidation?: boolean;
    dryRun?: boolean;
    continueOnError?: boolean;
    notifyOnCompletion?: boolean;
  };

  // Test options (step-type-keyed delays and feature flags)
  testOptions?: {
    enableDeduplication?: boolean;
    [key: string]: unknown;
  };

  // Flexible metadata
  metadata?: Record<string, unknown>;
  _trigger?: {
    source?: string;
    topic?: string;
    consumerId?: string;
    triggeredAt?: string;
  };
}
```

### 6B: `Job` Entity Cleanup

The `Job` entity class has domain-specific columns:

| Column | DB Name | Issue | Action |
|--------|---------|-------|--------|
| `dealId` | `deal_id` | Domain-specific | Remove column — move to payload JSONB |
| `membershipNumber` | `membership_number` | Domain-specific | Remove column — move to payload JSONB |
| `membershipId` | `membership_id` | Domain-specific | Remove column — move to payload JSONB |

**Database migration needed**: Drop these 3 columns and their indexes. Any queries filtering by these columns should use JSONB operators on the `payload` column instead.

### 6C: `Step` Entity Comment Fix

Line 197 in step.entity.ts:
```typescript
/**
 * The specific entity ID this child step processes.
 * E.g., order_no for ExtractOrder steps.  // ← Fix this comment
 */
```
→ Update to: `E.g., orderId for ValidateLineItem steps.`

### 6D: `backend-apps-types.ts` Cleanup

This file contains types mirrored from an external library. These are domain-specific types that should NOT be in the generic DTM database package.

| Type | Issue | Action |
|------|-------|--------|
| `MigratedConsumerRecord` | Legacy "Migrated" naming + domain-specific | Move to order-processing workflow (or delete if unused) |
| `MigratedMembershipRecord` | Same | Move or delete |
| `MigrationResultDetails` | Legacy "Migration" naming + domain-specific | Move or delete |
| `MembershipStatus`, `Programme`, `Membership` | External API types | Move to workflow-specific package |
| `ConsumerProfileType` | External API types | Move to workflow-specific package |

**Recommendation**: Check if these types are actually used anywhere. If not (likely — the step rename suggests the original single-workflow code was replaced), delete the entire file.

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `packages/database/src/entities/job.entity.ts` | Remove domain columns and payload fields |
| 2 | `packages/database/src/entities/step.entity.ts` | Fix comment |
| 3 | `packages/database/src/types/backend-apps-types.ts` | Move or delete domain-specific types |
| 4 | `packages/database/src/types/index.ts` | Update exports |
| 5 | New migration file | Drop columns, update indexes |
| 6 | Any files importing removed types | Update imports |

### Estimated Scope
~8 files, ~40 edits + 1 migration file.

---

## Phase 7: Worker SDK Generalization

### What
Rename types in the worker SDK to remove ETL terminology.

### Renames

| Current | New | Notes |
|---------|-----|-------|
| `ExtractConfig` | `SourceConfig` | Worker source configuration |
| `TransformConfig` | `ProcessingConfig` | Worker processing configuration |
| `ExtractWorkMessage` | `SourceWorkMessage` | Message for source-querying workers |
| `TransformWorkMessage` | `ProcessingWorkMessage` | Message for data-processing workers |
| `BaseWorkMessage.migrationType` | `BaseWorkMessage.jobType` | (from Phase 4) |
| `BaseWorkMessage.stepType` | `BaseWorkMessage.stepType` | ✓ Already generic |

### Files to Modify

| # | File | Changes |
|---|------|---------|
| 1 | `packages/worker-sdk/src/types.ts` | Rename all interfaces and fields |
| 2 | `packages/worker-sdk/src/index.ts` | Update exports |
| 3 | Any workers importing these types | Update import names |

### Estimated Scope
~5 files, ~15 edits.

---

## Phase 8: Documentation & Comment Cleanup

### What
Update all documentation, comments, JSDoc, and cursor rules that reference old naming. Ensure every document accurately reflects the current engine and workflow state.

### 8A: Code Comments & JSDoc

| # | File | Changes |
|---|------|---------|
| 1 | `services/orchestrator/src/workflow-loader/workflow-config.service.ts` | Fix comments (lines 9, 11, 124, 630) referencing `migration-steps.config.ts` and `migration-outcome-rules.config.ts` |
| 2 | `packages/core/src/interfaces/workflow-definition.interface.ts` | Fix JSDoc (line 73: `'ExtractConsumer', 'TransformOrder'` → domain examples, line 132: `['ExtractOrder', 'TransformOrder']` → domain examples) |

### 8B: Documentation Guides (Legacy Term Cleanup)

| # | File | Severity | Legacy Terms | Action |
|---|------|----------|-------------|--------|
| 1 | `docs/TEST-OPTIONS-GUIDE.md` | **CRITICAL** | `extractConsumer`, `transformConsumer`, `extractMembership`, `transformMembership` (lines 87-90, 181-188, 222-223, 240-241, 345-348, 467-470) | Rewrite to use current workflow step names (ValidateCustomer, SubmitCustomer, etc.) or make workflow-agnostic with generic examples |
| 2 | `docs/guides/system-architecture.md` | **CRITICAL** | "migration" (20+ occurrences), `/migrations/` API endpoints, `migration.consumer.ack` Kafka topics, domain entities (Consumer, Membership) throughout 2270 lines | Major rewrite needed — replace migration-specific examples with generic multi-workflow examples |
| 3 | `docs/guides/FEATURES.md` | MEDIUM | `transformConfig` (lines 915, 921), `ExtractConsumer`/`TransformConsumer` (lines 53-58) | Update examples to use current naming |
| 4 | `docs/guides/worker-testing-guide.md` | MEDIUM | `extractConfig` (line 41) | Update to `sourceConfig` |
| 5 | `docs/guides/database-schema-overview.md` | LOW | `batch-import` example (line 20) | Update variant example |
| 6 | `docs/guides/callback-contract.md` | LOW | May need config field name updates | Verify after Phases 1-4 |
| 7 | `docs/guides/orchestration-decision-logic.md` | LOW | May need config references updated | Verify after Phases 1-4 |
| 8 | `docs/guides/request-lifecycle.md` | LOW | SQS payload field names | Update `migrationType` → `jobType`, config names |
| 9 | `docs/guides/workflow-definition-contract.md` | LOW | Interface field names | Update after Phase 3 cascade renames |

### 8C: Diagrams

| # | File | Severity | Issue | Action |
|---|------|----------|-------|--------|
| 1 | `docs/diagrams/architecture-detailed.mermaid` | **CRITICAL** | Shows old SMS workflow (ExtractConsumer, TransformConsumer, etc.) — does NOT reflect current multi-workflow architecture | Full rewrite to show generic DTM architecture with 3 example workflows |

### 8D: Cursor Rules (AI Development Guides)

| # | File | Severity | Legacy Terms | Action |
|---|------|----------|-------------|--------|
| 1 | `.cursor/ste-testing.mdc` | HIGH | `migrationType` (lines 146, 150, 152-153), `ExtractOrders`/`TransformOrders` (line 152) | Update to `jobType`, use current step names |
| 2 | `.cursor/ste-writer.mdc` | HIGH | `migrationType` (lines 867-948), `ExtractOrders`/`TransformOrders` (lines 873-888) | Update to `jobType`, use current step names |
| 3 | `.cursor/worker-writer.mdc` | HIGH | Extract-Transform pattern throughout (lines 2-361), `ExtractYourEntity`/`TransformYourEntity` templates | Rewrite templates to use generic two-phase pattern |
| 4 | `.cursor/architecture.mdc` | MEDIUM | Extract-Transform pattern (lines 25-51) | Update pattern name and references |

### 8E: Documentation Completeness Tracker

Track correspondence between code state and documentation after each phase:

| Document | CLAUDE.md | Workflow READMEs | TEST-OPTIONS | FEATURES | system-arch | worker-guide | db-schema | diagrams | cursor rules |
|----------|-----------|-----------------|--------------|----------|-------------|--------------|-----------|----------|-------------|
| Phase 3 (cascade) | - | - | - | - | update | - | update | - | - |
| Phase 2 (flag) | - | - | - | update | update | update | - | - | update |
| Phase 1 (config) | - | - | - | update | update | update | - | - | update |
| Phase 4 (jobType) | update | - | - | - | update | - | - | - | update |
| Phase 5 (enum) | - | - | - | - | update | - | update | - | - |
| Phase 6 (DB) | - | - | - | - | update | - | update | - | - |
| Phase 7 (SDK) | - | - | - | - | - | update | - | - | update |
| **Final sweep** | verify | verify | **rewrite** | verify | **rewrite** | verify | verify | **rewrite** | verify |

**Key**: `-` = no change needed, `update` = specific field/example updates, `verify` = check for missed references, **rewrite** = major content overhaul needed

### Already Clean Documents (No Action Needed)
- `CLAUDE.md` — Clean (already updated in step rename)
- `DIFFICULTIES-LOG.md` — Clean
- `docs/README.md` — Clean
- `MASTER-INDEX.md` — Clean
- `docs/guides/step-status-machine.md` — Clean
- `docs/guides/race-condition-prevention.md` — Clean
- `docs/guides/creating-a-workflow.md` — Clean
- `docs/guides/DEPLOYMENT-MODES.md` — Clean
- `docs/guides/DOCKER-ECOSYSTEM.md` — Clean
- `docs/guides/ENV-FILES-USAGE.md` — Clean
- `docs/guides/KAFKA-CONNECTIVITY-FIX.md` — Clean
- `docs/guides/DEMO-VIDEOS.md` — Clean
- `workflows/order-processing/README.md` — Clean
- `workflows/iot-sensor-pipeline/README.md` — Clean
- `workflows/infra-provisioning/README.md` — Clean

### Estimated Scope
~15 files, ~100 edits (3 files need major rewrites: TEST-OPTIONS-GUIDE, system-architecture, architecture-detailed.mermaid).

---

## File Impact Matrix

### Summary by Package

| Package / Service | Files Modified | Estimated Edits |
|---|---|---|
| `packages/core/` | 1 | 15 |
| `packages/database/` | 5 + 1 migration | 45 |
| `packages/worker-sdk/` | 2 | 15 |
| `services/orchestrator/src/` | 12 (including specs) | 150 |
| `workflows/order-processing/` | 1 | 20 |
| `workflows/iot-sensor-pipeline/` | 1 | 20 |
| `workflows/infra-provisioning/` | 1 | 20 |
| `workflows/00-template/` | 1 | 5 |
| `docs/` | 10 | 100 (3 major rewrites) |
| `.cursor/` (cursor rules) | 4 | 40 |
| **Total** | **~40 files** | **~430 edits** |

### Risk Assessment

| Phase | Risk | Mitigation |
|---|---|---|
| Phase 1 (config rename) | Low — mechanical rename | Search-and-replace, compile check |
| Phase 2 (collectDependencyOutputs) | Low — additive flag | Backward-compatible; old code works until flag is set |
| Phase 3 (cascade rename) | **Medium** — **fixes active bug** | Must add `inputStep` to all cascade configs |
| Phase 4 (migrationType rename) | **Medium** — SQS attribute name change | Workers parse body not attributes; SQS poller doesn't use attributes |
| Phase 5 (JobType enum) | **Medium** — enum value change | Requires DB migration; test data updates |
| Phase 6 (DB schema cleanup) | **Medium** — column removal | Requires DB migration; data must be preserved in payload JSONB |
| Phase 7 (worker SDK) | Low — type renames | Compile check ensures all usages updated |
| Phase 8 (docs) | None — documentation only | No runtime impact |

---

## Implementation Order

### Recommended Sequence

```
Phase 3 (cascade generalization)     ← FIRST — fixes active bug
  ↓
Phase 2 (collectDependencyOutputs)   ← Decouples behavioral heuristic
  ↓
Phase 1 (config metadata rename)     ← Now safe after heuristic is removed
  ↓
Phase 4 (migrationType rename)       ← Independent of Phases 1-3
  ↓
Phase 7 (worker SDK)                 ← Depends on Phases 1 + 4
  ↓
Phase 5 (JobType enum)               ← Can be done any time
  ↓
Phase 6 (DB schema cleanup)          ← Lowest priority, highest risk
  ↓
Phase 8 (docs)                       ← Last — after all code changes settle
```

### Why This Order

1. **Phase 3 first**: The hardcoded `Extract` prefix at `orchestration.service.ts:524` is a **live bug** — outcome evaluation doesn't detect first-phase step failures. This should be fixed immediately.

2. **Phase 2 before Phase 1**: The `collectDependencyOutputs` flag must be in place _before_ we rename `transformConfig` → `processingConfig`, otherwise the behavioral heuristic (`if (metadata?.transformConfig)`) would need to be temporarily changed to `if (metadata?.processingConfig)` — creating the same coupling with a new name.

3. **Phase 1 after Phase 2**: Once the flag replaces the heuristic, the config rename is purely cosmetic and safe.

4. **Phase 4 is independent**: `migrationType` → `jobType` can happen at any time but logically groups with Phase 7.

5. **Phase 6 last**: Removing database columns is the riskiest change and should happen after all other renames are verified.

---

## Verification Checklist

After each phase:

- [ ] `pnpm build` in orchestrator — compiles without errors
- [ ] `pnpm build` in each workflow workers package — compiles
- [ ] `pnpm build` in worker-sdk — compiles
- [ ] `pnpm build` in core package — compiles
- [ ] Grep for old naming — zero hits in modified packages
- [ ] Run order-processing happy-path STE — passes
- [ ] Run all 13 core STEs — pass
- [ ] Run Playwright demos — pass

After Phase 3 specifically:
- [ ] Verify outcome evaluation correctly detects first-phase failures (ValidateCustomer fails → job FAILED, not just "not attempted")

After Phase 6 specifically:
- [ ] Run database migration against test DB
- [ ] Verify existing jobs can be queried after column removal
- [ ] Verify new jobs create successfully without removed columns

---

## Appendix: Complete Rename Reference

### Interface/Type Renames
| Current Name | New Name | Package |
|---|---|---|
| `ExtractConfig` | `SourceConfig` | worker-sdk, step-delegation.dto |
| `TransformConfig` | `ProcessingConfig` | worker-sdk, step-delegation.dto |
| `ExtractWorkMessage` | `SourceWorkMessage` | worker-sdk |
| `TransformWorkMessage` | `ProcessingWorkMessage` | worker-sdk |
| `MigratedConsumerRecord` | (delete or move) | database |
| `MigratedMembershipRecord` | (delete or move) | database |
| `MigrationResultDetails` | (delete or move) | database |

### Field Renames
| Current Field | New Field | Location |
|---|---|---|
| `extractConfig` | `sourceConfig` | StepDelegationDto, LambdaStepPayload, workflow configs |
| `transformConfig` | `processingConfig` | StepDelegationDto, LambdaStepPayload, workflow configs |
| `migrationType` | `jobType` | StepDelegationDto, LambdaStepPayload, BaseWorkMessage, SQS attributes |
| `transformStep` | `outputStep` | EntityCascadeConfig, all cascade usages |
| `transformedDataKey` | `outputDataKey` | EntityCascadeConfig, cascade-publish.service, callback.service |

### New Fields
| Field | Type | Location | Purpose |
|---|---|---|---|
| `collectDependencyOutputs` | `boolean` | StepDefinition | Explicit flag for dependency data collection |
| `inputStep` | `string` | EntityCascadeConfig | First-phase step for this entity (replaces hardcoded `Extract` prefix) |
