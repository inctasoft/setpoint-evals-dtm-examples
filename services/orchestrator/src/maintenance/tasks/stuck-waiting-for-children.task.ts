import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Step, StepStatus, StepRepository, JobStatus } from '@dtm/database';
import { ConfigService } from '@nestjs/config';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';
import {
  TaskMetadata,
  TaskResult,
  TaskFinding,
  TaskAction,
} from '../interfaces/maintenance-task.interface';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { FanOutService } from '../../orchestration/fan-out.service';

const TERMINAL_STATUSES = new Set<StepStatus>([
  StepStatus.COMPLETED,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
  StepStatus.PARTIAL_SUCCESS,
]);

/**
 * Stuck Waiting For Children Task
 *
 * Detects discovery steps stuck in WAITING_FOR_CHILDREN where all child steps
 * have already reached terminal state. This happens when:
 * - Orchestrator restarted while the last child was completing
 * - Race condition: last child callback completed but parent never got the signal
 * - Bug in fan-out aggregation logic
 *
 * Recovery: Re-evaluate children via FanOutService.handleChildStepComplete()
 * which recalculates parent status from children. This is idempotent — if the
 * parent has already transitioned, the terminal-state guard rejects the update.
 *
 * Configuration:
 * - MAINTENANCE_WAITING_FOR_CHILDREN_TIMEOUT_MINUTES: Detection threshold (default: 15)
 */
@Injectable()
export class StuckWaitingForChildrenTask extends BaseMaintenanceTask {
  private readonly timeoutMinutes: number;

  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly fanOutService: FanOutService,
    private readonly customStepRepository: StepRepository,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('StuckWaitingForChildrenTask', advisoryLock);

    this.timeoutMinutes = parseInt(
      this.configService.get<string>('MAINTENANCE_WAITING_FOR_CHILDREN_TIMEOUT_MINUTES', '15'),
      10,
    );

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'stuck-waiting-for-children',
      description:
        'Detects and recovers discovery steps stuck in WAITING_FOR_CHILDREN with all terminal children',
      schedule: CronExpression.EVERY_10_MINUTES,
      priority: 90,
      category: 'recovery',
      timeoutMs: 120000,
      enabled: true,
      lockId: LockId.STUCK_WAITING_FOR_CHILDREN,
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(options?: Record<string, any>): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      stuckParentsFound: 0,
      recovered: 0,
      stillProcessing: 0,
      failed: 0,
    };

    const effectiveTimeoutMinutes =
      options?.timeoutMinutes !== undefined
        ? parseFloat(options.timeoutMinutes)
        : this.timeoutMinutes;

    this.logger.log(
      `Executing with timeout: ${effectiveTimeoutMinutes} minutes (Configured: ${this.timeoutMinutes})`,
    );

    const cutoffTime = new Date(Date.now() - effectiveTimeoutMinutes * 60 * 1000);

    // Find steps stuck in WAITING_FOR_CHILDREN
    const stuckParents = await this.stepRepository.find({
      where: {
        status: StepStatus.WAITING_FOR_CHILDREN,
        startedAt: LessThan(cutoffTime),
      },
      relations: ['job'],
      order: { startedAt: 'ASC' },
    });

    metrics.stuckParentsFound = stuckParents.length;

    if (stuckParents.length === 0) {
      return {
        success: true,
        message: 'No stuck WAITING_FOR_CHILDREN steps found',
        metrics,
      };
    }

    for (const parentStep of stuckParents) {
      const stuckMinutes = Math.round((Date.now() - parentStep.startedAt.getTime()) / 1000 / 60);
      const jobId = parentStep.job?.id;

      if (!jobId) {
        this.logger.error(`Cannot recover step ${parentStep.id}: job relation not loaded`);
        metrics.failed++;
        continue;
      }

      // Skip if job is already terminal
      if (parentStep.job.status !== JobStatus.PROCESSING) {
        this.logger.debug(
          `Skipping step ${parentStep.id}: job ${jobId} is already ${parentStep.job.status}`,
        );
        continue;
      }

      // Load children to check if all are terminal
      const children = await this.customStepRepository.findByParentId(parentStep.id);

      if (children.length === 0) {
        findings.push({
          severity: 'warning',
          description: `Discovery step has no children but is in WAITING_FOR_CHILDREN (stuck ${stuckMinutes}min)`,
          subjectId: parentStep.id,
          subjectType: 'step',
          context: { jobId, stepValue: parentStep.stepValue, stuckMinutes },
        });
        continue;
      }

      const allChildrenTerminal = children.every((c) => TERMINAL_STATUSES.has(c.status));

      if (!allChildrenTerminal) {
        // Children still processing — this parent is legitimately waiting
        metrics.stillProcessing++;
        this.logger.debug(
          `Step ${parentStep.id} has non-terminal children — skipping (stuck ${stuckMinutes}min)`,
        );
        continue;
      }

      // All children are terminal but parent is still WAITING_FOR_CHILDREN
      // Re-trigger evaluation by calling handleChildStepComplete on any terminal child
      const lastChild = children[children.length - 1];

      findings.push({
        severity: 'warning',
        description: `Discovery step stuck in WAITING_FOR_CHILDREN for ${stuckMinutes} minutes with all ${children.length} children terminal`,
        subjectId: parentStep.id,
        subjectType: 'step',
        context: {
          jobId,
          stepValue: parentStep.stepValue,
          stuckMinutes,
          childCount: children.length,
          childStatuses: children.map((c) => c.status),
        },
      });

      try {
        this.logger.warn(
          `Re-evaluating stuck parent ${parentStep.id} (${parentStep.stepValue}) — all ${children.length} children terminal`,
        );

        await this.fanOutService.handleChildStepComplete(lastChild, jobId);

        actions.push({
          type: 'auto-fix',
          description: `Re-evaluated parent step after ${stuckMinutes}min timeout — all ${children.length} children were terminal`,
          subjectId: parentStep.id,
          result: 'success',
          context: { jobId, stepValue: parentStep.stepValue },
        });

        metrics.recovered++;
      } catch (error) {
        this.logger.error(`Failed to recover stuck parent ${parentStep.id}:`, error);

        actions.push({
          type: 'auto-fix',
          description: `Recovery failed: ${error.message}`,
          subjectId: parentStep.id,
          result: 'failed',
        });

        metrics.failed++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.stuckParentsFound} stuck parents, recovered ${metrics.recovered}, ${metrics.stillProcessing} still processing, ${metrics.failed} failed`,
      findings,
      actions,
      metrics,
    };
  }
}
