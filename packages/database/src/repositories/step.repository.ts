import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Step, StepStatus } from "../entities/step.entity";

/**
 * DTO for creating steps
 * stepValue: The enum string value (e.g., 'ValidateCustomer', 'SubmitOrder') representing the step
 */
export interface CreateStepDto {
  jobId: string;
  stepValue: string;
  description: string;
  input?: Record<string, unknown>;
  lambdaFunctionName?: string;
  // Fan-out pattern fields
  parentStepId?: string;
  childIndex?: number;
  childItemId?: string;
}

/**
 * DTO for updating step from Lambda callback
 */
export interface UpdateStepFromCallbackDto {
  status: StepStatus;
  output?: Record<string, unknown>;
  error?: string | null; // Allow null to explicitly clear errors on success
  recordsProcessed?: number;
  recordsFailed?: number;
  // Retry tracking fields
  retryCount?: number;
  firstAttemptAt?: Date;
  lastAttemptAt?: Date;
  executionHistory?: import("../entities/step.entity").ExecutionAttempt[];
  sqsMessageId?: string;
}

/**
 * Repository for managing job steps
 * Each step represents a unit of work that can be delegated to Lambda or executed internally
 */
@Injectable()
export class StepRepository {
  constructor(
    @InjectRepository(Step)
    private readonly repo: Repository<Step>,
  ) {}

  /**
   * Create a new step
   */
  async createStep(dto: CreateStepDto): Promise<Step> {
    const { jobId, ...rest } = dto;
    const step = this.repo.create({
      ...rest,
      job: { id: jobId },
      status: StepStatus.PENDING,
      startedAt: new Date(),
    } as Partial<Step>);
    return this.repo.save(step);
  }

  /**
   * Create multiple steps for a job
   * Supports fan-out pattern fields (parentStepId, childIndex, childItemId)
   */
  async createSteps(steps: CreateStepDto[]): Promise<Step[]> {
    const entities = steps.map((dto) => {
      const { jobId, parentStepId, childIndex, childItemId, ...rest } = dto;
      return this.repo.create({
        ...rest,
        job: { id: jobId },
        status: StepStatus.PENDING,
        startedAt: new Date(),
        // Fan-out pattern fields
        parentStepId,
        childIndex,
        childItemId,
      } as Partial<Step>);
    });
    return this.repo.save(entities);
  }

  /**
   * Find steps for a job (ordered by stepValue)
   */
  async findByJobId(jobId: string): Promise<Step[]> {
    return this.repo.find({
      where: { job: { id: jobId } },
      order: { stepValue: "ASC" },
    });
  }

  /**
   * Find a step by ID
   */
  async findById(id: string, relations: string[] = []): Promise<Step | null> {
    return this.repo.findOne({ where: { id }, relations });
  }

  /**
   * Find all child steps for a parent step (fan-out pattern)
   * Returns steps ordered by childIndex for consistent ordering
   */
  async findByParentId(parentStepId: string): Promise<Step[]> {
    return this.repo.find({
      where: { parentStepId },
      order: { childIndex: "ASC" },
    });
  }

  /**
   * Generic update method for step fields
   * Used for fan-out pattern to update childCount, etc.
   */
  async update(id: string, data: Partial<Step>): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, data as any);
  }

  /**
   * Find next pending step for a job (lowest stepValue)
   */
  async findNextPendingStep(jobId: string): Promise<Step | null> {
    return this.repo.findOne({
      where: {
        job: { id: jobId },
        status: StepStatus.PENDING,
      },
      order: { stepValue: "ASC" },
    });
  }

  /**
   * Update step status
   */
  async updateStatus(
    id: string,
    status: StepStatus,
    error?: string,
  ): Promise<void> {
    const updateData: Partial<Step> = { status };

    if (
      status === StepStatus.COMPLETED ||
      status === StepStatus.FAILED ||
      status === StepStatus.SKIPPED ||
      status === StepStatus.PARTIAL_SUCCESS
    ) {
      const now = new Date();
      updateData.completedAt = now;

      // Calculate duration from step start to completion
      const step = await this.repo.findOne({ where: { id } });
      if (step?.startedAt) {
        updateData.durationMs = now.getTime() - step.startedAt.getTime();
      }
    }

    if (error) {
      updateData.error = error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, updateData as any);
  }

  /**
   * Update step from Lambda callback
   * This is the primary method Lambda workers use to report progress
   * Now includes retry tracking support
   */
  async updateFromCallback(
    id: string,
    dto: UpdateStepFromCallbackDto,
  ): Promise<void> {
    // Fetch current step for duration calc AND terminal-state guard
    const currentStep = await this.repo.findOne({ where: { id } });
    if (!currentStep) return;

    // Defense-in-depth: reject updates for steps already in terminal state
    // Primary guard is in CallbackService.handleStepProgress()
    const TERMINAL_STATUSES: ReadonlySet<StepStatus> = new Set([
      StepStatus.COMPLETED,
      StepStatus.WAITING_FOR_ACK,
      StepStatus.FAILED,
      StepStatus.SKIPPED,
      StepStatus.PARTIAL_SUCCESS,
    ]);
    if (TERMINAL_STATUSES.has(currentStep.status)) {
      return;
    }

    const updateData: Partial<Step> = {
      status: dto.status,
      output: dto.output,
      error: dto.error,
      recordsProcessed: dto.recordsProcessed ?? 0,
      recordsFailed: dto.recordsFailed ?? 0,
      // Retry tracking
      retryCount: dto.retryCount,
      firstAttemptAt: dto.firstAttemptAt,
      lastAttemptAt: dto.lastAttemptAt,
      executionHistory: dto.executionHistory,
      sqsMessageId: dto.sqsMessageId,
    };

    if (
      dto.status === StepStatus.COMPLETED ||
      dto.status === StepStatus.FAILED ||
      dto.status === StepStatus.PARTIAL_SUCCESS
    ) {
      const now = new Date();
      updateData.completedAt = now;

      if (currentStep.startedAt) {
        updateData.durationMs = now.getTime() - currentStep.startedAt.getTime();
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, updateData as any);
  }

  /**
   * Atomically claim a step for delegation.
   * Uses WHERE status = 'pending' to prevent double-delegation when concurrent
   * continueJob calls race to delegate the same step.
   *
   * @returns true if this caller won the claim, false if already claimed
   */
  async claimForDelegation(id: string): Promise<boolean> {
    const result = await this.repo.update(
      { id, status: StepStatus.PENDING },
      { status: StepStatus.DELEGATED },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Mark step as delegated to Lambda (set SQS message ID)
   */
  async markAsDelegated(id: string, sqsMessageId: string): Promise<void> {
    await this.repo.update(id, {
      status: StepStatus.DELEGATED,
      sqsMessageId,
    });
  }

  /**
   * Update step progress (incremental updates during processing)
   */
  async updateProgress(
    id: string,
    recordsProcessed: number,
    recordsFailed: number,
  ): Promise<void> {
    await this.repo.update(id, {
      recordsProcessed,
      recordsFailed,
    });
  }

  /**
   * Increment processed records
   */
  async incrementProcessed(id: string, count: number = 1): Promise<void> {
    await this.repo.increment({ id }, "recordsProcessed", count);
  }

  /**
   * Increment failed records
   */
  async incrementFailed(id: string, count: number = 1): Promise<void> {
    await this.repo.increment({ id }, "recordsFailed", count);
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(id: string): Promise<void> {
    await this.repo.increment({ id }, "retryCount", 1);
  }

  /**
   * Get statistics for all steps in a job
   */
  async getJobStatistics(jobId: string): Promise<{
    totalSteps: number;
    completed: number;
    failed: number;
    pending: number;
    inProgress: number;
  }> {
    const steps = await this.findByJobId(jobId);

    const completed = steps.filter(
      (s) => s.status === StepStatus.COMPLETED,
    ).length;
    const failed = steps.filter((s) => s.status === StepStatus.FAILED).length;
    const pending = steps.filter((s) => s.status === StepStatus.PENDING).length;
    const inProgress = steps.filter(
      (s) => s.status === StepStatus.IN_PROGRESS,
    ).length;

    return {
      totalSteps: steps.length,
      completed,
      failed,
      pending,
      inProgress,
    };
  }
}
