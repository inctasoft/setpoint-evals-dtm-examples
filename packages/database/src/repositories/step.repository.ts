import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Not, Repository } from "typeorm";
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
   *
   * NOTE: for a discovery step whose `childStepChain` has length > 1 (e.g.
   * order-processing's DiscoverLineItems -> [ValidateLineItem, SubmitLineItem],
   * or iot-sensor-pipeline's DiscoverSensors -> [CalibrateSensor, ActivateSensor,
   * DiscoverReadings, ComputeAggregate, PublishAggregate] — see
   * FanOutService.delegateNextChildChainStep()'s "Same parent" chaining), this
   * returns ONE ROW PER CHAIN STEP PER ITEM, not one row per item — i.e. it is the
   * full parent-scoped row set, used internally for completion bookkeeping
   * (checkChildrenCompletion, buildFkMapFromSuccessfulChildren) where every chain
   * row matters. Callers that want one representative row per fan-out ITEM
   * (e.g. the /activity drill-down's fanOut.children rollup) must use
   * findImmediateFanOutChildren() instead — using this method there over-counts
   * by the chain length (dtm-video-v2 Lane B.1 follow-up, PR #36 body: the DAG
   * badge reporting "18/3" instead of "3/3").
   */
  async findByParentId(parentStepId: string): Promise<Step[]> {
    return this.repo.find({
      where: { parentStepId },
      order: { childIndex: "ASC" },
    });
  }

  /**
   * Find one representative row per fan-out ITEM under a parent step — the
   * "immediate fan-out branch" (dtm-video-v2 Lane B.1 follow-up, PR #36 body).
   *
   * A discovery step's children are NOT one row per item: when the step's
   * `childStepChain` has length > 1, every chain step for a given item shares
   * the SAME parent_step_id (FanOutService.delegateNextChildChainStep() sets
   * `parentStepId: completedChildStep.parentStepId // Same parent`), so
   * findByParentId() returns childCount * chainLength rows. This method
   * collapses that to exactly one row per distinct child_item_id — the row with
   * the latest started_at, i.e. the item's current/most-advanced chain step —
   * via Postgres `DISTINCT ON`. Ordered by childIndex/childItemId afterward for
   * stable, deterministic output (DISTINCT ON's own ordering is dictated by the
   * distinct column, not display order).
   *
   * Nested descendants (e.g. a DiscoverReadings INSTANCE's own IngestReading/
   * PublishReading children) are never included — those rows have
   * parent_step_id pointing at the DiscoverReadings instance's id, not at this
   * step's id, so they were already out of scope before this method existed.
   */
  async findImmediateFanOutChildren(parentStepId: string): Promise<Step[]> {
    const rows = await this.repo
      .createQueryBuilder("step")
      .distinctOn(["step.childItemId"])
      .where("step.parentStepId = :parentStepId", { parentStepId })
      .orderBy("step.childItemId", "ASC")
      .addOrderBy("step.startedAt", "DESC")
      .getMany();
    return rows.sort((a, b) => (a.childIndex ?? 0) - (b.childIndex ?? 0));
  }

  /**
   * Find the "primary" (non-fan-out-child) row for a step name within a job — the
   * resolution the /activity drill-down endpoint uses (dtm-video-v2 capability-spec.md
   * §3.2a). Fan-out CHILD instances (parentStepId IS NOT NULL) are deliberately
   * excluded: a step name that exists ONLY as multiple child rows sharing one parent
   * (e.g. order-processing's ValidateLineItem, one row per discovered line item) has
   * no single "primary" activity record to report — the caller 404s in that case
   * rather than arbitrarily picking one child row. A discovery/parent step itself
   * (e.g. DiscoverLineItems) always has parentStepId IS NULL and resolves here.
   */
  async findPrimaryByJobIdAndStepValue(
    jobId: string,
    stepValue: string,
  ): Promise<Step | null> {
    return this.repo.findOne({
      where: { job: { id: jobId }, stepValue, parentStepId: IsNull() },
    });
  }

  /**
   * Find every fan-out CHILD row for a step name within a job — the fallback the
   * /activity drill-down endpoint uses when findPrimaryByJobIdAndStepValue comes up
   * empty (dtm-video-v2 capability-spec.md §3.2a follow-up). Some workflows (e.g.
   * iot-sensor-pipeline's double fan-out) have step names that exist ONLY as fan-out
   * children — every row for that step_value has parent_step_id IS NOT NULL, so there
   * is no single "primary" row to report. Ordered by childIndex for a stable,
   * deterministic instance list (note: multiple child rows CAN share a childIndex
   * under double fan-out — e.g. DiscoverReadings runs once per sensor, each yielding
   * its own row at index 0/1/2 — childItemId, not childIndex alone, is what makes a
   * row unique here).
   */
  async findChildInstancesByJobIdAndStepValue(
    jobId: string,
    stepValue: string,
  ): Promise<Step[]> {
    return this.repo.find({
      where: { job: { id: jobId }, stepValue, parentStepId: Not(IsNull()) },
      order: { childIndex: "ASC" },
    });
  }

  /**
   * Find an existing chain-step row for one fan-out branch — (parentStepId,
   * childItemId, stepValue) uniquely identifies "the next chain step for THIS
   * item under THIS discovery parent". Used by FanOutService.delegateNextChildChainStep()
   * as an idempotency guard: that method previously created a fresh row
   * unconditionally on every call, so any duplicate invocation (redelivered ACK,
   * maintenance-task re-evaluation of an already-terminal child) created a second
   * full fan-out branch (dtm-video-v2 Lane B.1 double-emission).
   */
  async findChainStepByParentChildAndValue(
    parentStepId: string,
    childItemId: string | null | undefined,
    stepValue: string,
  ): Promise<Step | null> {
    return this.repo.findOne({
      where: { parentStepId, childItemId: childItemId ?? IsNull(), stepValue },
    });
  }

  /**
   * Batch-fetch steps by id — used to resolve each fan-out child instance's
   * immediate parent row (for the instance-aggregate response's `parentStep` field)
   * without an N+1 query per child.
   */
  async findByIds(ids: string[]): Promise<Step[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.repo.find({ where: { id: In(ids) } });
  }

  /**
   * Cross-job history for a step name within a workflow — powers the drill-down
   * drawer's "recent runs of this step" sparkline/table (dtm-video-v2
   * capability-spec.md §3.2b). Joins through dtm_jobs.workflow_name for isolation: a
   * step_value-only filter would leak rows from a DIFFERENT workflow that happens to
   * reuse the same step name. Only "primary" (non-fan-out-child) rows — same
   * restriction as findPrimaryByJobIdAndStepValue, for the same reason (one row per
   * job, not N per fan-out item).
   */
  async findCrossJobHistory(
    workflowName: string,
    stepValue: string,
    limit: number,
  ): Promise<Step[]> {
    return this.repo
      .createQueryBuilder("step")
      .innerJoinAndSelect("step.job", "job")
      .where("job.workflowName = :workflowName", { workflowName })
      .andWhere("step.stepValue = :stepValue", { stepValue })
      .andWhere("step.parentStepId IS NULL")
      .orderBy("job.submittedAt", "DESC")
      .take(limit)
      .getMany();
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
   * Atomically claim a step's Kafka ACK completion.
   * Uses WHERE status = 'waiting_for_ack' — the same claim-row pattern as
   * claimForDelegation() above — to close the TOCTOU window in
   * AcknowledgementHandler.processAcknowledgement(): a plain read-then-write
   * (fetch step, check status, then unconditionally update) lets two deliveries
   * of the same redelivered ACK both pass the status check before either write
   * commits, so both proceed into handleChildStepComplete() ->
   * delegateNextChildChainStep(), creating a duplicate next-chain-step row per
   * delivery (dtm-video-v2 Lane B.1 double-emission: iot-sensor-pipeline
   * DiscoverReadings/IngestReading/PublishReading rows doubled per sensor).
   *
   * @returns true if this caller won the claim (proceed with post-ACK side
   *   effects), false if the step was already COMPLETED/claimed by a
   *   concurrent delivery (treat as a no-op duplicate ACK).
   */
  async claimAckCompletion(id: string): Promise<boolean> {
    const result = await this.repo.update(
      { id, status: StepStatus.WAITING_FOR_ACK },
      { status: StepStatus.COMPLETED },
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
   * Stamp the bus-neutral dispatch bookkeeping on every (re-)dispatch:
   * increment the synthetic attempt counter and set the delegation lease.
   *
   * Called from the delegation path right after a successful transport send,
   * so BOTH the initial delegation and every redelivery-engine re-dispatch
   * refresh the lease and bump attemptCount. The columns are inert when no
   * orchestrator-redelivery transport is active (nothing reads them there),
   * so this runs unconditionally — behavior under the SQS profile is
   * unchanged.
   */
  async recordDispatch(id: string, leaseExpiresAt: Date): Promise<void> {
    await this.repo.increment({ id }, "attemptCount", 1);
    await this.repo.update(id, { leaseExpiresAt });
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
