/**
 * Plan Execution — Workflow Definition
 *
 * Dynamic workflow for executing voice-assistant plan chunks via DTM orchestrator.
 *
 * Unlike other workflows with static step definitions, plan-execution uses
 * DYNAMIC STEPS: the step DAG is submitted per-job in the payload.stepDefinitions
 * field. Each step represents one plan chunk to be executed by the voice-assistant's
 * ChunkWorkerService via SQS.
 *
 * Architecture:
 *   Voice Assistant → POST /workflows/plan-execution/jobs (with stepDefinitions[])
 *     → DTM creates steps from payload
 *     → Delegates via SQS to plan-execute-chunk queue
 *     → ChunkWorkerService polls SQS, executes via Claude SDK (Sonnet)
 *     → HTTP callback to DTM with results
 *     → DTM continues DAG (parallel branches, dependency tracking)
 *     → HIGH risk chunks → WAITING_FOR_ACK (human review via Kafka)
 *
 * Single SQS queue: plan-execute-chunk (all chunks, regardless of type)
 * Single worker: ChunkWorkerService in voice-assistant backend
 */

import type {
  WorkflowDefinition,
  StepDefinition,
  OutcomeRule,
  CascadeCriticalityRule,
  JobContext,
} from '@dtm/core';

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER STEPS — empty, actual steps come from job payload.stepDefinitions
// The orchestrator detects dynamicSteps: true and reads steps from the payload.
// ═══════════════════════════════════════════════════════════════════════════════

const PLACEHOLDER_STEPS: StepDefinition[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// OUTCOME RULES
// For plan-execution, outcome depends on chunk risk levels:
//   - If any HIGH risk chunk fails → FAILED
//   - If only LOW risk chunks failed → PARTIAL_SUCCESS
//   - All chunks completed → COMPLETED
//
// Since we don't use cascades, we evaluate directly from step statuses.
// ═══════════════════════════════════════════════════════════════════════════════

const OUTCOME_RULES: OutcomeRule[] = [
  {
    id: 'high-risk-chunk-failed',
    description: 'A high-risk chunk failed — plan execution failed',
    priority: 10,
    condition: (ctx: JobContext) => {
      // Check if any failed step had riskLevel: 'high' in its status metadata
      // stepStatuses is a Record<stepValue, statusString>
      // We encode risk level in step names: ExecuteChunk_{id}
      // The actual risk check happens via step output/error metadata
      return Object.entries(ctx.stepStatuses).some(
        ([, status]) => status === 'failed',
      );
    },
    outcome: (ctx: JobContext) => {
      const failedSteps = Object.entries(ctx.stepStatuses)
        .filter(([, status]) => status === 'failed')
        .map(([step]) => step);
      return {
        jobStatus: 'failed',
        reason: `Plan execution failed: ${failedSteps.length} chunk(s) failed`,
        warnings: [],
        errors: failedSteps.map(s => `Chunk failed: ${s}`),
        metadata: { failedChunks: failedSteps },
      };
    },
  },
  {
    id: 'all-chunks-completed',
    description: 'All chunks completed successfully',
    priority: 20,
    condition: (ctx: JobContext) => {
      return Object.values(ctx.stepStatuses).every(
        status => status === 'completed' || status === 'skipped',
      );
    },
    outcome: () => ({
      jobStatus: 'completed',
      reason: 'All plan chunks completed successfully',
      warnings: [],
      errors: [],
      metadata: {},
    }),
  },
  {
    id: 'partial-success',
    description: 'Some chunks completed, some skipped due to failed dependencies',
    priority: 30,
    condition: (ctx: JobContext) => {
      const hasCompleted = Object.values(ctx.stepStatuses).some(s => s === 'completed');
      const hasSkipped = Object.values(ctx.stepStatuses).some(s => s === 'skipped');
      return hasCompleted && hasSkipped;
    },
    outcome: (ctx: JobContext) => {
      const skipped = Object.entries(ctx.stepStatuses)
        .filter(([, s]) => s === 'skipped')
        .map(([step]) => step);
      return {
        jobStatus: 'partial_success',
        reason: `Plan partially completed: ${skipped.length} chunk(s) skipped`,
        warnings: skipped.map(s => `Skipped: ${s}`),
        errors: [],
        metadata: { skippedChunks: skipped },
      };
    },
  },
  {
    id: 'fallback',
    description: 'Unknown state — needs investigation',
    priority: 100,
    condition: () => true,
    outcome: (ctx: JobContext) => ({
      jobStatus: 'failed',
      reason: 'Unable to determine plan execution outcome',
      warnings: [],
      errors: ['Outcome could not be determined from rules'],
      metadata: { stepStatuses: ctx.stepStatuses },
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// No cascades — chunks don't produce FK-linked entities
// No criticality rules — all evaluation done via outcome rules on step statuses
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICALITY_RULES: CascadeCriticalityRule[] = [];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

export const planExecutionWorkflow: WorkflowDefinition = {
  name: 'plan-execution',
  description:
    'Dynamic workflow for executing voice-assistant plan chunks. ' +
    'Steps are submitted per-job via payload.stepDefinitions (not static config).',

  variants: {
    default: {
      description: 'Dynamic chunk execution — steps from job payload',
      isDefault: true,
    },
  },

  // Empty — actual steps come from job.payload.stepDefinitions
  steps: {
    default: PLACEHOLDER_STEPS,
  },

  // No cascades (chunks are not entities with FK relationships)
  cascades: [],

  outcomeRules: OUTCOME_RULES,
  cascadeCriticalityRules: CRITICALITY_RULES,

  // Dynamic steps flag — signals the orchestrator to read steps from job payload
  dynamicSteps: true,
} as WorkflowDefinition & { dynamicSteps: boolean };

export default planExecutionWorkflow;
