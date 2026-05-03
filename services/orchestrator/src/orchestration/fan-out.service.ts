import { Injectable, Logger } from '@nestjs/common';
import {
  JobRepository,
  StepRepository,
  StepStatus,
  Step as DbStep,
  Job,
  JobType,
} from '@dtm/database';
import { DelegationService } from '../delegation/delegation.service';
import { StepDelegationDto } from '../delegation/dto/step-delegation.dto';
import { WorkflowConfigService, WorkflowRegistryService } from '../workflow-loader';
import type { StepDefinition } from '@dtm/core';

/**
 * Fan-Out Service
 *
 * Handles the Discovery + Fan-Out + Aggregation pattern for one-to-many relationships.
 *
 * Flow:
 * 1. Discovery step completes → returns array of item IDs
 * 2. FanOutService creates child steps for each item ID
 * 3. Child steps are delegated and processed individually
 * 4. When all children complete, parent is marked complete
 *
 * Example: DiscoverLineItems returns [101, 102, 103]
 *   → Creates: ValidateLineItem(101), ValidateLineItem(102), ValidateLineItem(103)
 *   → Each flows through: ValidateLineItem → SubmitLineItem → Publish
 *   → When all SubmitLineItem steps complete → DiscoverLineItems marked complete
 */
@Injectable()
export class FanOutService {
  private readonly logger = new Logger(FanOutService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly stepRepository: StepRepository,
    private readonly delegationService: DelegationService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  /**
   * Resolve the correct WorkflowConfigService for a job.
   * Uses the workflow registry to find the config matching the job's workflowName,
   * falling back to the default injected WorkflowConfigService.
   */
  private resolveWorkflowConfig(job: Job): WorkflowConfigService {
    if (job.workflowName && this.workflowRegistry.has(job.workflowName)) {
      return this.workflowRegistry.get(job.workflowName);
    }
    return this.workflowConfig;
  }

  /**
   * Handle discovery step completion - create and delegate child steps
   *
   * Called when a step with fanOut.enabled completes and returns item IDs.
   *
   * @param job The workflow job
   * @param discoveryStep The discovery step that completed
   * @param itemIds Array of item IDs discovered
   * @param stepConfig The step definition with fanOut configuration
   */
  async handleDiscoveryComplete(
    job: Job,
    discoveryStep: DbStep,
    itemIds: string[],
    stepConfig: StepDefinition,
  ): Promise<{ success: boolean; childrenCreated: number; message: string }> {
    this.logger.log(
      `Fan-out: Discovery step ${discoveryStep.stepValue} completed for job ${job.id}. Found ${itemIds.length} items.`,
    );

    if (!stepConfig.fanOut) {
      return {
        success: false,
        childrenCreated: 0,
        message: 'Step does not have fan-out configuration',
      };
    }

    // Handle empty discovery - no children to create
    if (itemIds.length === 0) {
      this.logger.log(`Fan-out: No items discovered. Marking discovery step as complete.`);

      // Update discovery step with child count = 0
      await this.stepRepository.updateFromCallback(discoveryStep.id, {
        status: StepStatus.COMPLETED,
        output: {
          ...discoveryStep.output,
          childCount: 0,
          fanOutCompleted: true,
          message: 'No items found to process',
        },
      });

      return {
        success: true,
        childrenCreated: 0,
        message: 'No items discovered - step complete',
      };
    }

    try {
      // 1. Update discovery step with child count
      await this.stepRepository.updateFromCallback(discoveryStep.id, {
        status: StepStatus.WAITING_FOR_CHILDREN,
        output: {
          ...discoveryStep.output,
          childCount: itemIds.length,
        },
      });

      // 2. Create child steps for the first step in the chain
      const childSteps = await this.createChildSteps(
        job,
        discoveryStep,
        itemIds,
        stepConfig.fanOut.childStepType,
      );

      this.logger.log(
        `Fan-out: Created ${childSteps.length} child steps of type ${stepConfig.fanOut.childStepType}`,
      );

      // 3. Delegate all child steps (they can run in parallel)
      const delegationResult = await this.delegateChildSteps(job, discoveryStep, childSteps);

      return {
        success: true,
        childrenCreated: childSteps.length,
        message: `Created and delegated ${delegationResult.delegated} of ${childSteps.length} child steps`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Fan-out error for job ${job.id}: ${errorMessage}`);

      // Mark discovery step as failed
      await this.stepRepository.updateFromCallback(discoveryStep.id, {
        status: StepStatus.FAILED,
        error: `Fan-out failed: ${errorMessage}`,
      });

      return {
        success: false,
        childrenCreated: 0,
        message: `Fan-out failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Create child steps for a discovery result
   *
   * Creates one child step per item ID. Each child step gets:
   * - Reference to parent step
   * - Child index (0-based)
   * - Item ID being processed
   * - Input data including item ID and parent context
   */
  async createChildSteps(
    job: Job,
    parentStep: DbStep,
    itemIds: string[],
    childStepType: string,
  ): Promise<DbStep[]> {
    const childStepDef = this.resolveWorkflowConfig(job).getChildStepDefinition(
      job.type,
      childStepType,
    );
    if (!childStepDef) {
      throw new Error(`Child step definition not found for ${childStepType}`);
    }

    // Get data from parent step output to pass to children
    const parentOutput = parentStep.output || {};

    const childStepsData = itemIds.map((itemId, index) => ({
      jobId: job.id,
      stepValue: childStepType,
      description: `${childStepDef.description} (ID: ${itemId})`,
      lambdaFunctionName: childStepDef.functionName,
      // Parent-child relationship fields
      parentStepId: parentStep.id,
      childIndex: index,
      childItemId: itemId,
      // Input includes item ID and context from parent
      input: {
        ...(job.payload as Record<string, unknown>),
        // Add item ID field based on step configuration
        [childStepDef.itemIdInputField || 'itemId']: itemId,
        // Pass through any acknowledged primary key data from parent output
        ...Object.fromEntries(
          Object.entries(parentOutput).filter(([key]) => key.startsWith('npd')),
        ),
        // Include parent context
        _fanOut: {
          parentStepId: parentStep.id,
          childIndex: index,
          totalChildren: itemIds.length,
        },
      },
    }));

    // Create all child steps in database
    const createdSteps = await this.stepRepository.createSteps(childStepsData);

    // Update parent step with child count
    await this.stepRepository.update(parentStep.id, {
      childCount: itemIds.length,
    });

    return createdSteps;
  }

  /**
   * Delegate child steps to their SQS queues
   *
   * All child steps are delegated in parallel since they're independent.
   */
  async delegateChildSteps(
    job: Job,
    parentStep: DbStep,
    childSteps: DbStep[],
  ): Promise<{ delegated: number; failed: number }> {
    if (childSteps.length === 0) {
      return { delegated: 0, failed: 0 };
    }

    const delegationDtos: StepDelegationDto[] = childSteps.map((step) => {
      const stepDef = this.resolveWorkflowConfig(job).getChildStepDefinition(
        job.type,
        step.stepValue,
      );
      if (!stepDef) {
        throw new Error(`Child step definition not found for ${step.stepValue}`);
      }

      return {
        jobId: job.id,
        stepId: step.id,
        stepValue: step.stepValue,
        queueName: stepDef.queueName,
        jobType: job.type as JobType,
        input: step.input || {},
        sourceConfig: stepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
        processingConfig: stepDef.metadata
          ?.processingConfig as StepDelegationDto['processingConfig'],
      };
    });

    this.logger.log(
      `Fan-out: Delegating ${delegationDtos.length} child steps for parent ${parentStep.stepValue}`,
    );

    const result = await this.delegationService.delegateSteps(delegationDtos);

    return {
      delegated: result.successfulDelegations,
      failed: result.totalSteps - result.successfulDelegations,
    };
  }

  /**
   * Check completion status of all children for a parent step
   *
   * @returns Status summary including counts of completed, failed, and in-progress children
   */
  async checkChildrenCompletion(parentStepId: string): Promise<{
    allComplete: boolean;
    allChildrenDone: boolean;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    total: number;
  }> {
    const children = await this.stepRepository.findByParentId(parentStepId);

    // WAITING_FOR_ACK is treated as "done" for fan-out completion purposes:
    // the step's Lambda completed successfully and results were published.
    // The ACK is an external confirmation that doesn't block parent completion.
    const completed = children.filter(
      (c) => c.status === StepStatus.COMPLETED || c.status === StepStatus.WAITING_FOR_ACK,
    ).length;
    const failed = children.filter((c) => c.status === StepStatus.FAILED).length;
    const inProgress = children.filter(
      (c) =>
        c.status === StepStatus.IN_PROGRESS ||
        c.status === StepStatus.DELEGATED ||
        c.status === StepStatus.IN_PROGRESS_RETRYING ||
        c.status === StepStatus.WAITING_FOR_CHILDREN,
    ).length;
    const pending = children.filter((c) => c.status === StepStatus.PENDING).length;

    // All children are "done" when none are pending or in progress
    const allChildrenDone = pending === 0 && inProgress === 0;

    // All complete (success) when all finished and none failed
    const allComplete = allChildrenDone && failed === 0;

    return {
      allComplete,
      allChildrenDone,
      completed,
      failed,
      inProgress,
      pending,
      total: children.length,
    };
  }

  /**
   * Handle child step completion
   *
   * Called when a child step completes (or fails). Checks if all siblings are done
   * and if so, marks the parent step accordingly.
   *
   * For child steps that are part of a chain (e.g., ValidateLineItem → SubmitLineItem),
   * this also creates and delegates the next step in the chain.
   *
   * @param childStep The child step that just completed
   */
  async handleChildStepComplete(
    childStep: DbStep,
    jobId?: string,
  ): Promise<{ parentComplete: boolean; nextStepDelegated: boolean }> {
    if (!childStep.parentStepId) {
      this.logger.warn(`handleChildStepComplete called for step without parent: ${childStep.id}`);
      return { parentComplete: false, nextStepDelegated: false };
    }

    // Get the job to access type and payload
    // Use provided jobId if available (e.g., from ACK handler where job relation may not be loaded)
    const resolvedJobId = jobId || childStep.job?.id;
    if (!resolvedJobId) {
      this.logger.error(`No job ID available for child step ${childStep.id}`);
      return { parentComplete: false, nextStepDelegated: false };
    }

    const job = await this.jobRepository.findById(resolvedJobId);
    if (!job) {
      this.logger.error(`Job not found for child step ${childStep.id} (jobId: ${resolvedJobId})`);
      return { parentComplete: false, nextStepDelegated: false };
    }

    // Check if this child step has a next step in its chain
    const nextStepDelegated = await this.delegateNextChildChainStep(job, childStep);

    // Check if all siblings at the SAME step type are complete
    // (We need to track completion at each level of the chain)
    const parentStep = await this.stepRepository.findById(childStep.parentStepId);
    if (!parentStep) {
      this.logger.error(`Parent step ${childStep.parentStepId} not found`);
      return { parentComplete: false, nextStepDelegated };
    }

    // Get all children of the same type as this child
    const siblings = await this.stepRepository.findByParentId(childStep.parentStepId);
    const sameTypeSiblings = siblings.filter((s) => s.stepValue === childStep.stepValue);

    const allSameTypeComplete = sameTypeSiblings.every(
      (s) =>
        s.status === StepStatus.COMPLETED ||
        s.status === StepStatus.FAILED ||
        s.status === StepStatus.WAITING_FOR_ACK,
    );

    if (!allSameTypeComplete) {
      this.logger.debug(
        `Child step ${childStep.id} complete, but siblings of type ${childStep.stepValue} still processing`,
      );
      return { parentComplete: false, nextStepDelegated };
    }

    // Check if this is the LAST step in the child chain
    const wfConfig = this.resolveWorkflowConfig(job);
    const stepDef = wfConfig.getStepDefinition(job.type, parentStep.stepValue);
    if (!stepDef?.fanOut) {
      return { parentComplete: false, nextStepDelegated };
    }

    const childChain = wfConfig.getChildStepChain(stepDef);
    const isLastStepInChain = childChain[childChain.length - 1] === childStep.stepValue;

    if (isLastStepInChain) {
      // Guard: skip if parent is already in a terminal state (prevents double-completion
      // when WAITING_FOR_ACK children trigger this check multiple times)
      if (
        parentStep.status === StepStatus.COMPLETED ||
        parentStep.status === StepStatus.FAILED ||
        parentStep.status === StepStatus.PARTIAL_SUCCESS
      ) {
        this.logger.debug(
          `Parent ${parentStep.stepValue} already in terminal state ${parentStep.status} - skipping completion check`,
        );
        return { parentComplete: true, nextStepDelegated };
      }

      // This is the final step in the chain - check overall completion
      const completion = await this.checkChildrenCompletion(childStep.parentStepId);

      if (completion.allChildrenDone) {
        this.logger.log(
          `Fan-out complete for parent ${parentStep.stepValue}: ${completion.completed} succeeded, ${completion.failed} failed`,
        );

        // Determine parent step status:
        // - COMPLETED: All children succeeded
        // - PARTIAL_SUCCESS: Some succeeded, some failed (at least 1 success)
        // - FAILED: All children failed (no successes)
        let newStatus: StepStatus;
        if (completion.allComplete) {
          newStatus = StepStatus.COMPLETED;
        } else if (completion.completed > 0) {
          // At least one child succeeded - this is PARTIAL_SUCCESS
          // Dependent steps can proceed with available data
          newStatus = StepStatus.PARTIAL_SUCCESS;
          this.logger.log(
            `📊 Parent ${parentStep.stepValue} → PARTIAL_SUCCESS: ${completion.completed} succeeded, ${completion.failed} failed. ` +
              `Dependent steps will proceed with available FK data.`,
          );
        } else {
          // All children failed - truly failed
          newStatus = StepStatus.FAILED;
        }

        // Build FK map from successful children for dependent steps
        // This maps childItemId → fkValue for FK injection
        const fkMap = await this.buildFkMapFromSuccessfulChildren(childStep.parentStepId, wfConfig);

        // Discovery steps are in WAITING_FOR_CHILDREN (not terminal), so
        // updateFromCallback() will accept this transition cleanly.
        await this.stepRepository.updateFromCallback(parentStep.id, {
          status: newStatus,
          output: {
            ...parentStep.output,
            fanOutCompleted: true,
            childrenCompleted: completion.completed,
            childrenFailed: completion.failed,
            completedAt: new Date().toISOString(),
            successfulEntityFkMap: fkMap,
          },
          error:
            completion.failed > 0
              ? `${completion.failed} of ${completion.total} children failed`
              : undefined,
        });

        // NESTED FAN-OUT BUBBLING: If the parent step is itself a child step (nested fan-out),
        // bubble up the completion check to the grandparent. For example, when DiscoverReadings
        // (child of DiscoverSensors) completes all its reading children, we need to check if
        // DiscoverSensors' children (including all DiscoverReadings instances) are all done.
        if (parentStep.parentStepId) {
          this.logger.log(
            `🔀 Parent ${parentStep.stepValue} is itself a child step (nested fan-out) - bubbling up completion check`,
          );
          const refreshedParent = await this.stepRepository.findById(parentStep.id, ['job']);
          if (refreshedParent) {
            const resolvedJobId = jobId || refreshedParent.job?.id;
            const grandparentResult = await this.handleChildStepComplete(
              refreshedParent,
              resolvedJobId,
            );
            if (grandparentResult.parentComplete) {
              this.logger.log(
                `🔀 Grandparent completion triggered after ${parentStep.stepValue} completed`,
              );
            }
          }
        }

        return { parentComplete: true, nextStepDelegated };
      }
    }

    return { parentComplete: false, nextStepDelegated };
  }

  /**
   * Delegate the next step in a child's chain
   *
   * For example, when ValidateLineItem completes, this creates and delegates SubmitLineItem
   * for the same item.
   */
  private async delegateNextChildChainStep(job: Job, completedChildStep: DbStep): Promise<boolean> {
    if (!completedChildStep.parentStepId) {
      return false;
    }

    // Get parent step to find the chain configuration
    const parentStep = await this.stepRepository.findById(completedChildStep.parentStepId);
    if (!parentStep) {
      return false;
    }

    const wfConfig = this.resolveWorkflowConfig(job);
    const parentStepDef = wfConfig.getStepDefinition(job.type, parentStep.stepValue);
    if (!parentStepDef?.fanOut) {
      return false;
    }

    const childChain = wfConfig.getChildStepChain(parentStepDef);
    const currentStepIndex = childChain.findIndex((s) => s === completedChildStep.stepValue);

    // If this is the last step in chain, nothing more to delegate
    if (currentStepIndex === -1 || currentStepIndex >= childChain.length - 1) {
      return false;
    }

    // Get the next step type in the chain
    const nextStepType = childChain[currentStepIndex + 1];
    const nextStepDef = wfConfig.getChildStepDefinition(job.type, nextStepType);

    if (!nextStepDef) {
      this.logger.error(`Next child step definition not found for ${nextStepType}`);
      return false;
    }

    // Create the next step in the chain
    const nextStepData = {
      jobId: job.id,
      stepValue: nextStepType,
      description: `${nextStepDef.description} (ID: ${completedChildStep.childItemId})`,
      lambdaFunctionName: nextStepDef.functionName,
      parentStepId: completedChildStep.parentStepId, // Same parent
      childIndex: completedChildStep.childIndex,
      childItemId: completedChildStep.childItemId,
      input: {
        ...(completedChildStep.input || {}),
        // Include output from completed step as dependency data
        dependencyData: {
          [completedChildStep.stepValue]: completedChildStep.output,
        },
      },
    };

    const [nextStep] = await this.stepRepository.createSteps([nextStepData]);

    this.logger.log(
      `Fan-out chain: Created ${nextStepType} for item ${completedChildStep.childItemId}`,
    );

    // Delegate the next step
    const delegationDto: StepDelegationDto = {
      jobId: job.id,
      stepId: nextStep.id,
      stepValue: nextStep.stepValue,
      queueName: nextStepDef.queueName,
      jobType: job.type as JobType,
      input: nextStep.input || {},
      sourceConfig: nextStepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
      processingConfig: nextStepDef.metadata
        ?.processingConfig as StepDelegationDto['processingConfig'],
    };

    const result = await this.delegationService.delegateStep(delegationDto);

    if (result.success) {
      this.logger.log(
        `Fan-out chain: Delegated ${nextStepType} for item ${completedChildStep.childItemId}`,
      );
    } else {
      this.logger.error(`Fan-out chain: Failed to delegate ${nextStepType}: ${result.error}`);
    }

    return result.success;
  }

  /**
   * Get fan-out status for a parent step
   *
   * Returns detailed status of all child steps including progress summary.
   */
  async getFanOutStatus(parentStepId: string): Promise<{
    parentStepId: string;
    childCount: number;
    status: {
      completed: number;
      failed: number;
      inProgress: number;
      pending: number;
    };
    children: Array<{
      stepId: string;
      childItemId: string;
      stepType: string;
      status: StepStatus;
      error?: string;
    }>;
  }> {
    const children = await this.stepRepository.findByParentId(parentStepId);

    const completion = await this.checkChildrenCompletion(parentStepId);

    return {
      parentStepId,
      childCount: children.length,
      status: {
        completed: completion.completed,
        failed: completion.failed,
        inProgress: completion.inProgress,
        pending: completion.pending,
      },
      children: children.map((child) => ({
        stepId: child.id,
        childItemId: child.childItemId || 'unknown',
        stepType: child.stepValue,
        status: child.status,
        error: child.error || undefined,
      })),
    };
  }

  /**
   * Build FK map from successful child steps.
   *
   * Uses each cascade's childFkExtractor to extract the FK reference value from
   * completed children's ackMetadata. This map is used by dependent entities to
   * look up the correct FK value based on their relationship to the parent cascade.
   *
   * @param parentStepId The discovery/parent step ID
   * @param wfConfig Optional workflow config to use (defaults to injected config)
   * @returns Map of childItemId → fkValue for successful children
   *
   * @example
   * // For a Compute fan-out with 3 children (2 succeeded, 1 failed):
   * // Returns: {
   * //   "compute-uuid-001": "ext-compute-001",  // succeeded
   * //   "compute-uuid-003": "ext-compute-003",  // succeeded
   * //   // compute-uuid-002 not included (failed)
   * // }
   */
  private async buildFkMapFromSuccessfulChildren(
    parentStepId: string,
    wfConfig?: WorkflowConfigService,
  ): Promise<Record<string, string>> {
    const cfg = wfConfig || this.workflowConfig;
    const children = await this.stepRepository.findByParentId(parentStepId);
    const fkMap: Record<string, string> = {};

    for (const child of children) {
      // Only include children that completed successfully with an ACK
      if (child.status === StepStatus.COMPLETED && child.ackMetadata && child.childItemId) {
        const ackMeta = child.ackMetadata as Record<string, unknown>;
        const childCascade = cfg.getCascadeByOutputStep(child.stepValue);
        const fkValue = childCascade?.childFkExtractor?.(ackMeta);
        if (typeof fkValue === 'string') {
          fkMap[child.childItemId] = fkValue;
          this.logger.debug(`FK map: ${child.childItemId} → ${fkValue} (from ${child.stepValue})`);
        }
      }
    }

    this.logger.log(
      `Built FK map for parent ${parentStepId}: ${Object.keys(fkMap).length} successful mappings`,
    );

    return fkMap;
  }
}
