import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JobRepository } from '@dtm/database';
import {
  InitiateWorkflowJobDto,
  InitiateWorkflowJobResponseDto,
} from './dto/initiate-workflow-job.dto';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { DeduplicationService } from '../common/deduplication.service';
import { WorkflowRegistryService } from '../workflow-loader';

/**
 * Workflow Job Service
 *
 * The workflow-agnostic job-submission logic behind `POST
 * /workflows/:workflowName/jobs`. Extracted out of {@link WorkflowController}
 * (which is now a thin HTTP wrapper around this service) so it can be reused
 * by non-HTTP callers with zero behavioral drift — e.g. the Setpoint Evals
 * "run" endpoint (`EvalsRunService`), which re-issues a server-parsed README
 * Payload through the exact same validation/dedup/orchestration path a real
 * HTTP POST would take, via ordinary constructor injection rather than an
 * HTTP self-call.
 *
 * Flow:
 * 1. Validate workflowName exists in registry and is enabled
 * 2. Resolve variant (explicit or default)
 * 3. Check for duplicate jobs (if deduplication enabled)
 * 4. Create job in database with workflowName
 * 5. Start orchestration (create steps, delegate first batch)
 * 6. Return jobId + resolved metadata
 */
@Injectable()
export class WorkflowJobService {
  private readonly logger = new Logger(WorkflowJobService.name);

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly orchestrationService: OrchestrationService,
    private readonly deduplicationService: DeduplicationService,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  async initiateWorkflowJob(
    workflowName: string,
    dto: InitiateWorkflowJobDto,
  ): Promise<InitiateWorkflowJobResponseDto> {
    this.logger.log(
      `Initiating workflow job: workflow=${workflowName}` +
        (dto.variant ? `, variant=${dto.variant}` : ''),
    );

    // 1. Validate workflow exists in registry
    if (!this.workflowRegistry.has(workflowName)) {
      const available = this.workflowRegistry
        .getWorkflowSummaries()
        .map((w) => w.name)
        .join(', ');
      throw new NotFoundException(
        `Workflow '${workflowName}' not found. Available workflows: [${available}]`,
      );
    }

    // 2. Check if workflow is enabled
    if (!this.workflowRegistry.isEnabled(workflowName)) {
      throw new ForbiddenException(
        `Workflow '${workflowName}' is currently disabled and not accepting new jobs.`,
      );
    }

    // 3. Resolve variant
    const wfConfig = this.workflowRegistry.get(workflowName);
    const workflow = wfConfig.getWorkflow();
    let variant = dto.variant;

    if (!variant) {
      // Use default variant
      variant = this.workflowRegistry.getDefaultVariant(workflowName);
      if (!variant) {
        throw new BadRequestException(
          `Workflow '${workflowName}' has no default variant. Specify a variant explicitly.`,
        );
      }
      this.logger.log(`Using default variant '${variant}' for workflow '${workflowName}'`);
    }

    // Validate variant exists in the workflow
    if (!workflow.variants[variant]) {
      const availableVariants = Object.keys(workflow.variants).join(', ');
      throw new BadRequestException(
        `Variant '${variant}' not found in workflow '${workflowName}'. ` +
          `Available variants: [${availableVariants}]`,
      );
    }

    // 4. Debug logging for test options
    if (dto.testOptions) {
      this.logger.log(`Received test options: ${JSON.stringify(dto.testOptions)}`);
    }

    // 5. Check for duplicate job (if deduplication is enabled)
    const deduplicationKey =
      dto.deduplicationKey || (dto.payload ? JSON.stringify(dto.payload) : undefined);

    if (deduplicationKey) {
      const existingJob = await this.deduplicationService.findExistingJob(
        deduplicationKey,
        dto.submittedBy || 'api',
        undefined, // No additional context for generic endpoint
        dto.enableDeduplication,
      );

      if (existingJob) {
        this.logger.log(
          `Duplicate job detected for workflow '${workflowName}'. ` +
            `Existing job: ${existingJob.id} (status: ${existingJob.status})`,
        );
        throw new ConflictException({
          message: `Duplicate job detected for workflow '${workflowName}' today`,
          existingJobId: existingJob.id,
          status: existingJob.status,
          submittedAt: existingJob.submittedAt,
        });
      }
    }

    // 6. Build job payload
    const jobPayload = {
      ...(dto.payload || {}),
      testOptions: dto.testOptions,
      featureFlags: dto.featureFlags,
      ...(dto.deduplicationKey ? { deduplicationKey: dto.deduplicationKey } : {}),
      metadata: {
        ...((dto.payload?.metadata as Record<string, unknown>) || {}),
        submittedVia: 'generic-workflow-endpoint',
      },
    };

    // 7. Create job in database with workflowName
    const job = await this.jobRepo.createJob({
      workflowName,
      type: variant,
      payload: jobPayload,
      submittedBy: dto.submittedBy || 'api',
    });

    this.logger.log(
      `Workflow job created: ${job.id} (workflow=${workflowName}, variant=${variant})`,
    );

    // 8. Start orchestration (create steps and delegate first batch)
    const orchestrationResult = await this.orchestrationService.startJob(job.id);

    if (!orchestrationResult.success) {
      this.logger.error(
        `Failed to start orchestration for job ${job.id}: ${orchestrationResult.message}`,
      );
      throw new BadRequestException(`Failed to start workflow job: ${orchestrationResult.message}`);
    }

    this.logger.log(
      `Orchestration started for job ${job.id}. ` +
        `Steps created: ${orchestrationResult.stepsCreated}, ` +
        `first step delegated: ${orchestrationResult.firstStepDelegated}`,
    );

    return {
      jobId: job.id,
      workflowName,
      variant,
    };
  }
}
