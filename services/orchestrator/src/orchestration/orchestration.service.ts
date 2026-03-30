import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import {
  JobRepository,
  StepRepository,
  JobStatus,
  StepStatus,
  JobType,
  Job,
  Step as DbStep, // Database entity
} from '@dtm/database';
import { DelegationService } from '../delegation/delegation.service';
import { KafkaService } from '../kafka/kafka.service';
import { CorrelationService } from '../common/correlation/correlation.service';
import { StepDelegationDto } from '../delegation/dto/step-delegation.dto';
import { WorkflowConfigService, WorkflowRegistryService } from '../workflow-loader';
import type { StepDefinition, JobContext, OutcomeResult } from '@dtm/core';
import { JobCompletedEvent, JobFailedEvent } from '../callback/dto/job-status-events.dto';
import { EventsGateway } from '../websocket/events.gateway';
import type { StepSnapshot } from '../websocket/dtm-event.types';

/**
 * Orchestration Service
 *
 * Acts as the state machine for job orchestration:
 * - Starts jobs by delegating the first step
 * - Continues jobs by checking state and delegating next steps
 * - Makes decisions based on step completions/failures
 *
 * This is the "brain" of the orchestrator that decides what to do next.
 */
@Injectable()
export class OrchestrationService {
  private readonly logger = new Logger(OrchestrationService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly stepRepository: StepRepository,
    private readonly delegationService: DelegationService,
    private readonly correlationService: CorrelationService,
    @Inject(forwardRef(() => KafkaService))
    private readonly kafkaService: KafkaService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * Resolve the correct WorkflowConfigService for a job.
   * Uses job.workflowName if available, falls back to default config.
   */
  private getWorkflowConfig(job: { workflowName?: string }): WorkflowConfigService {
    if (job.workflowName && this.workflowRegistry.has(job.workflowName)) {
      return this.workflowRegistry.get(job.workflowName);
    }
    return this.workflowConfig; // Backward compatibility: default workflow
  }

  /**
   * Start a new workflow job
   * - Creates all steps in the database
   * - Delegates ALL steps with no dependencies (parallel execution!)
   * - Updates job status to PROCESSING
   *
   * Performance optimization: Instead of delegating only the first step sequentially,
   * this now finds ALL steps with satisfied dependencies and delegates them in parallel.
   * For example, ValidateCustomer and ValidateOrder can now run simultaneously.
   *
   * Called by: Ingestion endpoint after creating the job
   */
  async startJob(jobId: string): Promise<{
    success: boolean;
    message: string;
    stepsCreated: number;
    firstStepDelegated?: boolean;
  }> {
    return this.correlationService.runWithCorrelationId(async () => {
      this.logger.log(`Starting orchestration for job ${jobId}`);

      try {
        // 1. Fetch the job
        const job = await this.jobRepository.findById(jobId);
        if (!job) {
          throw new Error(`Job ${jobId} not found`);
        }

        // 2. Get step definitions for this workflow type
        const wfConfig = this.getWorkflowConfig(job);
        const allStepDefinitions = wfConfig.getActiveStepDefinitions(job.type);

        // For upfront creation, filter out child steps (they're created dynamically by fan-out)
        const stepDefinitions = allStepDefinitions.filter((sd) => !sd.isChildStep);

        if (!stepDefinitions || stepDefinitions.length === 0) {
          throw new Error(`No step definitions found for workflow type ${job.type}`);
        }

        this.logger.log(`Creating ${stepDefinitions.length} upfront steps for job ${jobId}`);

        // 3. Create all upfront steps in the database (child steps are created by fan-out)
        const createdSteps = await this.stepRepository.createSteps(
          stepDefinitions.map((stepDef) => ({
            jobId: job.id,
            stepValue: stepDef.step,
            description: stepDef.description,
            lambdaFunctionName: stepDef.functionName,
            input: job.payload as unknown as Record<string, unknown>, // Pass job payload as step input
          })),
        );

        this.logger.log(`Created ${createdSteps.length} steps for job ${jobId}`);

        // 4. Update job status to PROCESSING
        await this.jobRepository.updateStatus(jobId, JobStatus.PROCESSING);

        // 4a. Broadcast job_created event to dashboard
        const stepSnapshots: StepSnapshot[] = createdSteps.map((s, i) => ({
          step: s.stepValue,
          description: s.description ?? '',
          status: 'pending' as const,
          stepNumber: i + 1,
        }));
        this.eventsGateway.broadcast({
          type: 'job_created',
          jobId,
          workflow: wfConfig.getWorkflowName?.() || job.workflowName || job.type,
          variant: job.type,
          steps: stepSnapshots,
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
        });

        // 5. Find ALL steps with no dependencies and delegate them in parallel
        // This is a huge performance improvement - independent root steps run concurrently.

        const readySteps = this.findReadySteps(
          createdSteps,
          [],
          job.type as JobType,
          job.payload as any,
          wfConfig,
        );

        if (readySteps.length === 0) {
          throw new Error(`No ready steps found for job ${jobId}`);
        }

        this.logger.log(
          `Found ${readySteps.length} step(s) ready for immediate delegation: ${readySteps.map((s) => s.stepValue).join(', ')}`,
        );

        if (readySteps.length === 1) {
          // Single step ready - delegate it
          const step = readySteps[0];
          const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);

          if (!stepDef) {
            throw new Error(`Step definition not found for step ${step.stepValue}`);
          }

          const delegationDto: StepDelegationDto = {
            jobId: job.id,
            stepId: step.id,
            stepValue: step.stepValue,
            queueName: stepDef.queueName,
            jobType: job.type as JobType,
            input: job.payload as unknown as Record<string, unknown>,
            sourceConfig: stepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
            processingConfig: stepDef.metadata
              ?.processingConfig as StepDelegationDto['processingConfig'],
          };

          const delegationResult = await this.delegationService.delegateStep(delegationDto);

          if (!delegationResult.success) {
            this.logger.error(
              `Failed to delegate step for job ${jobId}: ${delegationResult.error}`,
            );
            return {
              success: false,
              message: `Failed to delegate step: ${delegationResult.error}`,
              stepsCreated: createdSteps.length,
              firstStepDelegated: false,
            };
          }

          this.logger.log(`Successfully delegated step ${step.stepValue} for job ${jobId}`);

          return {
            success: true,
            message: `Job ${jobId} started successfully. 1 step delegated.`,
            stepsCreated: createdSteps.length,
            firstStepDelegated: true,
          };
        } else {
          // Multiple steps ready - delegate them ALL in parallel!
          const delegationDtos: StepDelegationDto[] = readySteps.map((step) => {
            const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);
            if (!stepDef) {
              throw new Error(`Step definition not found for step ${step.stepValue}`);
            }

            return {
              jobId: job.id,
              stepId: step.id,
              stepValue: step.stepValue,
              queueName: stepDef.queueName,
              jobType: job.type as JobType,
              input: job.payload as unknown as Record<string, unknown>,
              sourceConfig: stepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
              processingConfig: stepDef.metadata
                ?.processingConfig as StepDelegationDto['processingConfig'],
            };
          });

          this.logger.log(
            `Delegating ${readySteps.length} steps in parallel for job ${jobId}: ${readySteps.map((s) => s.stepValue).join(', ')}`,
          );

          const delegationResult = await this.delegationService.delegateSteps(delegationDtos);

          if (delegationResult.successfulDelegations === 0) {
            this.logger.error(`Failed to delegate any parallel steps for job ${jobId}`);
            return {
              success: false,
              message: `Failed to delegate parallel steps`,
              stepsCreated: createdSteps.length,
              firstStepDelegated: false,
            };
          }

          this.logger.log(
            `Successfully delegated ${delegationResult.successfulDelegations} of ${delegationResult.totalSteps} parallel steps for job ${jobId}`,
          );

          return {
            success: true,
            message: `Job ${jobId} started successfully. ${delegationResult.successfulDelegations} steps delegated in parallel.`,
            stepsCreated: createdSteps.length,
            firstStepDelegated: true,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Error starting job ${jobId}: ${errorMessage}`);

        // Mark job as failed
        await this.jobRepository.updateStatus(jobId, JobStatus.FAILED, errorMessage);

        return {
          success: false,
          message: `Failed to start job: ${errorMessage}`,
          stepsCreated: 0,
          firstStepDelegated: false,
        };
      }
    }, jobId);
  }

  /**
   * Complete a workflow job
   * - Calculates final statistics
   * - Updates job results in database
   * - Updates job status to COMPLETED
   * - Publishes completion events
   */
  async completeJob(jobId: string): Promise<void> {
    return this.correlationService.runWithCorrelationId(async () => {
      this.logger.log(`Completing job ${jobId}`);

      try {
        // 1. Fetch job and steps
        const job = await this.jobRepository.findById(jobId, false);
        if (!job) {
          throw new Error(`Job ${jobId} not found`);
        }
        const steps = await this.stepRepository.findByJobId(jobId);

        // 2. Calculate statistics
        const totalRecordsProcessed = this.countOutputRecords(steps, StepStatus.COMPLETED);
        const totalRecordsFailed = this.countOutputRecords(steps, StepStatus.FAILED);
        const stepsCompleted = steps.filter((s) => s.status === StepStatus.COMPLETED).length;
        const stepsFailed = steps.filter((s) => s.status === StepStatus.FAILED).length;
        const stepsAborted = steps.filter((s) => s.status === StepStatus.SKIPPED).length;
        const durationMs = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;

        // 3. Update results in database
        await this.jobRepository.updateResults(jobId, {
          totalRecordsProcessed,
          totalRecordsFailed,
          stepsCompleted,
          stepsFailed,
          stepsAborted,
          durationMs,
          completedAt: new Date(),
        });

        // 4. Publish completion event (BEFORE status update to avoid race conditions)
        const jobCompletedEvent: JobCompletedEvent = {
          jobId: job.id,
          type: job.type as JobType,
          status: JobStatus.COMPLETED,
          submittedBy: job.submittedBy || 'unknown',
          submittedAt: job.submittedAt,
          startedAt: job.startedAt,
          completedAt: new Date(),
          durationMs,
          summary: {
            totalRecordsProcessed,
            totalRecordsFailed,
          },
          eventTimestamp: new Date(),
        };

        await this.kafkaService.publish<JobCompletedEvent>(
          'dtm.jobs.completed',
          jobCompletedEvent,
          jobId,
        );

        // 5. Update status to COMPLETED
        await this.jobRepository.updateStatus(jobId, JobStatus.COMPLETED);
        this.logger.log(`Job ${jobId} marked as COMPLETED`);

        this.eventsGateway.broadcast({
          type: 'job_completed',
          jobId,
          status: 'completed',
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
          results: {
            totalRecordsProcessed,
            totalRecordsFailed,
            stepsCompleted,
            stepsFailed,
            stepsAborted,
            durationMs,
          },
        });
      } catch (error) {
        this.logger.error(`Error completing job ${jobId}: ${error}`);
        // Fallback: Ensure status is updated even if stats/events fail
        await this.jobRepository.updateStatus(jobId, JobStatus.COMPLETED);
      }
    }, jobId);
  }

  /**
   * Fail a workflow job
   * - Calculates final statistics
   * - Updates job results in database
   * - Updates job status to FAILED
   * - Publishes failure events
   */
  async failJob(jobId: string, errorMessage: string): Promise<void> {
    return this.correlationService.runWithCorrelationId(async () => {
      this.logger.log(`Failing job ${jobId}: ${errorMessage}`);

      try {
        const job = await this.jobRepository.findById(jobId, false);
        if (!job) {
          throw new Error(`Job ${jobId} not found`);
        }
        const steps = await this.stepRepository.findByJobId(jobId);

        // Calculate statistics
        const totalRecordsProcessed = this.countOutputRecords(steps, StepStatus.COMPLETED);
        const totalRecordsFailed = this.countOutputRecords(steps, StepStatus.FAILED);
        const stepsCompleted = steps.filter((s) => s.status === StepStatus.COMPLETED).length;
        const stepsFailed = steps.filter((s) => s.status === StepStatus.FAILED).length;
        const stepsAborted = steps.filter((s) => s.status === StepStatus.SKIPPED).length;
        const durationMs = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;

        // Update results
        await this.jobRepository.updateResults(jobId, {
          totalRecordsProcessed,
          totalRecordsFailed,
          stepsCompleted,
          stepsFailed,
          stepsAborted,
          durationMs,
          completedAt: new Date(),
        });

        // Publish failure event
        const jobFailedEvent: JobFailedEvent = {
          jobId: job.id,
          type: job.type as JobType,
          status: JobStatus.FAILED,
          submittedBy: job.submittedBy || 'unknown',
          submittedAt: job.submittedAt,
          startedAt: job.startedAt,
          failedAt: new Date(),
          durationMs,
          error: errorMessage,
          summary: {
            totalRecordsProcessed,
            totalRecordsFailed,
          },
          eventTimestamp: new Date(),
        };

        await this.kafkaService.publish<JobFailedEvent>(
          'dtm.jobs.failed',
          jobFailedEvent,
          jobId,
        );

        // Update status
        await this.jobRepository.updateStatus(jobId, JobStatus.FAILED, errorMessage);

        this.eventsGateway.broadcast({
          type: 'job_completed',
          jobId,
          status: 'failed',
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
          results: {
            totalRecordsProcessed,
            totalRecordsFailed,
            stepsCompleted,
            stepsFailed,
            stepsAborted,
            durationMs,
          },
        });
      } catch (error) {
        this.logger.error(`Error failing job ${jobId}: ${error}`);
        await this.jobRepository.updateStatus(jobId, JobStatus.FAILED, errorMessage);
      }
    }, jobId);
  }

  /**
   * Mark a job as PARTIAL_SUCCESS
   * Used when outcome rules determine that critical entities succeeded
   * but optional entities failed (graceful degradation).
   */
  async partialSuccessJob(jobId: string, reason: string): Promise<void> {
    return this.correlationService.runWithCorrelationId(async () => {
      this.logger.log(`Marking job ${jobId} as PARTIAL_SUCCESS: ${reason}`);

      try {
        const job = await this.jobRepository.findById(jobId, false);
        if (!job) {
          throw new Error(`Job ${jobId} not found`);
        }
        const steps = await this.stepRepository.findByJobId(jobId);

        // Calculate statistics
        const totalRecordsProcessed = this.countOutputRecords(steps, StepStatus.COMPLETED);
        const totalRecordsFailed = this.countOutputRecords(steps, StepStatus.FAILED);
        const stepsCompleted = steps.filter((s) => s.status === StepStatus.COMPLETED).length;
        const stepsFailed = steps.filter((s) => s.status === StepStatus.FAILED).length;
        const stepsAborted = steps.filter((s) => s.status === StepStatus.SKIPPED).length;
        const durationMs = job.startedAt ? Date.now() - job.startedAt.getTime() : 0;

        // Update results
        await this.jobRepository.updateResults(jobId, {
          totalRecordsProcessed,
          totalRecordsFailed,
          stepsCompleted,
          stepsFailed,
          stepsAborted,
          durationMs,
          completedAt: new Date(),
        });

        // Publish completion event (partial success is still a form of completion)
        const jobCompletedEvent: JobCompletedEvent = {
          jobId: job.id,
          type: job.type as JobType,
          status: JobStatus.PARTIAL_SUCCESS,
          submittedBy: job.submittedBy || 'unknown',
          submittedAt: job.submittedAt,
          startedAt: job.startedAt,
          completedAt: new Date(),
          durationMs,
          summary: {
            totalRecordsProcessed,
            totalRecordsFailed,
          },
          eventTimestamp: new Date(),
        };

        await this.kafkaService.publish<JobCompletedEvent>(
          'dtm.jobs.completed',
          jobCompletedEvent,
          jobId,
        );

        // Update status to PARTIAL_SUCCESS
        await this.jobRepository.updateStatus(jobId, JobStatus.PARTIAL_SUCCESS);
        this.logger.log(`Job ${jobId} marked as PARTIAL_SUCCESS`);

        this.eventsGateway.broadcast({
          type: 'job_completed',
          jobId,
          status: 'partial_success',
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
          results: {
            totalRecordsProcessed,
            totalRecordsFailed,
            stepsCompleted,
            stepsFailed,
            stepsAborted,
            durationMs,
          },
        });
      } catch (error) {
        this.logger.error(`Error marking job ${jobId} as partial success: ${error}`);
        await this.jobRepository.updateStatus(jobId, JobStatus.PARTIAL_SUCCESS);
      }
    }, jobId);
  }

  /**
   * Evaluate workflow outcome rules to determine final job status.
   * Builds a JobContext from step data and cascade configuration,
   * then runs the workflow's outcome rules in priority order.
   */
  private evaluateOutcome(
    job: Job,
    steps: DbStep[],
    wfConfig: WorkflowConfigService,
  ): { rule: string; result: OutcomeResult } {
    // Build step status map
    const stepStatuses: Record<string, string> = {};
    for (const step of steps) {
      stepStatuses[step.stepValue] = step.status;
    }

    // Build cascade counts from cascade config
    const cascades = wfConfig.getCascades();
    const cascadeCounts: Record<string, number> = {};
    const failedCascadeCounts: Record<string, number> = {};
    const attemptedCascades: string[] = [];
    const emptyCascades: string[] = [];

    for (const cascade of cascades) {
      const cascadeName = cascade.cascadeName;
      cascadeCounts[cascadeName] = 0;
      failedCascadeCounts[cascadeName] = 0;

      // Find steps related to this cascade's output step
      const outputSteps = steps.filter((s) => s.stepValue === cascade.outputStep);
      // Find input steps (uses cascade inputStep field if defined)
      const inputSteps = cascade.inputStep
        ? steps.filter((s) => s.stepValue === cascade.inputStep)
        : [];

      // Cascade was attempted if any of its steps exist
      if (outputSteps.length > 0 || inputSteps.length > 0) {
        attemptedCascades.push(cascadeName);
      }

      // Count successes from output steps
      for (const ts of outputSteps) {
        if (ts.status === StepStatus.COMPLETED || ts.status === StepStatus.PARTIAL_SUCCESS) {
          cascadeCounts[cascadeName]++;
        } else if (ts.status === StepStatus.FAILED) {
          failedCascadeCounts[cascadeName]++;
        }
      }

      // If no output step succeeded, check if input step failed
      // (indicates cascade was attempted but couldn't even be processed)
      if (cascadeCounts[cascadeName] === 0) {
        for (const es of inputSteps) {
          if (es.status === StepStatus.FAILED) {
            failedCascadeCounts[cascadeName]++;
          }
        }
      }
    }

    // Build context
    const ctx: JobContext = {
      jobId: job.id,
      workflowVariant: (job.payload as Record<string, unknown>)?.variant as string || 'default',
      cascadeCounts,
      failedCascadeCounts,
      emptyCascades,
      attemptedCascades,
      stepStatuses,
    };

    this.logger.debug(
      `Outcome evaluation context for job ${job.id}: ` +
        `attempted=${attemptedCascades.join(',')}, ` +
        `cascadeCounts=${JSON.stringify(cascadeCounts)}, ` +
        `failedCascadeCounts=${JSON.stringify(failedCascadeCounts)}`,
    );

    // Evaluate outcome rules
    try {
      const result = wfConfig.determineOutcome(ctx);

      // Find which rule matched (for logging)
      const rules = wfConfig.getOutcomeRules();
      const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
      const matchedRule = sortedRules.find((r) => r.condition(ctx));

      return {
        rule: matchedRule?.id || 'unknown',
        result,
      };
    } catch (error) {
      this.logger.error(`Outcome rule evaluation failed for job ${job.id}: ${error}`);
      // Fallback to FAILED if outcome rules can't be evaluated
      return {
        rule: 'error-fallback',
        result: {
          jobStatus: 'failed',
          reason: `Outcome rule evaluation error: ${error}`,
          warnings: [],
          errors: [`Outcome evaluation failed: ${error}`],
          metadata: {},
        },
      };
    }
  }

  /**
   * Count output records from step outputs.
   * Looks for known output data arrays in steps that have requiresAcknowledgement
   * (i.e., output/submit steps that publish data to Kafka).
   */
  private countOutputRecords(steps: DbStep[], status: StepStatus): number {
    return steps.reduce((total, step) => {
      // Only count steps with the specified status that have output data
      if (!step.stepValue || step.status !== status) {
        return total;
      }

      // No output means no records
      if (!step.output) {
        return total;
      }

      // Dynamically detect output data arrays - look for any array value in step output
      // This replaces the previous hardcoded list of known output keys
      for (const value of Object.values(step.output)) {
        if (Array.isArray(value)) {
          return total + value.length;
        }
      }

      return total;
    }, 0);
  }

  /**
   * Continue a workflow job after a step completes
   * - Checks the current state of all steps
   * - Decides what to do next based on the state
   * - Delegates the next step if appropriate
   *
   * Called by: CallbackService after updating step status
   *
   * Decision logic:
   * - If any step failed → Don't delegate anything (job is failed)
   * - If all steps completed → Job is complete (do nothing)
   * - If there are pending steps and previous step completed → Delegate next step
   */
  async continueJob(jobId: string): Promise<{
    success: boolean;
    message: string;
    nextStepDelegated?: boolean;
    jobComplete?: boolean;
  }> {
    return this.correlationService.runWithCorrelationId(async () => {
      this.logger.log(`Continuing orchestration for job ${jobId}`);

      try {
        // 1. Fetch all steps for this job
        const steps = await this.stepRepository.findByJobId(jobId);
        if (!steps || steps.length === 0) {
          return {
            success: false,
            message: `No steps found for job ${jobId}`,
          };
        }

        // 1b. Feature gate: skip PENDING steps whose featureGate flag resolves to false
        const job = await this.jobRepository.findById(jobId);
        if (job) {
          const wfCfg = this.getWorkflowConfig(job);
          const wfDef = wfCfg.getWorkflow();
          const defaultFlags = wfDef.featureFlags?.defaults ?? {};
          const jobFlags = (job.payload as any)?.featureFlags ?? {};
          const resolvedFlags: Record<string, unknown> = { ...defaultFlags, ...jobFlags };

          const stepDefs = wfCfg.getActiveStepDefinitions(job.type);
          for (const step of steps) {
            if (step.status !== StepStatus.PENDING) continue;
            const def = stepDefs.find((d) => d.step === step.stepValue);
            if (def?.featureGate && resolvedFlags[def.featureGate] === false) {
              this.logger.log(
                `⏭️ Skipping step ${step.stepValue}: feature flag ${def.featureGate} is disabled`,
              );
              await this.stepRepository.updateFromCallback(step.id, {
                status: StepStatus.SKIPPED,
                error: `Skipped: feature flag ${def.featureGate} is disabled`,
              });
              step.status = StepStatus.SKIPPED;
            }
          }
        }

        // 2. Analyze current state
        const pendingSteps = steps.filter((s) => s.status === StepStatus.PENDING);
        // Include PARTIAL_SUCCESS as "completed" for dependency checking
        // PARTIAL_SUCCESS means some children succeeded, so dependent steps can proceed
        const completedSteps = steps.filter(
          (s) => s.status === StepStatus.COMPLETED || s.status === StepStatus.PARTIAL_SUCCESS,
        );
        const failedSteps = steps.filter((s) => s.status === StepStatus.FAILED);
        const skippedSteps = steps.filter((s) => s.status === StepStatus.SKIPPED);
        const inProgressSteps = steps.filter(
          (s) =>
            s.status === StepStatus.IN_PROGRESS ||
            s.status === StepStatus.DELEGATED ||
            s.status === StepStatus.IN_PROGRESS_RETRYING ||
            s.status === StepStatus.WAITING_FOR_ACK ||
            s.status === StepStatus.WAITING_FOR_CHILDREN,
        );

        this.logger.debug(
          `Job ${jobId} state: ${completedSteps.length} completed, ${pendingSteps.length} pending, ${failedSteps.length} failed, ${skippedSteps.length} skipped, ${inProgressSteps.length} in progress/waiting`,
        );

        // 3. Decision logic

        // Case 1: Some step(s) failed → Handle partial failure (skip only dependent steps)
        if (failedSteps.length > 0) {
          this.logger.log(
            `Job ${jobId} has ${failedSteps.length} failed step(s). Checking pending steps for dependency failures.`,
          );

          // Mark only pending steps that depend on failed steps as SKIPPED
          const skippedCount = await this.markDependentStepsAsSkipped(
            jobId,
            failedSteps,
            pendingSteps,
          );

          // Check if there are still pending steps that can proceed (independent paths)
          const remainingPendingSteps = await this.stepRepository
            .findByJobId(jobId)
            .then((steps) => steps.filter((s) => s.status === StepStatus.PENDING));

          // Check if there are still steps in progress
          const currentInProgressSteps = await this.stepRepository
            .findByJobId(jobId)
            .then((steps) =>
              steps.filter(
                (s) =>
                  s.status === StepStatus.IN_PROGRESS ||
                  s.status === StepStatus.DELEGATED ||
                  s.status === StepStatus.IN_PROGRESS_RETRYING ||
                  s.status === StepStatus.WAITING_FOR_ACK ||
                  s.status === StepStatus.WAITING_FOR_CHILDREN,
              ),
            );

          if (remainingPendingSteps.length === 0 && currentInProgressSteps.length === 0) {
            // All steps are terminal (completed/failed/skipped). Evaluate outcome rules
            // to determine whether the job is FAILED or PARTIAL_SUCCESS.
            const job = await this.jobRepository.findById(jobId);
            if (!job) {
              throw new Error(`Job ${jobId} not found`);
            }
            const wfConfig = this.getWorkflowConfig(job);
            const allSteps = await this.stepRepository.findByJobId(jobId);
            const outcome = this.evaluateOutcome(job, allSteps, wfConfig);

            this.logger.log(
              `Job ${jobId}: Outcome rule "${outcome.rule}" → ${outcome.result.jobStatus}. Reason: ${outcome.result.reason}`,
            );

            if (outcome.result.jobStatus === 'completed') {
              await this.completeJob(jobId);
              return {
                success: true,
                message: `Job completed via outcome rule "${outcome.rule}" despite failed steps. Reason: ${outcome.result.reason}`,
                nextStepDelegated: false,
                jobComplete: true,
              };
            }

            if (outcome.result.jobStatus === 'partial_success') {
              await this.partialSuccessJob(jobId, outcome.result.reason);
              return {
                success: true,
                message: `Job has failed steps. ${skippedCount} pending steps skipped. Job marked as PARTIAL_SUCCESS (${outcome.rule}).`,
                nextStepDelegated: false,
                jobComplete: true,
              };
            }

            await this.failJob(jobId, outcome.result.reason);
            return {
              success: true,
              message: `Job has failed steps. ${skippedCount} pending steps skipped. Job marked as FAILED (${outcome.rule}).`,
              nextStepDelegated: false,
              jobComplete: true,
            };
          }

          if (remainingPendingSteps.length === 0) {
            // All pending steps were skipped but some are still in progress
            this.logger.log(
              `Job ${jobId}: All pending steps skipped due to failed dependencies. Waiting for ${currentInProgressSteps.length} in-progress step(s).`,
            );
            return {
              success: true,
              message: `Job has failed steps. ${skippedCount} pending steps skipped. Waiting for in-progress steps.`,
              nextStepDelegated: false,
              jobComplete: false,
            };
          }

          // There are still pending steps that can proceed (their dependencies succeeded)
          this.logger.log(
            `Job ${jobId}: ${skippedCount} steps skipped, but ${remainingPendingSteps.length} pending steps can still proceed (independent paths).`,
          );
          // Continue to Case 4 to delegate ready steps
        }

        // Case 2: All steps completed (or skipped) → Job complete
        const doneCount = completedSteps.length + skippedSteps.length;
        if (pendingSteps.length === 0 && failedSteps.length === 0 && inProgressSteps.length === 0) {
          this.logger.log(`Job ${jobId} complete: all ${doneCount} steps finished (${completedSteps.length} completed, ${skippedSteps.length} skipped)`);
          // Use completeJob to ensure stats are calculated and events published
          await this.completeJob(jobId);
          return {
            success: true,
            message: `Job complete: all ${doneCount} steps finished`,
            nextStepDelegated: false,
            jobComplete: true,
          };
        }

        // Case 3: Steps still in progress
        // Only short-circuit if there are NO pending steps to check.
        // If pending steps exist, fall through to Case 4 — other branches
        // may have all dependencies satisfied and can be delegated in parallel.
        if (inProgressSteps.length > 0 && pendingSteps.length === 0) {
          this.logger.debug(
            `Job ${jobId} has ${inProgressSteps.length} steps in progress and no pending steps. Waiting.`,
          );
          return {
            success: true,
            message: `Waiting for ${inProgressSteps.length} step(s) to complete`,
            nextStepDelegated: false,
            jobComplete: false,
          };
        }

        // 4. Case 4: Pending steps exist → Delegate ready steps (even if others are in progress)
        if (pendingSteps.length > 0) {
          // Find all steps whose dependencies are met
          const job = await this.jobRepository.findById(jobId);
          if (!job) {
            throw new Error(`Job ${jobId} not found`);
          }

          // Resolve per-job workflow config
          const wfConfig = this.getWorkflowConfig(job);
          const stepDefinitions = wfConfig.getActiveStepDefinitions(job.type);

          const readySteps = this.findReadySteps(
            pendingSteps,
            completedSteps,
            job.type as JobType,
            job.payload as any,
            wfConfig,
          );

          if (readySteps.length === 0) {
            this.logger.debug(
              `Job ${jobId} has ${pendingSteps.length} pending steps, but none have their dependencies met yet`,
            );
            return {
              success: true,
              message: `No steps ready (waiting for dependencies)`,
              nextStepDelegated: false,
              jobComplete: false,
            };
          }

          if (readySteps.length === 1) {
            // Single step ready - use delegateStep()
            const step = readySteps[0];
            const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);

            if (!stepDef) {
              throw new Error(
                `Step definition not found for step ${step.stepValue} of job ${jobId}`,
              );
            }

            // For steps that collect dependency outputs, pass full output data
            // For other steps, pass lightweight data references
            let inputData: Record<string, unknown>;
            if (stepDef.collectDependencyOutputs) {
              const dependencyData = this.collectDependencyOutputs(stepDef, completedSteps);
              inputData = {
                ...(step.input ?? {}),
                ...(Object.keys(dependencyData).length > 0 && { dependencyData }),
              };
            } else {
              const dataReferences = this.collectDataReferencesFromDependencies(
                stepDef,
                completedSteps,
              );
              inputData = {
                ...(step.input ?? {}),
                ...(dataReferences.length > 0 && { dataReferences }),
              };
            }

            const delegationDto: StepDelegationDto = {
              jobId: job.id,
              stepId: step.id,
              stepValue: step.stepValue,
              queueName: stepDef.queueName,
              jobType: job.type as JobType,
              input: inputData,
              sourceConfig: stepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
              processingConfig: stepDef.metadata
                ?.processingConfig as StepDelegationDto['processingConfig'],
            };

            const delegationResult = await this.delegationService.delegateStep(delegationDto);

            if (!delegationResult.success) {
              this.logger.error(
                `Failed to delegate step ${step.stepValue} for job ${jobId}: ${delegationResult.error}`,
              );
              return {
                success: false,
                message: `Failed to delegate step: ${delegationResult.error}`,
                nextStepDelegated: false,
              };
            }

            this.logger.log(`Successfully delegated step ${step.stepValue} for job ${jobId}`);

            return {
              success: true,
              message: `Delegated step ${step.stepValue}`,
              nextStepDelegated: true,
              jobComplete: false,
            };
          } else {
            // Multiple steps ready - use delegateSteps() for parallel execution
            const delegationDtos: StepDelegationDto[] = readySteps.map((step) => {
              const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);
              if (!stepDef) {
                throw new Error(
                  `Step definition not found for step ${step.stepValue} of job ${jobId}`,
                );
              }

              // For steps that collect dependency outputs, pass full output data
              // For other steps, pass lightweight data references
              // Always merge with CURRENT job payload to pick up any dynamic updates from worker callbacks
              let inputData: Record<string, unknown>;
              if (stepDef.collectDependencyOutputs) {
                const dependencyData = this.collectDependencyOutputs(stepDef, completedSteps);
                inputData = {
                  ...(step.input ?? {}),
                  ...(job.payload as Record<string, unknown>), // Merge current payload for dynamic fields
                  ...(Object.keys(dependencyData).length > 0 && { dependencyData }),
                };
              } else {
                const dataReferences = this.collectDataReferencesFromDependencies(
                  stepDef,
                  completedSteps,
                );
                inputData = {
                  ...(step.input ?? {}),
                  ...(job.payload as Record<string, unknown>), // Merge current payload for dynamic fields
                  ...(dataReferences.length > 0 && { dataReferences }),
                };
              }

              return {
                jobId: job.id,
                stepId: step.id,
                stepValue: step.stepValue,
                queueName: stepDef.queueName,
                jobType: job.type as JobType,
                input: inputData,
                sourceConfig: stepDef.metadata
                  ?.sourceConfig as StepDelegationDto['sourceConfig'],
                processingConfig: stepDef.metadata
                  ?.processingConfig as StepDelegationDto['processingConfig'],
              };
            });

            this.logger.log(
              `Delegating ${readySteps.length} steps in parallel for job ${jobId}: steps ${readySteps.map((s) => s.stepValue).join(', ')}`,
            );

            const delegationResult = await this.delegationService.delegateSteps(delegationDtos);

            if (delegationResult.successfulDelegations === 0) {
              this.logger.error(`Failed to delegate any parallel steps for job ${jobId}`);
              return {
                success: false,
                message: `Failed to delegate parallel steps`,
                nextStepDelegated: false,
              };
            }

            this.logger.log(
              `Successfully delegated ${delegationResult.successfulDelegations} of ${delegationResult.totalSteps} parallel steps for job ${jobId}`,
            );

            return {
              success: true,
              message: `Delegated ${delegationResult.successfulDelegations} of ${delegationResult.totalSteps} parallel steps`,
              nextStepDelegated: true,
              jobComplete: false,
            };
          }
        }

        // Case 5: In-progress steps with no ready pending steps, or unexpected state
        if (inProgressSteps.length > 0) {
          this.logger.debug(
            `Job ${jobId} has ${inProgressSteps.length} steps in progress, no pending steps ready. Waiting.`,
          );
          return {
            success: true,
            message: `Waiting for ${inProgressSteps.length} step(s) to complete`,
            nextStepDelegated: false,
            jobComplete: false,
          };
        }

        this.logger.warn(`Job ${jobId} in unexpected state. No action taken.`);
        return {
          success: true,
          message: `Job in unexpected state. No action needed.`,
          nextStepDelegated: false,
          jobComplete: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Error continuing job ${jobId}: ${errorMessage}`);

        return {
          success: false,
          message: `Error: ${errorMessage}`,
        };
      }
    }, jobId);
  }

  /**
   * Mark dependent (pending) steps as SKIPPED when a step fails or is skipped
   * Only skips steps that actually depend on the failed/skipped steps (checks step definitions)
   * Handles TRANSITIVE dependencies: if A fails → B skipped, B skipped → C skipped, etc.
   * Adds output explaining which step(s) caused the skip
   *
   * @param jobId The job ID
   * @param failedSteps Steps that failed
   * @param pendingSteps Steps that are still pending (to be skipped if dependent)
   * @returns Number of steps actually skipped
   */
  private async markDependentStepsAsSkipped(
    jobId: string,
    failedSteps: DbStep[],
    pendingSteps: DbStep[],
  ): Promise<number> {
    if (pendingSteps.length === 0) {
      return 0; // Nothing to skip
    }

    // Get job to determine workflow type
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      this.logger.error(`Job ${jobId} not found when trying to skip dependent steps`);
      return 0;
    }

    // Get step definitions to check dependencies
    const wfConfig = this.getWorkflowConfig(job);
    const stepDefinitions = wfConfig.getActiveStepDefinitions(job.type);

    // Get ALL current steps (including already skipped ones) to handle transitive dependencies
    const allSteps = await this.stepRepository.findByJobId(jobId);
    const alreadySkippedSteps = allSteps.filter((s) => s.status === StepStatus.SKIPPED);

    // Build set of blocked step values (failed + already skipped) for quick lookup
    const blockedStepValues = new Set([
      ...failedSteps.map((s) => s.stepValue),
      ...alreadySkippedSteps.map((s) => s.stepValue),
    ]);

    // Build a map of child step → fan-out parent step for unreachable dependency detection.
    // When a fan-out parent (discovery step) is blocked, its child steps will never be
    // created, so any step depending on those children is also unreachable.
    // Uses the shared helper for consistency with findReadySteps.
    const childStepToFanOutParent = this.buildChildStepToFanOutParentMap(stepDefinitions);

    // Iteratively find all steps that need to be skipped (handles transitive deps)
    const stepsToSkip: DbStep[] = [];
    let previousBlockedCount = 0;

    do {
      previousBlockedCount = blockedStepValues.size;

      // Filter pending steps to only those that depend on blocked steps
      for (const pendingStep of pendingSteps) {
        // Skip if already in the list to skip
        if (stepsToSkip.some((s) => s.id === pendingStep.id)) {
          continue;
        }

        const stepDef = stepDefinitions.find((def) => def.step === pendingStep.stepValue);
        if (!stepDef) {
          this.logger.warn(
            `No step definition found for ${pendingStep.stepValue}, skipping by default`,
          );
          stepsToSkip.push(pendingStep);
          blockedStepValues.add(pendingStep.stepValue);
          continue;
        }

        // Check if any of this step's dependencies are in the blocked set
        // OR if a dependency is a child step whose fan-out parent (or ancestor) is blocked.
        // Uses recursive walk-up for nested fan-out: PublishReading → DiscoverReadings → DiscoverSensors.
        const hasBlockedDependency = stepDef.dependencies.some((dep) => {
          // Direct dependency blocked
          if (blockedStepValues.has(dep)) {
            return true;
          }
          // Walk up the fan-out chain to check if any ancestor is blocked
          let current = dep;
          const visited = new Set<string>();
          while (childStepToFanOutParent.has(current)) {
            if (visited.has(current)) break;
            visited.add(current);
            const parent = childStepToFanOutParent.get(current)!;
            if (blockedStepValues.has(parent)) {
              this.logger.debug(
                `Dependency ${dep} is a fan-out descendant of blocked ancestor ${parent}`,
              );
              return true;
            }
            current = parent;
          }
          return false;
        });

        if (hasBlockedDependency) {
          this.logger.debug(
            `Step ${pendingStep.stepValue} depends on blocked step(s), will be skipped`,
          );
          stepsToSkip.push(pendingStep);
          // Add to blocked set for next iteration (transitive dependencies)
          blockedStepValues.add(pendingStep.stepValue);
        } else {
          this.logger.debug(
            `Step ${pendingStep.stepValue} has no blocked dependencies, can proceed`,
          );
        }
      }
    } while (blockedStepValues.size > previousBlockedCount); // Keep iterating until no new blocked steps

    if (stepsToSkip.length === 0) {
      this.logger.log(
        `No pending steps depend on the blocked steps. All can proceed independently.`,
      );
      return 0;
    }

    // Build reason message from failed steps
    const failedStepSummary = failedSteps
      .map((step) => {
        const stepName = step.description || step.stepValue;
        const errorMsg = step.error || 'Unknown error';
        return `${stepName}: ${errorMsg}`;
      })
      .join('; ');

    const reason = {
      skippedReason: 'Dependent step(s) failed',
      failedSteps: failedSteps.map((step) => ({
        stepId: step.id,
        stepValue: step.stepValue,
        stepName: step.description || step.stepValue,
        error: step.error || 'Unknown error',
      })),
      skippedAt: new Date().toISOString(),
    };

    this.logger.log(
      `Marking ${stepsToSkip.length} of ${pendingSteps.length} pending steps as SKIPPED due to failed dependencies: ${failedStepSummary}`,
    );

    // Update only dependent steps to SKIPPED with reason
    await Promise.all(
      stepsToSkip.map(async (step) => {
        try {
          await this.stepRepository.updateFromCallback(step.id, {
            status: StepStatus.SKIPPED,
            output: reason,
            error: `Skipped: ${failedStepSummary}`,
            recordsProcessed: 0,
            recordsFailed: 0,
          });
          this.logger.debug(`Marked step ${step.id} (${step.stepValue}) as SKIPPED`);
        } catch (error) {
          this.logger.error(
            `Failed to mark step ${step.id} as SKIPPED: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );

    return stepsToSkip.length;
  }

  /**
   * Build a map of child step type → fan-out parent step type.
   * Used to resolve dependencies on fan-out child steps to their topmost parent.
   */
  private buildChildStepToFanOutParentMap(
    stepDefinitions: StepDefinition[],
  ): Map<string, string> {
    const childStepToFanOutParent = new Map<string, string>();
    for (const def of stepDefinitions) {
      if (def.fanOut?.enabled && def.fanOut.childStepChain) {
        for (const childStep of def.fanOut.childStepChain) {
          childStepToFanOutParent.set(childStep, def.step);
        }
      }
    }
    return childStepToFanOutParent;
  }

  /**
   * Resolve a dependency step to its topmost non-child fan-out parent.
   * For nested fan-out patterns (e.g., PublishReading → DiscoverReadings → DiscoverSensors),
   * this walks up the fan-out chain until it finds the root parent.
   *
   * Returns the original depStep if it's not a fan-out child.
   */
  private resolveToTopmostFanOutParent(
    depStep: string,
    childStepToFanOutParent: Map<string, string>,
  ): string {
    let resolved = depStep;
    const visited = new Set<string>();
    while (childStepToFanOutParent.has(resolved)) {
      if (visited.has(resolved)) break; // Safety: prevent infinite loop
      visited.add(resolved);
      resolved = childStepToFanOutParent.get(resolved)!;
    }
    return resolved;
  }

  /**
   * Find all pending steps whose dependencies are fully met
   *
   * A step is "ready" if all steps it depends on have COMPLETED status.
   * This enables parallel execution of independent steps.
   * Supports conditional dependencies based on job payload
   *
   * For fan-out child dependencies (e.g., PublishReading), the dependency is resolved
   * to the topmost fan-out parent (e.g., DiscoverSensors). This ensures the step waits
   * for ALL fan-out children to complete, not just the first individual instance.
   *
   * @param pendingSteps - Steps with PENDING status
   * @param completedSteps - Steps with COMPLETED status
   * @param jobType - Workflow/job type (to get step definitions)
   * @param jobPayload - Job payload for conditional dependency logic
   * @returns Array of steps ready to be delegated
   */
  private findReadySteps(
    pendingSteps: DbStep[],
    completedSteps: DbStep[],
    jobType: JobType,
    jobPayload: Record<string, unknown>,
    wfConfigOverride?: WorkflowConfigService,
  ): DbStep[] {
    const wfCfg = wfConfigOverride || this.workflowConfig;
    const stepDefinitions = wfCfg.getActiveStepDefinitions(jobType);
    const completedStepValues = new Set(completedSteps.map((s) => s.stepValue));

    // Build child step → fan-out parent map for resolving dependencies on fan-out children.
    // When a step depends on a fan-out child (e.g., PublishReading), we resolve it to the
    // topmost fan-out parent (e.g., DiscoverSensors) so the step waits for ALL children to complete.
    const childStepToFanOutParent = this.buildChildStepToFanOutParentMap(stepDefinitions);

    return pendingSteps.filter((step) => {
      const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);
      if (!stepDef) {
        this.logger.warn(`Step definition not found for step ${step.stepValue}. Skipping.`);
        return false;
      }

      // Get base dependencies from configuration
      const dependencies = [...stepDef.dependencies];

      // Check if all dependencies are completed.
      // For fan-out child dependencies, resolve to the topmost fan-out parent.
      // This ensures steps wait for ALL fan-out children to complete (parent COMPLETED)
      // rather than becoming ready when any single child instance completes.
      const allDependenciesMet = dependencies.every((depStep) => {
        const resolved = this.resolveToTopmostFanOutParent(depStep, childStepToFanOutParent);
        if (resolved !== depStep) {
          this.logger.debug(
            `Resolved fan-out child dependency ${depStep} → topmost parent ${resolved}`,
          );
        }
        return completedStepValues.has(resolved);
      });

      if (allDependenciesMet) {
        this.logger.debug(
          `Step ${step.stepValue} is ready - dependencies ${dependencies.length > 0 ? dependencies.map((d) => d).join(', ') : 'none'} met`,
        );
      }

      return allDependenciesMet;
    });
  }

  /**
   * Collect data references from completed dependency steps
   * This allows passing data pointers (e.g., database table references) between workers
   * without sending large datasets through SQS
   */
  private collectDataReferencesFromDependencies(
    stepDef: StepDefinition,
    completedSteps: DbStep[],
  ): Array<{
    fromStep: string;
    dataReference: {
      type: string;
      table?: string;
      batchId?: string;
      queueUrl?: string;
      metadata?: Record<string, unknown>;
    };
  }> {
    const dataReferences: Array<{
      fromStep: string;
      dataReference: {
        type: string;
        table?: string;
        batchId?: string;
        queueUrl?: string;
        metadata?: Record<string, unknown>;
      };
    }> = [];

    // For each dependency, check if the completed step has a dataReference in its output
    for (const depStep of stepDef.dependencies) {
      const depStepValue = depStep;
      const completedDepStep = completedSteps.find((s) => s.stepValue === depStepValue);

      if (completedDepStep?.output) {
        const output = completedDepStep.output;
        if (output.dataReference) {
          dataReferences.push({
            fromStep: depStepValue,
            dataReference: output.dataReference as {
              type: string;
              table?: string;
              batchId?: string;
              queueUrl?: string;
              metadata?: Record<string, unknown>;
            },
          });
          this.logger.log(`Passing data reference from step ${depStepValue} to ${stepDef.step}`);
        }
      }
    }

    return dataReferences;
  }

  /**
   * Collect full output data from completed dependency steps
   * This passes the actual data (not just references) to the next step
   * Used for input -> output step workflows where the output step needs the input step's data
   */
  private collectDependencyOutputs(
    stepDef: StepDefinition,
    completedSteps: DbStep[],
  ): Record<string, Record<string, unknown>> {
    const dependencyData: Record<string, Record<string, unknown>> = {};

    // For each dependency, get the full output data
    for (const depStep of stepDef.dependencies) {
      const depStepValue = depStep;
      const completedDepStep = completedSteps.find((s) => s.stepValue === depStepValue);

      this.logger.log(
        `[collectDependencyOutputs] ${stepDef.step} dep=${depStepValue}: found=${!!completedDepStep}, hasOutput=${!!completedDepStep?.output}, outputKeys=${completedDepStep?.output ? Object.keys(completedDepStep.output).join(',') : 'N/A'}`,
      );

      if (completedDepStep?.output) {
        // Store the full output under the step name
        dependencyData[depStepValue] = completedDepStep.output;
        this.logger.log(`Passing output data from step ${depStepValue} to ${stepDef.step}`);
      }
    }

    return dependencyData;
  }

  /**
   * Get orchestration status for a job
   * Useful for monitoring and debugging
   */
  async getOrchestrationStatus(jobId: string): Promise<{
    jobId: string;
    jobStatus: JobStatus;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    inProgressSteps: number;
    pendingSteps: number;
    nextStep?: {
      stepNumber: string; // String enum value
      status: StepStatus;
    };
  }> {
    const job = await this.jobRepository.findById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const steps = await this.stepRepository.findByJobId(jobId);

    // Include PARTIAL_SUCCESS as "completed" for status reporting
    const completedSteps = steps.filter(
      (s) => s.status === StepStatus.COMPLETED || s.status === StepStatus.PARTIAL_SUCCESS,
    );
    const failedSteps = steps.filter((s) => s.status === StepStatus.FAILED);
    const inProgressSteps = steps.filter(
      (s) =>
        s.status === StepStatus.IN_PROGRESS ||
        s.status === StepStatus.DELEGATED ||
        s.status === StepStatus.WAITING_FOR_ACK ||
        s.status === StepStatus.WAITING_FOR_CHILDREN,
    );
    const pendingSteps = steps.filter((s) => s.status === StepStatus.PENDING);

    // Find next step (by array order, not completed or partial_success)
    const wfConfig = this.getWorkflowConfig(job);
    const nextStep = steps
      .filter((s) => s.status !== StepStatus.COMPLETED && s.status !== StepStatus.PARTIAL_SUCCESS)
      .sort((a, b) => {
        const orderA = wfConfig.getStepOrder(a.stepValue, job.type);
        const orderB = wfConfig.getStepOrder(b.stepValue, job.type);
        return orderA - orderB;
      })[0];

    return {
      jobId: job.id,
      jobStatus: job.status,
      totalSteps: steps.length,
      completedSteps: completedSteps.length,
      failedSteps: failedSteps.length,
      inProgressSteps: inProgressSteps.length,
      pendingSteps: pendingSteps.length,
      nextStep: nextStep
        ? {
            stepNumber: nextStep.stepValue,
            status: nextStep.status,
          }
        : undefined,
    };
  }
}
