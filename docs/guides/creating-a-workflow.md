# Creating a New DTM Workflow

This guide walks you through creating a new workflow project for the DTM engine.

## Prerequisites

- DTM core infrastructure running (`./scripts/local-env.sh start`)
- Familiarity with the DTM architecture (see `docs/guides/system-architecture.md`)
- Node.js 18+ and pnpm installed

## Step 1: Copy the Template

```bash
cp -r workflows/00-template workflows/my-workflow
cd workflows/my-workflow
```

Update `package.json`:
```json
{
  "name": "@dtm-workflows/my-workflow",
  "description": "My workflow description"
}
```

## Step 2: Define Your Step DAG

Edit `workflow.config.ts`. This is the single source of truth that the DTM orchestrator reads.

### 2.1 Define Steps

Each step needs:
- **step**: Unique identifier (string)
- **functionName**: Lambda function name for SQS dispatch
- **queueName**: SQS queue name
- **dependencies**: Array of step names that must complete first

```typescript
export enum Step {
  ExtractUser = 'ExtractUser',
  TransformUser = 'TransformUser',
  ExtractProfile = 'ExtractProfile',
  TransformProfile = 'TransformProfile',
}

const steps: StepDefinition[] = [
  {
    step: Step.ExtractUser,
    description: 'Extract user from source DB',
    functionName: 'my-workflow-extract-user',
    queueName: 'my-workflow-extract-user',
    dependencies: [],
  },
  {
    step: Step.TransformUser,
    description: 'Transform user to target format',
    functionName: 'my-workflow-transform-user',
    queueName: 'my-workflow-transform-user',
    dependencies: [Step.ExtractUser],
    requiresAcknowledgement: true,
  },
  {
    step: Step.ExtractProfile,
    description: 'Extract profile (depends on user extract)',
    functionName: 'my-workflow-extract-profile',
    queueName: 'my-workflow-extract-profile',
    dependencies: [Step.ExtractUser],
  },
  {
    step: Step.TransformProfile,
    description: 'Transform profile',
    functionName: 'my-workflow-transform-profile',
    queueName: 'my-workflow-transform-profile',
    dependencies: [Step.ExtractProfile],
    requiresAcknowledgement: true,
  },
];
```

Steps with no dependency overlap run in **parallel** automatically.

### 2.2 Define Cascades (FK Dependencies)

Cascades define how entities relate via foreign keys and what Kafka topics to use:

```typescript
const cascades: CascadeConfig[] = [
  {
    cascadeName: 'user',
    dependsOn: [],
    fkFields: {},
    transformStep: Step.TransformUser,
    kafkaTopic: 'my-workflow.user.completed',
    ackTopic: 'my-workflow.user.ack',
  },
  {
    cascadeName: 'profile',
    dependsOn: ['user'],
    fkFields: { ext_user_id: 'user' },
    transformStep: Step.TransformProfile,
    kafkaTopic: 'my-workflow.profile.completed',
    ackTopic: 'my-workflow.profile.ack',
  },
];
```

When `profile` depends on `user`, the orchestrator will:
1. Wait for `user`'s ACK before publishing `profile` data
2. Inject the FK value (`ext_user_id`) from the `user` ACK into the `profile` payload

### 2.3 Define Outcome Rules

Outcome rules determine the final job status. They are evaluated in priority order:

```typescript
const outcomeRules: OutcomeRule[] = [
  {
    id: 'all-success',
    description: 'All entities migrated',
    priority: 100,
    condition: (ctx) => Object.values(ctx.failedCounts).every((c) => c === 0),
    outcome: (ctx) => ({
      jobStatus: 'completed',
      reason: 'All entities processed',
      warnings: [], errors: [],
      metadata: { cascadeCounts: ctx.cascadeCounts },
    }),
  },
  {
    id: 'fallback-failure',
    description: 'Default: mark as failed',
    priority: 999,
    condition: () => true,
    outcome: (ctx) => ({
      jobStatus: 'failed',
      reason: 'Processing failed',
      warnings: [], errors: [],
      metadata: {},
    }),
  },
];
```

### 2.4 Define Feature Flags (Optional)

```typescript
featureFlags: {
  defaults: {
    enableDeduplication: true,
    enableParallelExtraction: false,
  },
  clientOverridable: ['enableDeduplication'],
},
```

Feature flags resolve in three layers:
1. Workflow defaults (from config)
2. Environment variable overrides (`FEATURE_FLAG_ENABLE_DEDUPLICATION=false`)
3. Per-request overrides (only if listed in `clientOverridable`)

## Step 3: Implement Workers

Workers are Lambda functions that process each step. They follow a strict contract:

1. Receive a `BaseWorkMessage` from SQS
2. Do their work (query source DB, transform data, etc.)
3. Send a callback to the orchestrator (success or failure)

```typescript
// workers/src/handlers/extract-user.ts
import {
  sendSuccessCallback,
  sendFailureCallback,
  sendInProgressCallback,
  BaseWorkMessage,
} from '@dtm/worker-sdk';

export async function handler(message: BaseWorkMessage): Promise<void> {
  const { stepId, callbackUrl, entityId, retryCount } = message;

  try {
    await sendInProgressCallback(callbackUrl, stepId, {
      message: `Extracting user ${entityId}`,
    });

    // Query your source database
    const userData = await mySourceDb.findUser(entityId);

    await sendSuccessCallback(callbackUrl, stepId, {
      data: userData,
      recordCount: 1,
    });
  } catch (error) {
    await sendFailureCallback(callbackUrl, stepId, {
      error: error.message,
      retryable: retryCount < 3,
    });
  }
}
```

**Critical rule**: Workers MUST always send a callback. If a worker crashes without calling back, the orchestrator's maintenance tasks will recover the stuck step.

## Step 4: Configure Infrastructure

### 4.1 SQS Queues

Each step needs an SQS queue. Add them to your workflow's LocalStack init or Docker setup. Queue names must match the `queueName` in your step definitions.

### 4.2 Kafka Topics

Each cascade entity needs two Kafka topics (completed + ack). These are defined in the `cascades` section of your workflow config.

### 4.3 Source Database (Optional)

If your workflow queries a source database, create:
- `source-db/entities/` — TypeORM entities
- `source-db/init-scripts/` — SQL for schema + seed data
- A Docker Compose file for the source DB container

## Step 5: Configure Dev ACK Simulator (Optional)

Create `dev-tools/ack-defaults.ts` with payload generators for each entity. This lets the dev-ack-simulator send realistic ACK payloads during local testing:

```typescript
export const ackDefaults = {
  user: () => ({
    externalId: uuidv4(),
    ext_processed_at: new Date().toISOString(),
    status: 'active',
  }),
  profile: () => ({
    externalId: uuidv4(),
    ext_processed_at: new Date().toISOString(),
    verified: true,
  }),
};
```

If omitted, the simulator falls back to generic defaults (UUID + timestamp).

## Step 6: Write SEs

Setpoint Evals (SEs) are bash-based integration tests. Each test verifies a specific scenario:

```bash
# setpoint-evals/01-happy-path/test.sh
source "${SCRIPT_DIR}/../shared/helpers.sh"

RESPONSE=$(initiate_job '{ "payload": { "userId": "USER-001" } }')
JOB_ID=$(echo "${RESPONSE}" | jq -r '.jobId')

poll_job "${JOB_ID}" 120

verify_job_status "${JOB_ID}" "COMPLETED"
verify_step_status "${JOB_ID}" "ExtractUser" "COMPLETED"
verify_step_status "${JOB_ID}" "TransformUser" "COMPLETED"

exit_with_summary
```

**Two-tier helper chain**: Your `setpoint-evals/shared/helpers.sh` sources the generic `setpoint-evals/shared/helpers.sh`, giving you access to `initiate_job()`, `poll_job()`, `verify_job_status()`, etc.

Run your workflow SEs:
```bash
./workflows/my-workflow/setpoint-evals/run-all.sh
```

The core engine SEs (`./setpoint-evals/run-all.sh`) also run against your workflow automatically when using `--all-workflows`.

## Step 7: Deploy and Test

```bash
# Build your workflow
cd workflows/my-workflow && pnpm build

# Deploy workers to LocalStack
./scripts/local-env.sh deploy-workers

# Run SEs
./workflows/my-workflow/setpoint-evals/run-all.sh

# Run all SEs (core + all workflows)
./setpoint-evals/run-all.sh --all-workflows
```

## Checklist

- [ ] `workflow.config.ts` — Steps, cascades, outcome rules defined
- [ ] Workers implemented for each step
- [ ] SQS queues created for each step
- [ ] Kafka topics created for each cascade
- [ ] `dev-tools/ack-defaults.ts` configured (optional)
- [ ] Source DB schema and seed data (if applicable)
- [ ] Happy path SE written and passing
- [ ] Edge case SEs written (failure, partial, retry scenarios)

## Reference

- **Template**: `workflows/00-template/`
- **Reference implementation**: `workflows/order-processing/` (simplest example workflow)
- **Core interfaces**: `packages/core/src/interfaces/workflow-definition.interface.ts`
- **Worker SDK**: `packages/lambda-worker-utils/` (imported as `@dtm/worker-sdk`)
- **SE helpers**: `setpoint-evals/shared/helpers.sh`
