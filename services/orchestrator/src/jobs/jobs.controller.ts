import { Controller, Get, Param, NotFoundException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { JobRepository, StepRepository, StepStatus } from '@dtm/database';
import { WorkflowConfigService, WorkflowRegistryService } from '../workflow-loader';
import {
  EventStatusResponseDto,
  EventProgressResponseDto,
  JobEventStatus,
} from './dto/event-status.dto';

/**
 * Jobs/Events Controller
 * Handles job event status and progress queries
 *
 * Endpoints:
 * - GET /api/v1/jobs
 * - GET /api/v1/jobs/{jobId}
 * - GET /api/v1/jobs/{jobId}/status
 * - GET /api/v1/jobs/{jobId}/progress
 */
@ApiTags('jobs')
@Controller()
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobRepo: JobRepository,
    private readonly stepRepo: StepRepository,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  /**
   * Resolve the correct WorkflowConfigService for a job (DI-singleton sweep).
   * `this.workflowConfig` is bound to the default workflow at boot; jobs on any
   * other registered workflow must resolve against their OWN config or step
   * names/definitions silently come back wrong/undefined (same anti-pattern
   * class as T1/T2 — see stuck-in-progress.task.ts and callback.service.ts).
   */
  private getWorkflowConfig(job: { workflowName?: string }): WorkflowConfigService {
    if (job.workflowName && this.workflowRegistry.has(job.workflowName)) {
      return this.workflowRegistry.get(job.workflowName);
    }
    return this.workflowConfig;
  }

  /**
   * Get job event status
   * GET /api/v1/jobs/{jobId}/status
   */
  @Get('jobs/:jobId/status')
  @ApiOperation({
    summary: 'Get job event status',
    description: 'Job event telemetry (status summary)',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID (UUID)',
    example: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
  })
  @ApiResponse({
    status: 200,
    description: 'Event status retrieved successfully',
    type: EventStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async getEventStatus(@Param('jobId') jobId: string): Promise<EventStatusResponseDto> {
    this.logger.log(`Fetching status for job: ${jobId}`);

    const job = await this.jobRepo.findById(jobId, false);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Get steps to determine current step
    const steps = await this.stepRepo.findByJobId(jobId);
    const inProgressStep = steps.find(
      (s) => s.status === StepStatus.IN_PROGRESS || s.status === StepStatus.DELEGATED,
    );

    // Map internal status to external status enum
    const statusMap: Record<string, JobEventStatus> = {
      pending: JobEventStatus.PENDING,
      processing: JobEventStatus.IN_PROGRESS,
      completed: JobEventStatus.COMPLETED,
      failed: JobEventStatus.FAILED,
    };

    return {
      jobId: job.id,
      status: statusMap[job.status] || JobEventStatus.PENDING,
      startedAt: job.startedAt?.toISOString() || job.submittedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      currentStep: inProgressStep
        ? this.getWorkflowConfig(job).getStepName(inProgressStep.stepValue)
        : undefined,
    };
  }

  /**
   * Get job event progress
   * GET /api/v1/jobs/{jobId}/progress
   */
  @Get('jobs/:jobId/progress')
  @ApiOperation({
    summary: 'Get job event progress',
    description: 'Detailed job event telemetry with progress tracking',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID (UUID)',
    example: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
  })
  @ApiResponse({
    status: 200,
    description: 'Event progress retrieved successfully',
    type: EventProgressResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Event not found',
  })
  async getEventProgress(@Param('jobId') jobId: string): Promise<EventProgressResponseDto> {
    this.logger.log(`Fetching progress for job: ${jobId}`);

    const job = await this.jobRepo.findById(jobId, false);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    // Get all steps
    const steps = await this.stepRepo.findByJobId(jobId);
    const completedSteps = steps.filter((s) => s.status === StepStatus.COMPLETED);
    const percentComplete =
      steps.length > 0 ? Math.round((completedSteps.length / steps.length) * 100) : 0;

    const inProgressStep = steps.find(
      (s) => s.status === StepStatus.IN_PROGRESS || s.status === StepStatus.DELEGATED,
    );

    // Map status
    const statusMap: Record<string, JobEventStatus> = {
      pending: JobEventStatus.PENDING,
      processing: JobEventStatus.IN_PROGRESS,
      completed: JobEventStatus.COMPLETED,
      failed: JobEventStatus.FAILED,
    };

    return {
      jobId: job.id,
      status: statusMap[job.status] || JobEventStatus.PENDING,
      progress: {
        totalSteps: steps.length,
        completedSteps: completedSteps.length,
        percentComplete,
      },
      startedAt: job.startedAt?.toISOString() || job.submittedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      trackingUrl: `/jobs/${job.id}/status`,
      currentStep: inProgressStep
        ? this.getWorkflowConfig(job).getStepName(inProgressStep.stepValue)
        : undefined,
    };
  }

  /**
   * Get job details by ID
   * GET /api/v1/jobs/{jobId}
   */
  @Get('jobs/:jobId')
  @ApiOperation({
    summary: 'Get job details',
    description: 'Retrieve detailed information about a specific job.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID (UUID)',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Job details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: { type: 'string', example: 'default' },
        status: { type: 'string', example: 'processing' },
        payload: { type: 'object' },
        submittedBy: { type: 'string', example: 'api' },
        submittedAt: { type: 'string', format: 'date-time' },
        startedAt: { type: 'string', format: 'date-time', nullable: true },
        completedAt: { type: 'string', format: 'date-time', nullable: true },
        error: { type: 'string', nullable: true },
        retryCount: { type: 'number', example: 0 },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              stepNumber: { type: 'number', example: 1 },
              stepName: { type: 'string', example: 'ValidateCustomer' },
              description: { type: 'string' },
              status: { type: 'string', example: 'completed' },
              lambdaFunctionName: { type: 'string' },
              sqsMessageId: { type: 'string', nullable: true },
              startedAt: { type: 'string', format: 'date-time', nullable: true },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
              error: { type: 'string', nullable: true },
              recordsProcessed: { type: 'number', example: 0 },
              recordsFailed: { type: 'number', example: 0 },
            },
          },
        },
        result: {
          type: 'object',
          nullable: true,
          properties: {
            totalRecords: { type: 'number' },
            successCount: { type: 'number' },
            failureCount: { type: 'number' },
            skippedCount: { type: 'number' },
            details: { type: 'object' },
            completedAt: { type: 'string', format: 'date-time' },
            durationMs: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
  })
  async getJobDetails(@Param('jobId') jobId: string) {
    // Fetch job with relations
    const job = await this.jobRepo.findById(jobId, true);

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    // Fetch steps separately to have more control
    const steps = await this.stepRepo.findByJobId(jobId);
    const wfConfig = this.getWorkflowConfig(job);

    // Build response
    return {
      id: job.id,
      type: job.type,
      workflowName: job.workflowName,
      status: job.status,
      payload: job.payload,
      submittedBy: job.submittedBy || 'unknown',
      submittedAt: job.submittedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      steps: steps.map((step) => ({
        id: step.id,
        stepNumber: step.stepValue, // Return stepValue as stepNumber for API compatibility

        stepName: wfConfig.getStepName(step.stepValue), // Derive stepName from stepValue (per-job workflow, DI-singleton sweep)
        description: step.description,
        status: step.status,
        lambdaFunctionName: step.lambdaFunctionName,
        sqsMessageId: step.sqsMessageId,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        error: step.error,
        recordsProcessed: step.recordsProcessed,
        recordsFailed: step.recordsFailed,
        retryCount: step.retryCount,
        maxRetryCount: step.maxRetryCount,
        kafkaPublishedAt: step.kafkaPublishedAt,
        ackReceivedAt: step.ackReceivedAt,
        ackMetadata: step.ackMetadata,
        // Fan-out pattern fields
        parentStepId: step.parentStepId || null,
        childIndex: step.childIndex ?? null,
        childItemId: step.childItemId || null,
        childCount: step.childCount ?? null,
      })),
      result: job.results
        ? {
            totalRecords: job.results.totalRecordsProcessed,
            successCount: job.results.totalRecordsProcessed,
            failureCount: job.results.totalRecordsFailed,
            skippedCount: 0, // No longer tracked separately
            stepsCompleted: job.results.stepsCompleted,
            stepsFailed: job.results.stepsFailed,
            stepsAborted: job.results.stepsAborted,
            completedAt: job.results.completedAt,
            durationMs: job.results.durationMs,
          }
        : null,
    };
  }

  /**
   * List all jobs
   * GET /api/v1/jobs
   */
  @Get('jobs')
  @ApiOperation({
    summary: 'List all jobs',
    description: 'Retrieve a list of all jobs (most recent first)',
  })
  @ApiResponse({
    status: 200,
    description: 'Jobs list retrieved successfully',
  })
  async listJobs() {
    const jobs = await this.jobRepo.findRecentJobs(50);

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        type: job.type,
        workflowName: job.workflowName,
        status: job.status,
        submittedBy: job.submittedBy || 'unknown',
        submittedAt: job.submittedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      })),
      total: jobs.length,
    };
  }
}
