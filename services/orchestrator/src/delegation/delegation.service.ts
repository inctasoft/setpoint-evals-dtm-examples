import { Injectable, Logger } from '@nestjs/common';
import { SqsService, LambdaStepPayload } from '../aws/sqs.service';
import { SqsConfig } from '../aws/sqs.config';
import { StepRepository, StepStatus, JobType } from '@dtm/database';
import { CorrelationService } from '../common/correlation/correlation.service';
import {
  StepDelegationDto,
  DelegationResult,
  BulkDelegationResult,
} from './dto/step-delegation.dto';
import { WorkflowConfigService, WorkflowRegistryService } from '../workflow-loader';

/**
 * Delegation Service
 * Handles the delegation of workflow steps to Lambda workers via SQS
 */
@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly sqsConfig: SqsConfig,
    private readonly stepRepository: StepRepository,
    private readonly correlationService: CorrelationService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  /**
   * Delegate a single step to a Lambda worker
   * 1. Send message to SQS
   * 2. Update step status to DELEGATED
   * 3. Store SQS message ID for tracking
   */
  async delegateStep(dto: StepDelegationDto): Promise<DelegationResult> {
    this.logger.log(`Delegating step ${dto.stepId} (${dto.stepValue}) for job ${dto.jobId}`);

    try {
      // Atomically claim the step to prevent double-delegation from concurrent continueJob calls.
      // If two callbacks arrive simultaneously and both try to delegate the same pending step,
      // only the first one to execute this UPDATE ... WHERE status='pending' will succeed.
      const claimed = await this.stepRepository.claimForDelegation(dto.stepId);
      if (!claimed) {
        this.logger.log(
          `Step ${dto.stepId} (${dto.stepValue}) already claimed by concurrent delegation. Skipping.`,
        );
        return {
          stepId: dto.stepId,
          success: true, // Not an error — another call handled it
        };
      }

      // Build callback URL for Lambda to report back
      // Use the configured callback URL which handles runtime detection
      const baseCallbackUrl = this.sqsConfig.getCallbackUrl();
      const callbackUrl = `${baseCallbackUrl}/api/v1/callback/step-progress`;

      this.logger.log(`Callback URL for job ${dto.jobId}: ${callbackUrl}`);

      // Prepare SQS payload
      const payload: LambdaStepPayload = {
        jobId: dto.jobId,
        stepId: dto.stepId,
        stepValue: dto.stepValue,
        jobType: dto.jobType,
        input: dto.input,
        callbackUrl,
        correlationId: this.correlationService.getCorrelationId(),
        sourceConfig: dto.sourceConfig, // Include Source config if present
        processingConfig: dto.processingConfig, // Include Processing config if present
      };

      // Get the queue URL for this specific step
      const queueUrl = this.sqsConfig.getQueueUrlByName(dto.queueName);

      // Send to SQS
      const sqsResult = await this.sqsService.sendStepMessage(payload, queueUrl);

      if (!sqsResult.success) {
        // SQS send failed
        this.logger.error(`Failed to send step ${dto.stepId} to SQS: ${sqsResult.error}`);

        // Mark step as failed
        await this.stepRepository.updateStatus(
          dto.stepId,
          StepStatus.FAILED,
          `Failed to delegate to Lambda: ${sqsResult.error}`,
        );

        return {
          stepId: dto.stepId,
          success: false,
          error: sqsResult.error,
        };
      }

      // SQS send successful - store SQS message ID (status already DELEGATED from claim)
      this.logger.log(
        `Successfully delegated step ${dto.stepId}. SQS MessageId: ${sqsResult.messageId}`,
      );

      // Store the SQS message ID for tracking
      await this.stepRepository.markAsDelegated(dto.stepId, sqsResult.messageId);

      return {
        stepId: dto.stepId,
        success: true,
        sqsMessageId: sqsResult.messageId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`Error delegating step ${dto.stepId}: ${errorMessage}`, errorStack);

      // Mark step as failed
      await this.stepRepository.updateStatus(
        dto.stepId,
        StepStatus.FAILED,
        `Delegation error: ${errorMessage}`,
      );

      return {
        stepId: dto.stepId,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Delegate multiple steps to Lambda workers
   * Used when a job has multiple independent steps that can run in parallel
   */
  async delegateSteps(dtos: StepDelegationDto[]): Promise<BulkDelegationResult> {
    this.logger.log(`Delegating ${dtos.length} steps in bulk`);

    const results = await Promise.all(dtos.map((dto) => this.delegateStep(dto)));

    const successfulDelegations = results.filter((r) => r.success).length;
    const failedDelegations = results.filter((r) => !r.success).length;

    this.logger.log(
      `Bulk delegation complete: ${successfulDelegations} succeeded, ${failedDelegations} failed`,
    );

    return {
      totalSteps: dtos.length,
      successfulDelegations,
      failedDelegations,
      results,
    };
  }

  /**
   * Retry delegating a failed step
   * Can be called manually or by a retry mechanism
   */
  async retryDelegation(stepId: string): Promise<DelegationResult> {
    this.logger.log(`Retrying delegation for step ${stepId}`);

    // Fetch step details with job relation (needed for workflow resolution)
    const step = await this.stepRepository.findById(stepId, ['job']);

    if (!step) {
      return {
        stepId,
        success: false,
        error: 'Step not found',
      };
    }

    // Get queue name from step definitions (resolve workflow per-job)
    const wfConfig = (step.job as any).workflowName && this.workflowRegistry.has((step.job as any).workflowName)
      ? this.workflowRegistry.get((step.job as any).workflowName)
      : this.workflowConfig;
    const stepDefinitions = wfConfig.getStepDefinitions(step.job.type);
    const stepDef = stepDefinitions.find((sd) => sd.step === step.stepValue);

    if (!stepDef) {
      return {
        stepId,
        success: false,
        error: `No step definition found for step ${step.stepValue} of type ${step.job.type}`,
      };
    }

    // Build input, re-collecting dependency outputs for steps that need them.
    // dependencyData is NOT stored in step.input (it is computed at delegation time),
    // so we must re-fetch it from the completed dependency steps.
    let inputData: Record<string, unknown> = { ...(step.input ?? {}) };
    if (stepDef.collectDependencyOutputs) {
      const allJobSteps = await this.stepRepository.findByJobId(step.job.id);
      const completedSteps = allJobSteps.filter((s) => s.status === StepStatus.COMPLETED);
      const dependencyData: Record<string, Record<string, unknown>> = {};
      for (const depStep of stepDef.dependencies) {
        const completedDepStep = completedSteps.find((s) => s.stepValue === depStep);
        if (completedDepStep?.output) {
          dependencyData[depStep] = completedDepStep.output as Record<string, unknown>;
        }
      }
      if (Object.keys(dependencyData).length > 0) {
        inputData = { ...inputData, dependencyData };
      }
    }

    // Build delegation DTO from existing step
    const dto: StepDelegationDto = {
      jobId: step.job.id,
      stepId: step.id,
      stepValue: step.stepValue,
      queueName: stepDef.queueName,
      jobType: step.job.type as JobType,
      input: inputData,
      sourceConfig: stepDef.metadata?.sourceConfig as StepDelegationDto['sourceConfig'],
      processingConfig: stepDef.metadata?.processingConfig as StepDelegationDto['processingConfig'],
    };

    // Reset DELEGATED → PENDING so claimForDelegation (which guards against concurrent
    // double-delegation by checking status='pending') can atomically claim it.
    // Without this, retryDelegation would silently succeed without re-sending the SQS message.
    if (step.status === StepStatus.DELEGATED) {
      await this.stepRepository.updateStatus(stepId, StepStatus.PENDING);
    }

    return this.delegateStep(dto);
  }
}
