import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IMessageHandler } from '@dtm/kafka-consumer';
import { EachMessagePayload } from 'kafkajs';
import { StepRepository, StepStatus } from '@dtm/database';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import { CascadePublishService } from '../../orchestration/cascade-publish.service';
import { FanOutService } from '../../orchestration/fan-out.service';
import { CorrelationService } from '../../common/correlation/correlation.service';
import { WorkflowRegistryService, WorkflowConfigService } from '../../workflow-loader';
import { EventsGateway } from '../../websocket/events.gateway';

/**
 * Interface for acknowledgement messages
 *
 * Any fields beyond jobId/stepId/acknowledgedAt/metadata are stored verbatim in ackMetadata,
 * where workflow-owned fkExtractor/childFkExtractor functions can read them.
 */
interface AcknowledgementMessage {
  jobId: string;
  stepId: string;
  acknowledgedAt?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Acknowledgement Handler
 *
 * Key Features:
 * 1. ✅ Validates message structure (throws for poison pills)
 * 2. ❌ NEVER throws for business logic errors
 * 3. ✅ Distinguishes between transient and permanent errors
 * 4. ✅ Returns early for duplicate acknowledgements
 * 5. ✅ Comprehensive structured logging
 *
 * Handles acknowledgement messages from external systems confirming
 * receipt and processing of transformed job data.
 *
 * When an acknowledgement is received:
 * 1. Updates step status from WAITING_FOR_ACK to COMPLETED
 * 2. Records acknowledgement metadata
 * 3. Continues orchestration to process next steps
 *
 * Topics consumed:
 * - Dynamically resolved from WorkflowRegistryService.getAllAckTopics()
 * - Each registered workflow contributes its cascade ACK topics
 */
@Injectable()
export class AcknowledgementHandler implements OnModuleInit, IMessageHandler {
  private readonly logger = new Logger(AcknowledgementHandler.name);

  constructor(
    private readonly stepRepository: StepRepository,
    private readonly orchestrationService: OrchestrationService,
    private readonly cascadePublishService: CascadePublishService,
    private readonly fanOutService: FanOutService,
    private readonly correlationService: CorrelationService,
    private readonly workflowRegistry: WorkflowRegistryService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  onModuleInit() {
    this.logger.log('✅ AcknowledgementHandler initialized');
  }

  /**
   * Main message handler (required by IMessageHandler interface)
   */
  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const topic = payload.topic;
    const messageValue = payload.message.value?.toString();

    // Validation: Check if message has value
    if (!messageValue) {
      this.logger.error('❌ Received empty acknowledgement message', {
        topic,
        offset: payload.message.offset,
      });
      // Throw to send to DLQ - empty message is a poison pill
      throw new Error('Acknowledgement message value is null');
    }

    let message: AcknowledgementMessage;

    // Parse JSON safely
    try {
      message = JSON.parse(messageValue) as AcknowledgementMessage;
    } catch (parseError) {
      this.logger.error('❌ Failed to parse acknowledgement message JSON', {
        error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
        topic,
        offset: payload.message.offset,
        rawValue: messageValue.substring(0, 200),
      });
      // Throw to send to DLQ - invalid JSON is a poison pill
      throw new Error(
        `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown'}`,
      );
    }

    // Use jobId as correlation ID if available
    const correlationId = message.jobId;

    await this.correlationService.runWithCorrelationId(async () => {
      // Route to appropriate handler based on topic — dynamic resolution via WorkflowRegistryService
      try {
        const resolved = this.workflowRegistry.getByAckTopic(topic);
        if (!resolved) {
          this.logger.warn(`⚠️  Unknown acknowledgement topic: ${topic}`, {
            offset: payload.message.offset,
          });
          // Return early - not a poison pill, just unexpected topic
          return;
        }

        const cascadeName = resolved.cascadeName;
        await this.processAcknowledgement(message, cascadeName, resolved.config);
      } catch (processingError) {
        // Business logic errors - don't throw, just log
        this.logger.error(`❌ Failed to process acknowledgement (business logic error)`, {
          error: processingError instanceof Error ? processingError.message : 'Unknown error',
          stack: processingError instanceof Error ? processingError.stack : undefined,
          topic,
          jobId: message.jobId,
          stepId: message.stepId,
        });

        // IMPORTANT: Do NOT throw here
        // Acknowledgement failures are often permanent (step already completed, job not found)
        // Sending these to DLQ would just fill it with non-actionable messages
        // Instead, we log and move on
        return;
      }
    }, correlationId);
  }

  /**
   * Process acknowledgement message
   *
   * 1. Updates step status from WAITING_FOR_ACK to COMPLETED
   * 2. Stores ACK metadata in step (used by workflow-owned fkExtractor for FK injection)
   * 3. Triggers cascade publishing for dependent dependent cascades
   * 4. Continues orchestration for workflow dependencies
   */
  private async processAcknowledgement(
    message: AcknowledgementMessage,
    cascadeName: string,
    wfConfig: WorkflowConfigService,
  ): Promise<void> {
    const { jobId, stepId, acknowledgedAt, metadata, ...customPayload } = message;

    // Validate required fields
    if (!jobId || !stepId) {
      this.logger.error(
        `❌ Invalid acknowledgement message for ${cascadeName}: missing jobId or stepId`,
        {
          hasJobId: !!jobId,
          hasStepId: !!stepId,
          message,
        },
      );
      // Throw to send to DLQ - missing required fields is a poison pill
      throw new Error('Missing required fields: jobId or stepId');
    }

    this.logger.log(`📥 Received ${cascadeName} acknowledgement for step ${stepId} (job ${jobId})`);

    // Verify step exists and is in WAITING_FOR_ACK status
    const step = await this.stepRepository.findById(stepId);
    if (!step) {
      this.logger.error(`❌ Step ${stepId} not found for ${cascadeName} acknowledgement`, {
        jobId,
        stepId,
        cascadeName,
      });
      // Don't throw - step not found is a permanent error
      return;
    }

    if (step.status !== StepStatus.WAITING_FOR_ACK) {
      this.logger.warn(
        `⚠️  Step ${stepId} is in ${step.status} status, not WAITING_FOR_ACK. Ignoring duplicate ack.`,
        {
          jobId,
          stepId,
          currentStatus: step.status,
          cascadeName,
        },
      );
      // Don't throw - duplicate acknowledgement is expected behavior
      return;
    }

    try {
      // Update step status from WAITING_FOR_ACK to COMPLETED
      await this.stepRepository.updateStatus(stepId, StepStatus.COMPLETED);

      // Build acknowledgement metadata
      const ackMetadata = {
        ...(metadata || {}),
        ...customPayload,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        acknowledgedBy: (metadata as any)?.acknowledgedBy || 'external-system',
        cascadeName,
      };

      // Use targeted UPDATE to avoid overwriting the output field
      // (which may have been updated in parallel with FK-enriched data)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      await (this.stepRepository as any)['repo']
        .createQueryBuilder()
        .update()
        .set({
          ackReceivedAt: acknowledgedAt ? new Date(acknowledgedAt) : new Date(),
          ackMetadata: ackMetadata,
        })
        .where('id = :id', { id: stepId })
        .execute();

      this.logger.log(`✅ Step ${stepId} acknowledgement processed - status updated to COMPLETED`);

      this.eventsGateway.broadcast({
        type: 'step_ack_received',
        jobId,
        step: step.stepValue,
        timestamp: new Date().toISOString(),
        correlationId: this.correlationService.getCorrelationId(),
      });
    } catch (updateError) {
      this.logger.error(`❌ Failed to update step ${stepId} status`, {
        error: updateError instanceof Error ? updateError.message : 'Unknown error',
        stack: updateError instanceof Error ? updateError.stack : undefined,
        jobId,
        stepId,
        cascadeName,
      });
      // This is a database error - could be transient
      // Throw to retry via DLQ
      throw new Error(
        `Database update failed for step ${stepId}: ${updateError instanceof Error ? updateError.message : 'Unknown'}`,
      );
    }

    // Check if any dependent cascades can now be published now that this parent has been ACKed
    if (this.cascadePublishService.hasDependentCascades(cascadeName, wfConfig)) {
      this.logger.log(`🔗 Checking for cascade publishing after ${cascadeName} ACK...`);

      try {
        const cascadeResult =
          await this.cascadePublishService.checkAndExecutePendingPublishSteps(jobId);

        if (cascadeResult.publishedSteps > 0) {
          this.logger.log(
            `🎉 Cascade publishing: ${cascadeResult.publishedSteps} dependent cascades published`,
          );
          for (const detail of cascadeResult.details) {
            this.logger.log(
              `  📤 ${detail.cascadeName}: ${detail.stepValue} with FK injections: ${JSON.stringify(detail.fkInjections)}`,
            );
          }
        } else {
          this.logger.debug(`No pending dependent cascades to publish after ${cascadeName} ACK`);
        }
      } catch (cascadeError) {
        this.logger.error(`❌ Cascade publishing failed for job ${jobId}`, {
          error: cascadeError instanceof Error ? cascadeError.message : 'Unknown error',
          stack: cascadeError instanceof Error ? cascadeError.stack : undefined,
          jobId,
          cascadeName,
        });
        // Don't throw - cascade error shouldn't block acknowledgement processing
      }
    }

    // Check if this step is a child step that needs fan-out completion check
    // This is important: when ACK arrives, all siblings might now be complete
    const updatedStepForFanOut = await this.stepRepository.findById(stepId);
    if (updatedStepForFanOut?.parentStepId) {
      this.logger.log(
        `🔀 Child step ${stepId} received ACK - checking fan-out completion for parent ${updatedStepForFanOut.parentStepId}`,
      );
      try {
        // Pass jobId explicitly since job relation may not be loaded
        await this.fanOutService.handleChildStepComplete(updatedStepForFanOut, jobId);
      } catch (fanOutError) {
        this.logger.error(`❌ Fan-out completion check failed for step ${stepId}`, {
          error: fanOutError instanceof Error ? fanOutError.message : 'Unknown error',
          stack: fanOutError instanceof Error ? fanOutError.stack : undefined,
          jobId,
          stepId,
          parentStepId: updatedStepForFanOut.parentStepId,
        });
        // Don't throw - fan-out error shouldn't block the job
      }
    }

    // Continue orchestration to process next workflow steps
    this.logger.log(`🔄 Continuing orchestration for job ${jobId}`);

    try {
      const result = await this.orchestrationService.continueJob(jobId);

      if (result.success) {
        if (result.nextStepDelegated) {
          this.logger.log(`✅ Next step delegated for job ${jobId}`);
        } else if (result.jobComplete) {
          this.logger.log(`🎉 Job ${jobId} completed after ${cascadeName} acknowledgement`);
        } else {
          this.logger.debug(`Orchestration result: ${result.message}`);
        }
      } else {
        this.logger.error(`❌ Orchestration failed for job ${jobId}: ${result.message}`, {
          jobId,
          stepId,
          cascadeName,
          result,
        });
      }
    } catch (orchestrationError) {
      this.logger.error(`❌ Exception during orchestration for job ${jobId}`, {
        error: orchestrationError instanceof Error ? orchestrationError.message : 'Unknown error',
        stack: orchestrationError instanceof Error ? orchestrationError.stack : undefined,
        jobId,
        stepId,
        cascadeName,
      });
      // Don't throw - acknowledgement was successful
    }
  }
}
