import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  JobRepository,
  StepRepository,
  Step,
  JobStatus,
  StepStatus,
  ExecutionAttempt,
} from '@dtm/database';
import { StepProgressDto, StepProgressResponseDto } from './dto/step-progress.dto';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { CascadePublishService } from '../orchestration/cascade-publish.service';
import { FanOutService } from '../orchestration/fan-out.service';
import { TransformationFailedEvent } from './dto/transformed-data-events.dto';
import { WorkflowConfigService, WorkflowRegistryService } from '../workflow-loader';
import type { StepDefinition } from '@dtm/core';
import { KafkaService } from '../kafka/kafka.service';
import { EventsGateway } from '../websocket/events.gateway';
import { CorrelationService } from '../common/correlation/correlation.service';

/**
 * Callback Service
 *
 * Handles progress reporting from Lambda workers.
 * After updating step status, triggers orchestration to continue the job.
 *
 * For output steps with cascade dependencies:
 * - Checks if parent cascades have been acknowledged before publishing
 * - If dependencies not met, delays publishing until parent ACK arrives
 */
@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly stepRepository: StepRepository,
    private readonly orchestrationService: OrchestrationService,
    private readonly cascadePublishService: CascadePublishService,
    private readonly fanOutService: FanOutService,
    private readonly kafkaService: KafkaService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
    private readonly eventsGateway: EventsGateway,
    private readonly correlationService: CorrelationService,
  ) {}

  /**
   * Resolve the correct WorkflowConfigService for a job.
   */
  private getWorkflowConfig(job: { workflowName?: string }): WorkflowConfigService {
    if (job.workflowName && this.workflowRegistry.has(job.workflowName)) {
      return this.workflowRegistry.get(job.workflowName);
    }
    return this.workflowConfig;
  }

  /**
   * Get step definition for a specific step value and job type
   */
  private getStepDef(
    stepValue: string,
    jobType: string,
    wfConfig?: WorkflowConfigService,
  ): StepDefinition | undefined {
    const cfg = wfConfig || this.workflowConfig;
    return cfg.getStepDefinition(jobType, stepValue);
  }

  /**
   * Process step progress callback from Lambda worker
   * Updates step status and job status accordingly
   */
  async handleStepProgress(dto: StepProgressDto): Promise<StepProgressResponseDto> {
    this.logger.log(`Received progress callback for step ${dto.stepId}: ${dto.status}`);

    try {
      // 1. Verify step exists
      const step = await this.stepRepository.findById(dto.stepId);
      if (!step) {
        this.logger.error(`Step ${dto.stepId} not found`);
        throw new NotFoundException(`Step ${dto.stepId} not found`);
      }

      // 2. Verify job exists
      const job = await this.jobRepository.findById(dto.jobId);
      if (!job) {
        this.logger.error(`Job ${dto.jobId} not found`);
        throw new NotFoundException(`Job ${dto.jobId} not found`);
      }

      // Resolve the workflow config for this job
      const wfConfig = this.getWorkflowConfig(job);

      // 3. Guard: Reject callbacks for steps already in terminal state
      // This prevents SQS re-delivery from overwriting step output after
      // downstream steps have already been delegated with the original data
      const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set([
        StepStatus.COMPLETED,
        StepStatus.WAITING_FOR_ACK,
        StepStatus.FAILED,
        StepStatus.SKIPPED,
        StepStatus.PARTIAL_SUCCESS,
      ]);

      if (TERMINAL_STATUSES.has(step.status as StepStatus)) {
        this.logger.warn(
          `Ignoring duplicate callback for step ${dto.stepId} (job ${dto.jobId}): ` +
            `step is already in terminal status '${step.status}', incoming status '${dto.status}'`,
        );
        return {
          success: true,
          message: `Duplicate callback ignored: step already in '${step.status}'`,
          jobId: dto.jobId,
          stepId: dto.stepId,
        };
      }

      // 4. Check if this is a Fan-Out discovery step BEFORE updating status
      // This prevents a race condition where the step is marked COMPLETED before
      // we know if it has children (which would require WAITING_FOR_ACK status)
      if (dto.status === StepStatus.COMPLETED) {
        const stepConfig = this.getStepDef(step.stepValue, job.type, wfConfig);

        // Handle fan-out discovery step completion
        if (stepConfig && wfConfig.isFanOutDiscoveryStep(stepConfig)) {
          this.logger.log(
            `🔀 Fan-out discovery step ${step.stepValue} completed for job ${dto.jobId}`,
          );

          // Extract item IDs from output
          const itemIds = dto.output?.[stepConfig.fanOut!.itemIdField] as string[] | undefined;

          if (itemIds && itemIds.length > 0) {
            // IMPORTANT: Do NOT mark as COMPLETED yet!
            // handleDiscoveryComplete will set status to WAITING_FOR_ACK
            // This prevents race condition where continueJob() sees COMPLETED prematurely
            this.logger.log(
              `🔀 Discovery has ${itemIds.length} items - deferring status update to fan-out handler`,
            );

            // Update step with output data but NOT the status (use generic update)
            // The fan-out handler will set the appropriate status (WAITING_FOR_ACK)
            await this.stepRepository.update(dto.stepId, {
              output: {
                ...dto.output,
                ...(dto.dataReference && { dataReference: dto.dataReference }),
              },
              recordsProcessed: dto.recordsProcessed ?? 0,
              recordsFailed: dto.recordsFailed ?? 0,
            });

            // Trigger fan-out to create child steps (this sets status to WAITING_FOR_ACK)
            const fanOutResult = await this.fanOutService.handleDiscoveryComplete(
              job,
              (await this.stepRepository.findById(dto.stepId)) as Step,
              itemIds,
              stepConfig,
            );

            this.logger.log(
              `🔀 Fan-out result: ${fanOutResult.childrenCreated} children created - ${fanOutResult.message}`,
            );

            // Don't continue normal orchestration - fan-out service handles child delegation
            return {
              success: true,
              message: fanOutResult.message,
              jobId: dto.jobId,
              stepId: dto.stepId,
            };
          } else {
            this.logger.log(`🔀 Fan-out discovery found 0 entities - continuing orchestration`);
            // Empty discovery - continue normal orchestration (will be marked COMPLETED below)
          }
        }
      }

      // 5. Update step based on status (safe to do now - fan-out discoveries with children handled above)
      await this.updateStepFromCallback(dto);

      // 6. Handle child step completion and other post-completion logic
      if (dto.status === StepStatus.COMPLETED) {
        const stepConfig = this.getStepDef(step.stepValue, job.type, wfConfig);

        // 6a. Payload enrichment: extract fields from step output into job.payload
        if (stepConfig?.payloadEnrichments?.length && dto.output) {
          const currentJob = await this.jobRepository.findById(dto.jobId, false);
          if (currentJob) {
            let enriched = false;
            const updatedPayload = { ...currentJob.payload };

            for (const enrichment of stepConfig.payloadEnrichments) {
              const outputValue = dto.output[enrichment.outputField];
              if (
                outputValue !== undefined &&
                (enrichment.overwrite || !updatedPayload[enrichment.payloadField])
              ) {
                updatedPayload[enrichment.payloadField] = outputValue;
                enriched = true;
                this.logger.log(
                  `[Job ${dto.jobId}] Enriched payload.${enrichment.payloadField} ` +
                    `from ${step.stepValue} output.${enrichment.outputField}`,
                );
              }
            }

            if (enriched) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
              await (this.jobRepository as any).updatePayload(dto.jobId, updatedPayload);
            }
          }
        }

        // 6b. Check if this is a child step that completed
        // We need 'job' relation for FanOutService to access job type
        const updatedStep = await this.stepRepository.findById(dto.stepId, ['job']);
        // Track if this is a child step for fan-out aggregation
        let childStepResult: { nextStepDelegated: boolean; parentComplete: boolean } | null = null;

        if (updatedStep?.parentStepId) {
          this.logger.log(`🔀 Child step ${step.stepValue} completed for job ${dto.jobId}`);

          // Handle child step completion (may trigger next step in chain or parent completion)
          childStepResult = await this.fanOutService.handleChildStepComplete(updatedStep);

          if (childStepResult.nextStepDelegated) {
            this.logger.log(
              `🔀 Next child chain step delegated for entity ${updatedStep.childItemId}`,
            );
          }

          if (childStepResult.parentComplete) {
            this.logger.log(`🔀 All children complete for parent ${updatedStep.parentStepId}`);

            // ALWAYS call continueJob when parent completes. The parent step (e.g., DiscoverSensors)
            // just transitioned to COMPLETED, and downstream steps (e.g., EvaluateAlert) depend on it.
            // Even if the child step requires ACK, the parent's completion is a separate event that
            // must trigger continuation. The child's ACK only affects the child's own lifecycle, not
            // the parent's downstream dependencies. The job won't be prematurely marked complete
            // because those downstream steps are still PENDING.
            await this.orchestrationService.continueJob(dto.jobId);
          }

          // DON'T return early! Child steps that require acknowledgement should still publish to Kafka
          // Fall through to the Kafka publishing logic below
        }

        if (stepConfig?.requiresAcknowledgement) {
          // Re-fetch step to get updated data with output
          const updatedStepForPublish = await this.stepRepository.findById(dto.stepId);
          if (!updatedStepForPublish) {
            throw new Error(`Step ${dto.stepId} not found after update`);
          }

          // Check if this cascade has parent dependencies that must be ACK'd first
          const cascadeName = wfConfig.getCascadeNameFromStep(step.stepValue);

          if (cascadeName) {
            // Get all steps for the job to check dependency status
            const allSteps = await this.stepRepository.findByJobId(dto.jobId);
            const depsAreMet = this.cascadePublishService.areCascadeDependenciesMet(
              cascadeName,
              allSteps,
              wfConfig,
            );

            if (!depsAreMet) {
              // Parent dependencies not met - defer publishing until parent ACK arrives
              this.logger.log(
                `🔗 Step ${dto.stepId} (${step.stepValue}) requires acknowledgement but ` +
                  `parent cascade dependencies not yet met. Deferring publish.`,
              );

              return {
                success: true,
                message: 'Waiting for parent cascade acknowledgement before publishing',
                jobId: dto.jobId,
                stepId: dto.stepId,
              };
            }

            // Dependencies ARE met - inject FKs and publish
            // Use per-record FK injection to support FK map lookups for fan-out parents
            // (e.g., PaymentHistory looks up npdPaymentMethodId from PaymentMethod's FK map)
            if (updatedStepForPublish.output) {
              const outputDataKey = this.getOutputDataKey(cascadeName, wfConfig);
              const transformedData = updatedStepForPublish.output[outputDataKey] as
                | Array<Record<string, unknown>>
                | undefined;

              if (transformedData && Array.isArray(transformedData)) {
                // Inject FK values using the workflow-owned fkExtractor
                const injectedData = this.cascadePublishService.injectFkValues(
                  cascadeName,
                  allSteps,
                  transformedData,
                  wfConfig,
                );

                // Collect unique FK injections for logging
                const sampleInjections =
                  injectedData.length > 0
                    ? Object.entries(injectedData[0])
                        .filter(([key]) => key.startsWith('ext_'))
                        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
                    : {};

                this.logger.log(
                  `🔗 Injecting FK values for ${cascadeName}: sample=${JSON.stringify(sampleInjections)}`,
                );

                // Update the step output with injected data
                updatedStepForPublish.output = {
                  ...updatedStepForPublish.output,
                  [outputDataKey]: injectedData,
                  _fkInjections: sampleInjections, // Store sample for debugging/auditing
                };

                this.logger.log(
                  `✅ FK values injected into ${injectedData.length} ${cascadeName} record(s)`,
                );
              }
            }
          }

          // Check if there's actually any data to publish before setting WAITING_FOR_ACK
          // When recordsProcessed is 0 (e.g., no orders for a consumer), skip Kafka and complete directly
          const hasDataToPublish = this.hasTransformedDataToPublish(
            updatedStepForPublish,
            wfConfig,
          );

          if (!hasDataToPublish) {
            // Dynamic workflows (no cascades) still need WAITING_FOR_ACK for human review
            const isDynamic = wfConfig?.getWorkflow().dynamicSteps === true;
            if (isDynamic) {
              this.logger.log(
                `Step ${dto.stepId} (${step.stepValue}) is a dynamic step requiring acknowledgement — ` +
                  `setting WAITING_FOR_ACK (ACK via HTTP or Kafka)`,
              );
              await this.stepRepository.updateStatus(dto.stepId, StepStatus.WAITING_FOR_ACK);
              this.eventsGateway.broadcast({
                type: 'step_ack_waiting',
                jobId: dto.jobId,
                step: step.stepValue,
                timestamp: new Date().toISOString(),
                correlationId: this.correlationService.getCorrelationId(),
              });
              return {
                success: true,
                message: 'Step awaiting human acknowledgement (dynamic workflow)',
                jobId: dto.jobId,
                stepId: dto.stepId,
              };
            }

            this.logger.log(
              `Step ${dto.stepId} (${step.stepValue}) has no data to publish - completing directly (no ACK needed)`,
            );
            // No data to publish, so no ACK will come - step stays COMPLETED (already set above)
            // Trigger orchestration to process next steps
            this.logger.log(`Triggering orchestration to continue job ${dto.jobId}`);
            await this.orchestrationService.continueJob(dto.jobId);

            return {
              success: true,
              message: 'Step completed with 0 records (no ACK needed)',
              jobId: dto.jobId,
              stepId: dto.stepId,
            };
          }

          this.logger.log(
            `Step ${dto.stepId} (${step.stepValue}) requires acknowledgement - publishing to Kafka`,
          );

          // IMPORTANT: Set status to WAITING_FOR_ACK BEFORE publishing to Kafka
          // This prevents a race condition where the ACK arrives before the status is set,
          // causing the ACK handler to ignore it (since it only processes WAITING_FOR_ACK steps)
          await this.stepRepository.updateStatus(dto.stepId, StepStatus.WAITING_FOR_ACK);
          this.eventsGateway.broadcast({
            type: 'step_ack_waiting',
            jobId: dto.jobId,
            step: step.stepValue,
            timestamp: new Date().toISOString(),
            correlationId: this.correlationService.getCorrelationId(),
          });

          // Run Kafka publish AND FK-enriched output save in PARALLEL
          // This ensures:
          // 1. The FK-enriched output is saved even if Kafka fails
          // 2. Both operations complete as fast as possible
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          const saveEnrichedOutput = (this.stepRepository as any)['repo']
            .createQueryBuilder()
            .update()
            .set({ output: updatedStepForPublish.output }) // Persist FK-enriched output
            .where('id = :id', { id: dto.stepId })
            .execute();

          const publishToKafka = this.publishTransformedDataEvent(
            dto.jobId,
            updatedStepForPublish,
            wfConfig,
          );

          // Wait for both to complete - enriched output is saved regardless of Kafka success
          const [, kafkaResult] = await Promise.allSettled([saveEnrichedOutput, publishToKafka]);

          // If Kafka publish succeeded, update kafkaPublishedAt
          if (kafkaResult.status === 'fulfilled') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
            await (this.stepRepository as any)['repo']
              .createQueryBuilder()
              .update()
              .set({ kafkaPublishedAt: new Date() })
              .where('id = :id', { id: dto.stepId })
              .execute();

            this.logger.log(
              `Step ${dto.stepId} published to Kafka (output enriched with FK injections) - waiting for acknowledgement`,
            );
          } else {
            // Kafka failed but enriched output was still saved
            this.logger.error(
              `Step ${dto.stepId} Kafka publish failed, but FK-enriched output was saved. Error: ${kafkaResult.reason}`,
            );
            // Re-throw to let the normal error handling take over
            throw kafkaResult.reason;
          }

          return {
            success: true,
            message: 'Waiting for acknowledgement',
            jobId: dto.jobId,
            stepId: dto.stepId,
          };
        }
      }

      // 7. Determine if we should continue orchestration
      // For FAILED status, we need to re-fetch the step to get the updated retryCount
      // to determine if retries are exhausted
      if (dto.status === StepStatus.FAILED) {
        const updatedStep = await this.stepRepository.findById(dto.stepId);
        if (!updatedStep) {
          throw new Error(`Step ${dto.stepId} not found after update`);
        }

        // Check if retries are exhausted using the step's configured maxRetryCount.
        // The SQS poller provides reliable message re-delivery for retries.
        const effectiveMaxRetries = updatedStep.maxRetryCount;

        if (updatedStep.retryCount < effectiveMaxRetries) {
          // Step failed but has retries remaining - don't update job or continue orchestration
          // SQS will automatically retry this message
          this.logger.log(
            `Step ${dto.stepId} failed but has retries remaining (${updatedStep.retryCount}/${effectiveMaxRetries}). ` +
              `Waiting for SQS retry. Not updating job status or triggering orchestration.`,
          );

          return {
            success: true,
            message: `Step failed, waiting for retry (${updatedStep.retryCount}/${effectiveMaxRetries})`,
            jobId: dto.jobId,
            stepId: dto.stepId,
          };
        }

        // Ensure step is marked as permanently FAILED (not IN_PROGRESS_RETRYING)
        // This is needed when testOptions override effective max retries to 1,
        // since updateStepFromCallback may have set IN_PROGRESS_RETRYING based on the DB maxRetryCount
        if (updatedStep.status !== StepStatus.FAILED) {
          await this.stepRepository.updateStatus(dto.stepId, StepStatus.FAILED);
          this.logger.log(
            `Step ${dto.stepId} marked as permanently FAILED (effective max retries: ${effectiveMaxRetries})`,
          );
        }

        // Retries exhausted - check if this is a child step (fan-out pattern)
        // We need to trigger parent aggregation even for failed children
        if (updatedStep.parentStepId) {
          this.logger.log(
            `🔀 Child step ${updatedStep.stepValue} FAILED permanently for job ${dto.jobId}`,
          );

          // Re-fetch with job relation for FanOutService
          const stepWithJob = await this.stepRepository.findById(dto.stepId, ['job']);
          if (stepWithJob) {
            const childResult = await this.fanOutService.handleChildStepComplete(stepWithJob);

            if (childResult.parentComplete) {
              this.logger.log(
                `🔀 All children complete (with failures) for parent ${updatedStep.parentStepId}`,
              );
              // Continue orchestration to handle job-level progress
              await this.orchestrationService.continueJob(dto.jobId);
            }

            return {
              success: true,
              message: childResult.parentComplete
                ? 'Child step failed permanently, parent fan-out complete with failures'
                : 'Child step failed permanently, waiting for siblings',
              jobId: dto.jobId,
              stepId: dto.stepId,
            };
          }
        }
        // If we reach here, retries are exhausted - continue to job status update and orchestration
      }

      // 8. Update job status based on step progress - delegated to continueJob via OrchestrationService

      // 9. Continue orchestration (delegate next step if appropriate)
      this.logger.log(`Triggering orchestration to continue job ${dto.jobId}`);
      const orchestrationResult = await this.orchestrationService.continueJob(dto.jobId);

      if (orchestrationResult.success) {
        if (orchestrationResult.nextStepDelegated) {
          this.logger.log(`Orchestration delegated next step for job ${dto.jobId}`);
        } else if (orchestrationResult.jobComplete) {
          this.logger.log(`Job ${dto.jobId} completed successfully`);
        } else {
          this.logger.debug(`Orchestration: ${orchestrationResult.message}`);
        }
      } else {
        this.logger.error(
          `Orchestration failed for job ${dto.jobId}: ${orchestrationResult.message}`,
        );
      }

      this.logger.log(`Successfully processed callback for step ${dto.stepId}`);

      return {
        success: true,
        message: `Step progress recorded: ${dto.status}`,
        jobId: dto.jobId,
        stepId: dto.stepId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Error processing callback for step ${dto.stepId}: ${errorMessage}`,
        errorStack,
      );

      return {
        success: false,
        message: errorMessage,
        jobId: dto.jobId,
        stepId: dto.stepId,
      };
    }
  }

  /**
   * Update step from callback data with retry tracking
   */
  private async updateStepFromCallback(dto: StepProgressDto): Promise<void> {
    // Fetch current step state
    const step = await this.stepRepository.findById(dto.stepId);
    if (!step) {
      throw new Error(`Step ${dto.stepId} not found`);
    }

    // Build execution attempt record
    const attemptNumber = (step.retryCount || 0) + 1;
    const attempt: ExecutionAttempt = {
      attemptNumber,
      attemptedAt: new Date().toISOString(),
      status: dto.status === StepStatus.COMPLETED ? 'success' : 'failure',
      error: dto.error,
      output: dto.output,
      sqsMessageId: dto.retryMetadata?.sqsMessageId,
      sqsReceiveCount: dto.retryMetadata?.sqsReceiveCount,
      processingTimeMs: dto.retryMetadata?.processingTimeMs,
    };

    // Initialize execution history if not present
    const executionHistory = step.executionHistory || [];
    executionHistory.push(attempt);

    // Log retry information
    const retryInfo = dto.retryMetadata?.isRetry
      ? ` (retry attempt ${dto.retryMetadata.sqsReceiveCount}/${step.maxRetryCount})`
      : '';
    this.logger.log(`Step ${dto.stepId} callback received: ${dto.status}${retryInfo}`);

    switch (dto.status) {
      case StepStatus.IN_PROGRESS:
        // Lambda has started processing
        await this.stepRepository.updateStatus(dto.stepId, StepStatus.IN_PROGRESS);
        this.eventsGateway.broadcast({
          type: 'step_started',
          jobId: dto.jobId,
          step: step.stepValue,
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
        });
        break;

      case StepStatus.COMPLETED: {
        // Lambda has completed successfully
        // Include dataReference in output for next steps to consume
        const output = {
          ...dto.output,
          ...(dto.dataReference && { dataReference: dto.dataReference }),
        };

        await this.stepRepository.updateFromCallback(dto.stepId, {
          status: StepStatus.COMPLETED,
          output,
          recordsProcessed: dto.recordsProcessed,
          recordsFailed: dto.recordsFailed,
          error: null, // Clear error on success (history preserved in executionHistory)
          // Retry tracking
          retryCount: attemptNumber,
          firstAttemptAt: step.firstAttemptAt || step.startedAt,
          lastAttemptAt: new Date(),
          executionHistory,
          sqsMessageId: dto.retryMetadata?.sqsMessageId || step.sqsMessageId,
        });

        if (dto.dataReference) {
          this.logger.log(
            `Step ${dto.stepId} completed with data reference: ${dto.dataReference.type} -> ${dto.dataReference.table || dto.dataReference.batchId}`,
          );
        }

        this.logger.log(
          `Step ${dto.stepId} completed: ${dto.recordsProcessed ?? 0} records processed, ${dto.recordsFailed ?? 0} failed (attempt ${attemptNumber})`,
        );

        this.eventsGateway.broadcast({
          type: 'step_completed',
          jobId: dto.jobId,
          step: step.stepValue,
          duration: step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0,
          timestamp: new Date().toISOString(),
          correlationId: this.correlationService.getCorrelationId(),
        });

        break;
      }

      case StepStatus.FAILED: {
        // Lambda has failed - determine if retries are exhausted
        const retriesExhausted = attemptNumber >= step.maxRetryCount;
        const finalStatus = retriesExhausted ? StepStatus.FAILED : StepStatus.IN_PROGRESS_RETRYING;

        await this.stepRepository.updateFromCallback(dto.stepId, {
          status: finalStatus,
          error: dto.error, // Keep only last error
          recordsProcessed: dto.recordsProcessed,
          recordsFailed: dto.recordsFailed,
          // Retry tracking
          retryCount: attemptNumber,
          firstAttemptAt: step.firstAttemptAt || step.startedAt,
          lastAttemptAt: new Date(),
          executionHistory,
          sqsMessageId: dto.retryMetadata?.sqsMessageId || step.sqsMessageId,
        });

        if (retriesExhausted) {
          this.logger.warn(
            `Step ${dto.stepId} FAILED - retries exhausted (${attemptNumber}/${step.maxRetryCount}). Message will move to DLQ.`,
          );
          this.eventsGateway.broadcast({
            type: 'step_failed',
            jobId: dto.jobId,
            step: step.stepValue,
            error: dto.error || 'Unknown error',
            timestamp: new Date().toISOString(),
            correlationId: this.correlationService.getCorrelationId(),
          });
        } else {
          this.logger.log(
            `Step ${dto.stepId} IN_PROGRESS_RETRYING (attempt ${attemptNumber}/${step.maxRetryCount}): ${dto.error}. SQS will retry.`,
          );
          this.eventsGateway.broadcast({
            type: 'step_retrying',
            jobId: dto.jobId,
            step: step.stepValue,
            attempt: attemptNumber,
            timestamp: new Date().toISOString(),
            correlationId: this.correlationService.getCorrelationId(),
          });
        }
        break;
      }

      default:
        this.logger.warn(`Received unexpected status ${dto.status} for step ${dto.stepId}`);
        break;
    }
  }

  /**
   * Publish output data from a single output step to the appropriate cascade-specific topic.
   * Extracts output from step and sends to workflow.{cascade}.completed
   */
  private async publishTransformedDataEvent(
    jobId: string,
    step: Step,
    wfConfig?: WorkflowConfigService,
  ): Promise<void> {
    try {
      if (!step.output) {
        this.logger.warn(`⚠️  Step ${step.id} has no output data, skipping Kafka publish`);
        return;
      }

      const cfg = wfConfig || this.workflowConfig;
      const cascade = cfg.getCascadeByStep(step.stepValue);
      if (!cascade) {
        this.logger.debug(`Step ${step.stepValue} has no cascade config, skipping Kafka publish`);
        return;
      }

      const outputDataKey = cascade.outputDataKey || 'outputData';
      const transformedData = (step.output[outputDataKey] as Array<Record<string, unknown>>) || [];

      if (!transformedData || transformedData.length === 0) {
        this.logger.warn(
          `⚠️  Step ${step.id} (${cascade.cascadeName}) has no output data array, skipping`,
        );
        return;
      }

      const topicName = cascade.kafkaTopic;
      if (!topicName) {
        this.logger.warn(
          `⚠️  No Kafka topic configured for cascade ${cascade.cascadeName}, skipping publish`,
        );
        return;
      }

      // Fetch job to get test options (includes simulated delays)
      const job = await this.jobRepository.findById(jobId);
      const testOptions = job?.payload?.testOptions;

      // Build generic event with the workflow-specific output data key
      const event = {
        jobId,
        stepId: step.id,
        tableName: cascade.cascadeName,
        recordCount: transformedData.length,
        transformedAt: step.completedAt || new Date(),
        eventTimestamp: new Date(),
        [outputDataKey]: transformedData,
        requiresAcknowledgement: true,
        ...(testOptions && { testOptions }),
      };

      this.logger.log(
        `📤 Publishing transformed ${cascade.cascadeName} data to: ${topicName} (${transformedData.length} records)`,
      );
      this.logger.debug(`Transformed ${cascade.cascadeName} sample:`, transformedData[0]);

      const published = await this.kafkaService.publish(topicName, event, jobId);

      if (published) {
        this.logger.log(
          `✅ Transformed ${cascade.cascadeName} data published to ${topicName} ` +
            `(${transformedData.length} records)`,
        );
      } else {
        this.logger.warn(
          `⚠️  Transformed ${cascade.cascadeName} data not published (Kafka not configured)`,
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to publish transformed data for step ${step.id}: ${errorMessage}`,
        errorStack,
      );
    }
  }

  /**
   * Publish processing failed event to cascade-specific failed topic.
   * Extracts error details from step and sends to workflow.{cascade}.failed
   */
  private async publishTransformationFailedEvent(
    jobId: string,
    step: Step,
    wfConfig?: WorkflowConfigService,
  ): Promise<void> {
    try {
      const cfg = wfConfig || this.workflowConfig;
      const cascade = cfg.getCascadeByStep(step.stepValue);
      if (!cascade) {
        this.logger.debug(`Step ${step.stepValue} has no cascade config, skipping failure publish`);
        return;
      }

      const outputDataKey = cascade.outputDataKey || 'outputData';

      // Count actual failed records from output (if available)
      let recordsFailed = 0;
      if (step.output) {
        const data = step.output[outputDataKey];
        recordsFailed = Array.isArray(data) ? data.length : 0;
      }
      // Fallback to step.recordsFailed if no output
      if (recordsFailed === 0) {
        recordsFailed = step.recordsFailed || 0;
      }

      // Build transformation failed event
      const event: TransformationFailedEvent = {
        jobId,
        stepId: step.id,
        tableName: cascade.cascadeName,
        error: step.error || 'Transformation failed without specific error',
        recordsFailed,
        failedAt: step.completedAt || new Date(),
        eventTimestamp: new Date(),
      };

      // Derive failed topic from completed topic, or use convention
      const topicName = cascade.kafkaTopic
        ? cascade.kafkaTopic.replace('.completed', '.failed')
        : `workflow.${cascade.cascadeName}.failed`;

      this.logger.log(
        `📤 Publishing transformation failure for ${cascade.cascadeName} to: ${topicName}`,
      );

      const published = await this.kafkaService.publish(topicName, event, jobId);

      if (published) {
        this.logger.log(
          `✅ Transformation failure published to ${topicName} ` +
            `(${event.recordsFailed} records failed)`,
        );
      } else {
        this.logger.warn(`⚠️  Transformation failure not published (Kafka not configured)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to publish transformation failure for step ${step.id}: ${errorMessage}`,
        errorStack,
      );
    }
  }

  /**
   * Get the key name for output data in step output based on cascade name.
   * Uses cascade config's outputDataKey, falling back to 'outputData'.
   */
  private getOutputDataKey(cascadeName: string, wfConfig?: WorkflowConfigService): string {
    const cfg = wfConfig || this.workflowConfig;
    const cascade = cfg.getCascade(cascadeName);
    return cascade?.outputDataKey || 'outputData';
  }

  /**
   * Check if a step has any output data to publish to Kafka.
   * Returns false when:
   * - No output
   * - No output data array
   * - Empty output data array (0 records to publish)
   *
   * This is used to skip WAITING_FOR_ACK for steps that have no data to publish,
   * like SubmitOrder when a customer has no orders.
   */
  private hasTransformedDataToPublish(step: Step, wfConfig?: WorkflowConfigService): boolean {
    if (!step.output) {
      return false;
    }

    const cfg = wfConfig || this.workflowConfig;
    const cascade = cfg.getCascadeByStep(step.stepValue);
    if (!cascade) {
      // Unknown step type - assume it has data to be safe
      return true;
    }

    const outputDataKey = cascade.outputDataKey || 'outputData';
    const outputData = step.output[outputDataKey] as Array<Record<string, unknown>> | undefined;

    // Check if there's actually data to publish
    return Array.isArray(outputData) && outputData.length > 0;
  }

  /**
   * Get job status with step details
   * Useful for monitoring and debugging
   *
   * Now includes fan-out pattern information:
   * - isFanOutParent: true if step has child steps
   * - childCount: number of child steps
   * - childrenCompleted/childrenFailed: summary of child status
   * - parentStepId/childItemId: for child steps
   */
  async getJobStatus(jobId: string): Promise<{
    job: {
      id: string;
      type: string;
      status: JobStatus;
      submittedAt: Date;
      startedAt?: Date;
      completedAt?: Date;
    };
    steps: Array<{
      id: string;
      stepNumber: string;
      stepName: string;
      status: StepStatus;
      recordsProcessed: number;
      recordsFailed: number;
      error?: string | null;
      // Fan-out parent fields
      isFanOutParent?: boolean;
      childCount?: number;
      childrenCompleted?: number;
      childrenFailed?: number;
      // Fan-out child fields
      parentStepId?: string;
      childItemId?: string;
      childIndex?: number;
    }>;
  }> {
    const job = await this.jobRepository.findById(jobId, false); // Don't load relations
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const wfConfig = this.getWorkflowConfig(job);
    const steps = await this.stepRepository.findByJobId(jobId);

    // Build child count summaries for parent steps
    const parentChildSummaries = new Map<
      string,
      { completed: number; failed: number; total: number }
    >();
    for (const step of steps) {
      if (step.parentStepId) {
        const current = parentChildSummaries.get(step.parentStepId) || {
          completed: 0,
          failed: 0,
          total: 0,
        };
        current.total++;
        if (step.status === StepStatus.COMPLETED) current.completed++;
        if (step.status === StepStatus.FAILED) current.failed++;
        parentChildSummaries.set(step.parentStepId, current);
      }
    }

    interface StepResponse {
      id: string;
      stepNumber: string;
      stepName: string;
      status: StepStatus;
      recordsProcessed: number;
      recordsFailed: number;
      error?: string | null;
      isFanOutParent?: boolean;
      childCount?: number;
      childrenCompleted?: number;
      childrenFailed?: number;
      parentStepId?: string;
      childItemId?: string;
      childIndex?: number;
    }

    const mappedSteps: StepResponse[] = steps.map((step): StepResponse => {
      const id: string = step.id;

      const stepNumber: string = step.stepValue;

      const stepName: string = wfConfig.getStepName(step.stepValue);

      const status: StepStatus = step.status;

      const recordsProcessed: number = step.recordsProcessed;

      const recordsFailed: number = step.recordsFailed;

      const error = step.error;

      // Fan-out parent information
      const childSummary = parentChildSummaries.get(step.id);
      const isFanOutParent = (step.childCount ?? 0) > 0 || childSummary !== undefined;

      // Fan-out child information
      const isChildStep = step.parentStepId !== undefined && step.parentStepId !== null;

      return {
        id,
        stepNumber,
        stepName,
        status,
        recordsProcessed,
        recordsFailed,
        error,
        // Fan-out parent fields
        ...(isFanOutParent && {
          isFanOutParent: true,
          childCount: step.childCount ?? childSummary?.total ?? 0,
          childrenCompleted: childSummary?.completed ?? 0,
          childrenFailed: childSummary?.failed ?? 0,
        }),
        // Fan-out child fields
        ...(isChildStep && {
          parentStepId: step.parentStepId,
          childItemId: step.childItemId,
          childIndex: step.childIndex,
        }),
      };
    });

    return {
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        submittedAt: job.submittedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
      steps: mappedSteps,
    };
  }

  /**
   * List all recent jobs with basic info
   * Useful for monitoring dashboards and listing active jobs
   */
  async listRecentJobs(limit: number = 10): Promise<{
    jobs: Array<{
      id: string;
      type: string;
      status: JobStatus;
      submittedBy: string;
      submittedAt: Date;
      startedAt: Date | null;
      completedAt: Date | null;
      error: string | null;
    }>;
    total: number;
  }> {
    const jobs = await this.jobRepository.findRecentJobs(limit);

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        submittedBy: job.submittedBy || 'unknown',
        submittedAt: job.submittedAt,
        startedAt: job.startedAt || null,
        completedAt: job.completedAt || null,
        error: job.error || null,
      })),
      total: jobs.length,
    };
  }

  /**
   * HTTP-based acknowledgement for steps in WAITING_FOR_ACK.
   * Used by dynamic workflows (e.g., plan-execution) that don't use Kafka cascade topics.
   */
  async handleHttpAcknowledgement(payload: {
    jobId: string;
    stepId: string;
    action: 'approve' | 'reject';
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; message: string }> {
    const { jobId, stepId, action, metadata } = payload;

    const step = await this.stepRepository.findById(stepId);
    if (!step) {
      return { success: false, message: `Step ${stepId} not found` };
    }

    if (step.status !== StepStatus.WAITING_FOR_ACK) {
      return {
        success: false,
        message: `Step ${stepId} is in ${step.status}, not WAITING_FOR_ACK`,
      };
    }

    if (action === 'approve') {
      await this.stepRepository.updateStatus(stepId, StepStatus.COMPLETED);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      await (this.stepRepository as any)['repo']
        .createQueryBuilder()
        .update()
        .set({
          ackReceivedAt: new Date(),
          ackMetadata: { ...metadata, acknowledgedBy: 'http-ack', action: 'approve' },
        })
        .where('id = :id', { id: stepId })
        .execute();

      this.eventsGateway.broadcast({
        type: 'step_ack_received',
        jobId,
        step: step.stepValue,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`✅ HTTP ACK: Step ${stepId} approved → COMPLETED`);

      // Continue orchestration (next steps in DAG)
      await this.orchestrationService.continueJob(jobId);

      return { success: true, message: 'Step approved and completed' };
    } else {
      // Reject → mark as FAILED
      await this.stepRepository.updateStatus(stepId, StepStatus.FAILED);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      await (this.stepRepository as any)['repo']
        .createQueryBuilder()
        .update()
        .set({
          ackReceivedAt: new Date(),
          ackMetadata: { ...metadata, acknowledgedBy: 'http-ack', action: 'reject' },
          error: 'Rejected by human reviewer',
        })
        .where('id = :id', { id: stepId })
        .execute();

      this.eventsGateway.broadcast({
        type: 'step_failed',
        jobId,
        step: step.stepValue,
        error: 'Rejected by human reviewer',
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`❌ HTTP ACK: Step ${stepId} rejected → FAILED`);

      // Continue orchestration (will skip dependents)
      await this.orchestrationService.continueJob(jobId);

      return { success: true, message: 'Step rejected and failed' };
    }
  }
}
