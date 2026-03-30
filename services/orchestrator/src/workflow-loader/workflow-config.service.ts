/**
 * WorkflowConfigService
 *
 * Injectable NestJS service that wraps the loaded WorkflowDefinition and provides
 * all helper methods for step lookup, cascade resolution, FK injection, and outcome
 * determination.
 *
 * This replaces direct imports from:
 * - workflow-steps.config.ts (step helpers)
 * - data-dependencies-cascade.config.ts (cascade/FK helpers)
 * - workflow-outcome-rules.config.ts (outcome helpers)
 *
 * All methods operate on the injected WorkflowDefinition — no hardcoded cascade
 * names, step names, or domain-specific logic.
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { WORKFLOW_DEFINITION } from './workflow-loader.constants';
import type {
  WorkflowDefinition,
  StepDefinition,
  CascadeConfig,
  OutcomeRule,
  CascadeCriticalityRule,
  JobContext,
  OutcomeResult,
} from '@dtm/core';

// ═══════════════════════════════════════════════════════════════════════════════
// Types used by cascade methods (generic — no domain-specific fields)
// ═══════════════════════════════════════════════════════════════════════════════

/** FK Map: source item ID → external system primary key */
export type FkMap = Record<string, string>;

/** Parent cascade status check result */
export interface ParentCascadeStatus {
  parentType: string;
  hasAck: boolean;
  isEmpty: boolean;
  satisfied: boolean;
}

@Injectable()
export class WorkflowConfigService {
  private readonly logger = new Logger(WorkflowConfigService.name);

  /** Lazily-built map from step values (across ALL variants) to cascade configs */
  private _stepToCascadeMap: Map<string, CascadeConfig> | null = null;

  constructor(@Inject(WORKFLOW_DEFINITION) private readonly workflow: WorkflowDefinition) {}

  /**
   * Build a mapping from ALL submission step values to their cascade config.
   * This handles batch/fan-out variants (e.g., SubmitLineItem vs SubmitOrder)
   * by matching steps that share the same queueName as a cascade's outputStep.
   */
  private getStepToCascadeMap(): Map<string, CascadeConfig> {
    if (this._stepToCascadeMap) return this._stepToCascadeMap;

    const map = new Map<string, CascadeConfig>();

    // 1. Direct mappings from cascade configs
    for (const cascade of this.workflow.cascades) {
      map.set(cascade.outputStep, cascade);
    }

    // 2. Build queueName -> cascade lookup from direct mappings
    const queueToCascade = new Map<string, CascadeConfig>();
    for (const variant of Object.keys(this.workflow.steps)) {
      for (const stepDef of this.workflow.steps[variant]) {
        const cascade = map.get(stepDef.step);
        if (cascade && stepDef.queueName) {
          queueToCascade.set(stepDef.queueName, cascade);
        }
      }
    }

    // 3. Add indirect mappings: steps sharing queueName with a cascade's outputStep
    //    This catches batch variants like SubmitLineItem -> lineItem cascade
    for (const variant of Object.keys(this.workflow.steps)) {
      for (const stepDef of this.workflow.steps[variant]) {
        if (!map.has(stepDef.step) && stepDef.requiresAcknowledgement && stepDef.queueName) {
          const cascade = queueToCascade.get(stepDef.queueName);
          if (cascade) {
            map.set(stepDef.step, cascade);
          }
        }
      }
    }

    this._stepToCascadeMap = map;
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workflow Access
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get the full workflow definition */
  getWorkflow(): WorkflowDefinition {
    return this.workflow;
  }

  /** Get the workflow name */
  getWorkflowName(): string {
    return this.workflow.name;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Step Methods (replace workflow-steps.config.ts helpers)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get step definitions for a workflow variant */
  getStepDefinitions(variant: string): StepDefinition[] {
    return this.workflow.steps[variant] || [];
  }

  /** Get active step definitions for a variant (alias for getStepDefinitions) */
  getActiveStepDefinitions(variant: string): StepDefinition[] {
    return this.getStepDefinitions(variant);
  }

  /**
   * Get upfront step definitions (non-child steps created at job start).
   * Child steps are created dynamically by fan-out discovery steps.
   */
  getUpfrontStepDefinitions(variant: string): StepDefinition[] {
    return this.getStepDefinitions(variant).filter((s) => !s.isChildStep);
  }

  /** Find a step definition by step name within a variant */
  getStepDefinition(variant: string, step: string): StepDefinition | undefined {
    return this.getStepDefinitions(variant).find((d) => d.step === step);
  }

  /** Find a child step definition by step name within a variant */
  getChildStepDefinition(variant: string, childStep: string): StepDefinition | undefined {
    return this.getStepDefinitions(variant).find((d) => d.step === childStep && d.isChildStep);
  }

  /** Get the execution order index of a step within a variant (0-based) */
  getStepOrder(step: string, variant: string): number {
    return this.getStepDefinitions(variant).findIndex((s) => s.step === step);
  }

  /** Get step name in lowercase (for display/API) */
  getStepName(step: string): string {
    return step.toLowerCase();
  }

  /** Get all unique SQS queue names across all workflow variants */
  getAllQueueNames(): string[] {
    const queueNames = new Set<string>();
    for (const variant of Object.keys(this.workflow.steps)) {
      for (const step of this.workflow.steps[variant]) {
        queueNames.add(step.queueName);
      }
    }
    return Array.from(queueNames);
  }

  /** Check if a step definition is a fan-out discovery step */
  isFanOutDiscoveryStep(stepDef: StepDefinition): boolean {
    return stepDef.fanOut?.enabled === true;
  }

  /** Check if a step definition is a child step (created by fan-out) */
  isChildStep(stepDef: StepDefinition): boolean {
    return stepDef.isChildStep === true;
  }

  /** Get the child step chain for a fan-out discovery step */
  getChildStepChain(stepDef: StepDefinition): string[] {
    return stepDef.fanOut?.childStepChain || [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cascade Methods (replace data-dependencies-cascade.config.ts helpers)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get all cascade configurations */
  getCascades(): CascadeConfig[] {
    return this.workflow.cascades;
  }

  /** Get cascade config by cascade name */
  getCascade(cascadeName: string): CascadeConfig | undefined {
    return this.workflow.cascades.find((c) => c.cascadeName === cascadeName);
  }

  /**
   * Get cascade config by output step value.
   * Handles batch/fan-out variants (e.g., SubmitLineItem maps to same cascade as SubmitOrder)
   * by falling back to a queueName-based reverse lookup.
   */
  getCascadeByStep(stepValue: string): CascadeConfig | undefined {
    // Try direct match first (most common path)
    const direct = this.workflow.cascades.find((c) => c.outputStep === stepValue);
    if (direct) return direct;

    // Fallback: check batch/fan-out variants via shared queueName
    return this.getStepToCascadeMap().get(stepValue);
  }

  /** Get cascade name from an output step value */
  getCascadeNameFromStep(stepValue: string): string | undefined {
    return this.getCascadeByStep(stepValue)?.cascadeName;
  }

  /** Check if a step is an output step that participates in the cascade */
  isOutputStep(stepValue: string): boolean {
    return !!this.getCascadeByStep(stepValue);
  }

  /** Get all cascade names that depend on a given parent cascade */
  getDependentCascades(parentCascadeName: string): string[] {
    return this.workflow.cascades
      .filter((c) => c.dependsOn.includes(parentCascadeName))
      .map((c) => c.cascadeName);
  }

  /** Check if cascade has dependent cascades that depend on it */
  hasDependentCascades(parentCascadeName: string): boolean {
    return this.workflow.cascades.some((c) => c.dependsOn.includes(parentCascadeName));
  }

  /** Find a cascade config by its outputStep value */
  getCascadeByOutputStep(outputStep: string): CascadeConfig | undefined {
    return this.workflow.cascades.find((c) => c.outputStep === outputStep);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACK Metadata Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Build ackMetadata map from a list of steps.
   * Maps outputStep → ackMetadata for all output steps that have ack data.
   */
  buildAckMetadataMap(
    steps: Array<{ stepValue: string; ackMetadata?: Record<string, unknown> | null }>,
  ): Map<string, Record<string, unknown> | undefined> {
    const map = new Map<string, Record<string, unknown> | undefined>();
    for (const step of steps) {
      if (this.isOutputStep(step.stepValue) && step.ackMetadata) {
        map.set(step.stepValue, step.ackMetadata as Record<string, unknown>);
      }
    }
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Parent Cascade Status Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if a parent cascade has no items (discovery completed with childCount: 0)
   */
  isParentCascadeEmpty(
    parentType: string,
    stepsWithOutput: Array<{
      stepValue: string;
      status: string;
      output?: Record<string, unknown> | null;
    }>,
  ): boolean {
    const parentCascade = this.getCascade(parentType);
    if (!parentCascade?.isFanOutParent || !parentCascade.discoveryStep) {
      return false;
    }

    const discoveryStep = stepsWithOutput.find((s) => s.stepValue === parentCascade.discoveryStep);
    if (!discoveryStep) return false;

    const completedStatuses = ['completed', 'partial_success'];
    if (!completedStatuses.includes(discoveryStep.status)) return false;

    return discoveryStep.output?.childCount === 0;
  }

  /** Check parent cascade status (ACK available, empty, or neither) */
  getParentCascadeStatus(
    parentType: string,
    ackMetadataByStep: Map<string, Record<string, unknown> | undefined>,
    stepsWithOutput: Array<{
      stepValue: string;
      status: string;
      output?: Record<string, unknown> | null;
    }>,
  ): ParentCascadeStatus {
    const parentCascade = this.getCascade(parentType);
    if (!parentCascade) {
      return { parentType, hasAck: false, isEmpty: false, satisfied: false };
    }

    const parentAck = ackMetadataByStep.get(parentCascade.outputStep);
    const hasAck = !!parentAck;
    const isEmpty = this.isParentCascadeEmpty(parentType, stepsWithOutput);

    return { parentType, hasAck, isEmpty, satisfied: hasAck || isEmpty };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Cascade Dependency Checks
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if all parent cascade data dependencies are satisfied.
   * A dependency is satisfied if the parent has an ACK OR the parent is empty
   * (discovery completed with 0 items).
   */
  areCascadeDependenciesMet(
    cascadeName: string,
    ackMetadataByStep: Map<string, Record<string, unknown> | undefined>,
    stepsWithOutput?: Array<{
      stepValue: string;
      status: string;
      output?: Record<string, unknown> | null;
    }>,
  ): boolean {
    const cascade = this.getCascade(cascadeName);
    if (!cascade?.dependsOn.length) return true;

    return cascade.dependsOn.every((parentType) => {
      const parentCascade = this.getCascade(parentType);
      if (!parentCascade) return false;

      // Check 1: Parent has ACK
      const parentAck = ackMetadataByStep.get(parentCascade.outputStep);
      if (parentAck) return true;

      // Check 2: Parent cascade is empty (discovery found 0 items)
      if (stepsWithOutput && this.isParentCascadeEmpty(parentType, stepsWithOutput)) {
        return true;
      }

      // Check 3: Parent output step completed without data to publish (no ACK needed).
      // When an output step has no output data, it completes directly without
      // going through WAITING_FOR_ACK. The dependency is satisfied because the parent
      // successfully completed — there's simply no data to publish or ACK.
      if (stepsWithOutput) {
        const parentOutputStep = stepsWithOutput.find(
          (s) => s.stepValue === parentCascade.outputStep,
        );
        if (parentOutputStep?.status === 'completed' && !parentAck) {
          return true;
        }
      }

      return false;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FK Injection
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get FK injections for a cascade by calling the workflow-owned fkExtractor.
   *
   * @param cascadeName - The child cascade needing FK values
   * @param ackMetadataByStep - Map of outputStep → ackMetadata for all steps
   * @param fkMaps - Map of discoveryStep → FK map (childItemId → value), for fan-out parents
   * @param sourceRecord - The individual record being published (for per-record lookups)
   */
  getFkInjections(
    cascadeName: string,
    ackMetadataByStep: Map<string, Record<string, unknown> | undefined>,
    fkMaps: Record<string, Record<string, string>> = {},
    sourceRecord?: Record<string, unknown>,
  ): Record<string, string> {
    const cascade = this.getCascade(cascadeName);
    if (!cascade?.fkExtractor) return {};

    const parentAcks = this.buildParentAcksMap(cascadeName, ackMetadataByStep);
    return cascade.fkExtractor(parentAcks, fkMaps, sourceRecord);
  }

  /**
   * Build a map of parentCascadeName → ackMetadata for all parents of a cascade.
   */
  buildParentAcksMap(
    cascadeName: string,
    ackMetadataByStep: Map<string, Record<string, unknown> | undefined>,
  ): Record<string, Record<string, unknown> | undefined> {
    const cascade = this.getCascade(cascadeName);
    if (!cascade) return {};

    const parentAcks: Record<string, Record<string, unknown> | undefined> = {};
    for (const parentType of cascade.dependsOn) {
      const parentCascade = this.getCascade(parentType);
      if (parentCascade) {
        parentAcks[parentType] = ackMetadataByStep.get(parentCascade.outputStep);
      }
    }
    return parentAcks;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Outcome Determination (replace workflow-outcome-rules.config.ts helpers)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Get outcome rules from the workflow definition */
  getOutcomeRules(): OutcomeRule[] {
    return this.workflow.outcomeRules;
  }

  /** Get cascade criticality rules from the workflow definition */
  getCascadeCriticalityRules(): CascadeCriticalityRule[] {
    return this.workflow.cascadeCriticalityRules;
  }

  /** Determine job outcome by evaluating rules in priority order */
  determineOutcome(ctx: JobContext): OutcomeResult {
    const sortedRules = [...this.workflow.outcomeRules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (rule.condition(ctx)) {
        return rule.outcome(ctx);
      }
    }

    throw new Error('No outcome rule matched — check rule configuration');
  }

  /** Check cascade criticality for a given context */
  checkCascadeCriticality(
    cascadeName: string,
    ctx: JobContext,
  ): { isRequired: boolean; allowsEmpty: boolean } {
    const rule = this.workflow.cascadeCriticalityRules.find((r) => r.cascadeName === cascadeName);

    if (!rule) {
      return { isRequired: false, allowsEmpty: true };
    }

    let isRequired = rule.criticality === 'required';
    if (rule.criticality === 'conditional' && rule.condition) {
      isRequired = rule.condition(ctx);
    }

    return { isRequired, allowsEmpty: rule.allowEmpty };
  }
}
