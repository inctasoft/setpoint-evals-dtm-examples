/**
 * <YOUR WORKFLOW NAME> — Workflow Definition
 *
 * Replace this file with your actual workflow configuration.
 * See the reference implementation at: workflows/order-processing/workflow.config.ts
 *
 * The DTM orchestrator reads this definition to know:
 *   - What steps exist and their dependency DAG (steps)
 *   - How entities cascade with FK dependencies (cascades)
 *   - What determines job success/failure (outcomeRules, cascadeCriticalityRules)
 *   - What Kafka topics to publish to and listen on (cascades)
 */

import type {
  WorkflowDefinition,
  StepDefinition,
  CascadeConfig,
  OutcomeRule,
  CascadeCriticalityRule,
  JobContext,
} from '@dtm/core';

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW-SPECIFIC ENUMS
// The DTM core only sees strings — these enums are for type-safety within
// your workflow project.
// ═══════════════════════════════════════════════════════════════════════════════

export enum Step {
  FetchWidget = 'FetchWidget',
  ProcessWidget = 'ProcessWidget',
}

export type EntityType = 'widget';

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS — Define your step DAG per workflow variant
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_STEPS: StepDefinition[] = [
  {
    step: Step.FetchWidget,
    description: 'Fetch widget data from source system',
    functionName: 'my-workflow-fetch-widget',
    queueName: 'my-workflow-fetch-widget',
    dependencies: [],
    metadata: {
      sourceConfig: {
        sourceDatabase: 'source-db',
        sourceTable: 'widgets',
        filterKey: 'widgetId',
      },
    },
  },
  {
    step: Step.ProcessWidget,
    description: 'Process widget data and publish to target',
    functionName: 'my-workflow-process-widget',
    queueName: 'my-workflow-process-widget',
    dependencies: [Step.FetchWidget],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {},
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADES — FK dependency and Kafka topic configuration
// ═══════════════════════════════════════════════════════════════════════════════

const cascades: CascadeConfig[] = [
  {
    cascadeName: 'widget',
    dependsOn: [],
    inputStep: Step.FetchWidget,
    outputStep: Step.ProcessWidget,
    kafkaTopic: 'my-workflow.widget.completed',
    ackTopic: 'my-workflow.widget.ack',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OUTCOME RULES — Evaluated in priority order, first match wins
// ═══════════════════════════════════════════════════════════════════════════════

const outcomeRules: OutcomeRule[] = [
  {
    id: 'all-success',
    description: 'All cascades processed successfully',
    priority: 100,
    condition: (ctx: JobContext) =>
      Object.values(ctx.failedCascadeCounts).every((c) => c === 0),
    outcome: (ctx: JobContext) => ({
      jobStatus: 'completed' as const,
      reason: 'All cascades processed successfully',
      warnings: [],
      errors: [],
      metadata: { cascadeCounts: ctx.cascadeCounts },
    }),
  },
  {
    id: 'any-failure',
    description: 'At least one cascade failed',
    priority: 200,
    condition: () => true,
    outcome: (ctx: JobContext) => ({
      jobStatus: 'failed' as const,
      reason: 'One or more cascades failed processing',
      warnings: [],
      errors: Object.entries(ctx.failedCascadeCounts)
        .filter(([, c]) => c > 0)
        .map(([e, c]) => `${e}: ${c} failed`),
      metadata: { failedCascadeCounts: ctx.failedCascadeCounts },
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CRITICALITY RULES
// ═══════════════════════════════════════════════════════════════════════════════

const cascadeCriticalityRules: CascadeCriticalityRule[] = [
  {
    cascadeName: 'widget',
    criticality: 'required',
    allowEmpty: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION (export)
// ═══════════════════════════════════════════════════════════════════════════════

export const workflowDefinition: WorkflowDefinition = {
  name: 'my-workflow',
  description: 'Replace with your workflow description',

  variants: {
    default: { description: 'Default mode', isDefault: true },
  },

  steps: {
    default: DEFAULT_STEPS,
  },

  cascades,
  outcomeRules,
  cascadeCriticalityRules,

  featureFlags: {
    defaults: {
      enableDeduplication: true,
    },
    clientOverridable: ['enableDeduplication'],
  },
};

export default workflowDefinition;
