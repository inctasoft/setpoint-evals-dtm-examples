import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Step, StepStatus, JobStatus } from '@dtm/database';
import { ConfigService } from '@nestjs/config';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';
import {
  TaskMetadata,
  TaskResult,
  TaskFinding,
  TaskAction,
} from '../interfaces/maintenance-task.interface';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { OrchestrationService } from '../../orchestration/orchestration.service';

/**
 * Stuck Pending Task
 *
 * Detects steps stuck in PENDING state where dependencies should be satisfied.
 * This happens when:
 * - Orchestrator crashed between creating the step record and calling delegateStep()
 * - continueJob() was interrupted mid-execution
 * - Network partition during delegation
 *
 * Recovery: Call orchestrationService.continueJob(jobId) which re-evaluates
 * all step states, finds steps with satisfied dependencies, and delegates them.
 * This is fully idempotent — if no steps are ready, it's a no-op.
 *
 * Configuration:
 * - MAINTENANCE_PENDING_TIMEOUT_MINUTES: Detection threshold (default: 5)
 */
@Injectable()
export class StuckPendingTask extends BaseMaintenanceTask {
  private readonly pendingTimeoutMinutes: number;

  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly orchestrationService: OrchestrationService,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('StuckPendingTask', advisoryLock);

    this.pendingTimeoutMinutes = parseInt(
      this.configService.get<string>('MAINTENANCE_PENDING_TIMEOUT_MINUTES', '5'),
      10,
    );

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'stuck-pending',
      description:
        'Detects and recovers steps stuck in PENDING where dependencies are satisfied (crash recovery)',
      schedule: CronExpression.EVERY_5_MINUTES,
      priority: 85,
      category: 'recovery',
      timeoutMs: 120000,
      enabled: true,
      lockId: LockId.STUCK_PENDING,
    };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(options?: Record<string, any>): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      stuckPendingFound: 0,
      jobsRecovered: 0,
      skipped: 0,
      failed: 0,
    };

    const effectiveTimeoutMinutes =
      options?.pendingTimeoutMinutes !== undefined
        ? parseFloat(options.pendingTimeoutMinutes)
        : this.pendingTimeoutMinutes;

    this.logger.log(
      `Executing with timeout: ${effectiveTimeoutMinutes} minutes (Configured: ${this.pendingTimeoutMinutes})`,
    );

    const cutoffTime = new Date(Date.now() - effectiveTimeoutMinutes * 60 * 1000);

    const stuckSteps = await this.stepRepository.find({
      where: {
        status: StepStatus.PENDING,
        startedAt: LessThan(cutoffTime),
      },
      relations: ['job'],
      order: { startedAt: 'ASC' },
    });

    metrics.stuckPendingFound = stuckSteps.length;

    if (stuckSteps.length === 0) {
      return {
        success: true,
        message: 'No stuck PENDING steps found',
        metrics,
      };
    }

    // Group by jobId to avoid calling continueJob multiple times for the same job
    const jobStepMap = new Map<string, Step[]>();
    for (const step of stuckSteps) {
      const jobId = step.job?.id;
      if (!jobId) continue;

      if (!jobStepMap.has(jobId)) {
        jobStepMap.set(jobId, []);
      }
      jobStepMap.get(jobId)!.push(step);
    }

    for (const [jobId, steps] of jobStepMap) {
      const job = steps[0].job;

      // Skip if job is already terminal
      if (job.status !== JobStatus.PROCESSING) {
        this.logger.debug(
          `Skipping ${steps.length} stuck pending steps for job ${jobId}: job is already ${job.status}`,
        );
        metrics.skipped += steps.length;
        continue;
      }

      // Create findings for each stuck step
      for (const step of steps) {
        const stuckMinutes = Math.round((Date.now() - step.startedAt.getTime()) / 1000 / 60);

        findings.push({
          severity: 'warning',
          description: `Step stuck in PENDING for ${stuckMinutes} minutes (threshold: ${effectiveTimeoutMinutes}min)`,
          subjectId: step.id,
          subjectType: 'step',
          context: {
            jobId,
            stepValue: step.stepValue,
            stuckMinutes,
          },
        });
      }

      try {
        this.logger.warn(
          `Re-triggering continueJob for job ${jobId} — ${steps.length} stuck PENDING step(s)`,
        );

        await this.orchestrationService.continueJob(jobId);

        actions.push({
          type: 'auto-fix',
          description: `Triggered continueJob for ${steps.length} stuck PENDING step(s)`,
          subjectId: jobId,
          result: 'success',
          context: {
            stuckStepValues: steps.map((s) => s.stepValue),
          },
        });

        metrics.jobsRecovered++;
      } catch (error) {
        this.logger.error(`Failed to recover job ${jobId}:`, error);

        actions.push({
          type: 'auto-fix',
          description: `continueJob failed: ${error.message}`,
          subjectId: jobId,
          result: 'failed',
        });

        metrics.failed++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.stuckPendingFound} stuck pending steps across ${jobStepMap.size} jobs, recovered ${metrics.jobsRecovered} jobs, skipped ${metrics.skipped}, failed ${metrics.failed}`,
      findings,
      actions,
      metrics,
    };
  }
}
