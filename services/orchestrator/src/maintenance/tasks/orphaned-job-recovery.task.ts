import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Step, JobStatus, StepStatus } from '@dtm/database';
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
 * Orphaned Job Recovery Task
 *
 * Recovers jobs that are stuck in PROCESSING state despite all steps being terminal.
 * This can happen when:
 * - Orchestrator crashes after step completion but before job status update
 * - Race conditions in concurrent step completions
 * - Database transaction failures
 *
 * Recovery strategy:
 * - Detect jobs in PROCESSING with all steps in terminal states
 * - Re-trigger orchestration to recalculate job status
 * - Orchestrator will evaluate all step statuses and update job accordingly
 *
 * Why this is critical:
 * - Prevents "zombie" jobs that never complete
 * - Ensures accurate job status for monitoring
 * - Recovers from orchestrator crashes gracefully
 */
@Injectable()
export class OrphanedJobRecoveryTask extends BaseMaintenanceTask {
  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly orchestrationService: OrchestrationService,
    private readonly advisoryLock: AdvisoryLockService,
  ) {
    super('OrphanedJobRecoveryTask');
    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'orphaned-job-recovery',
      description: 'Recovers jobs stuck in PROCESSING state despite all steps being terminal',
      schedule: CronExpression.EVERY_10_MINUTES,
      priority: 90, // High priority
      category: 'recovery',
      timeoutMs: 120000, // 2 minutes
      enabled: true,
    };
  }

  @Cron('*/30 * * * * *')  // Every 30 seconds for development
  async scheduledRun() {
    const acquired = await this.advisoryLock.tryAcquire(LockId.ORPHANED_JOB_RECOVERY);
    if (!acquired) return;
    try {
      await this.execute();
    } finally {
      await this.advisoryLock.release(LockId.ORPHANED_JOB_RECOVERY);
    }
  }

  protected async doExecute(): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics = {
      orphanedJobsFound: 0,
      recovered: 0,
      failed: 0,
    };

    // Find jobs in PROCESSING state
    const processingJobs = await this.jobRepository.find({
      where: { status: JobStatus.PROCESSING },
      relations: ['steps'],
    });

    if (processingJobs.length === 0) {
      return {
        success: true,
        message: 'No jobs in PROCESSING state',
        metrics,
      };
    }

    for (const job of processingJobs) {
      // Check if all steps are in terminal states
      // PARTIAL_SUCCESS is terminal - it means fan-out completed with some failures
      const allStepsTerminal = job.steps.every((step) =>
        [
          StepStatus.COMPLETED,
          StepStatus.PARTIAL_SUCCESS,
          StepStatus.FAILED,
          StepStatus.SKIPPED,
        ].includes(step.status),
      );

      if (!allStepsTerminal) {
        continue; // Job is legitimately still processing
      }

      metrics.orphanedJobsFound++;

      // Include PARTIAL_SUCCESS in completed count
      const completedSteps = job.steps.filter(
        (s) => s.status === StepStatus.COMPLETED || s.status === StepStatus.PARTIAL_SUCCESS,
      ).length;
      const failedSteps = job.steps.filter((s) => s.status === StepStatus.FAILED).length;
      const skippedSteps = job.steps.filter((s) => s.status === StepStatus.SKIPPED).length;

      const ageMinutes = Math.round((Date.now() - job.submittedAt.getTime()) / 1000 / 60);

      findings.push({
        severity: 'warning',
        description: `Job orphaned - status PROCESSING but all steps terminal`,
        subjectId: job.id,
        subjectType: 'job',
        context: {
          jobId: job.id,
          totalSteps: job.steps.length,
          completed: completedSteps,
          failed: failedSteps,
          skipped: skippedSteps,
          submittedAt: job.submittedAt,
          ageMinutes,
        },
      });

      // Attempt recovery
      try {
        await this.recoverJob(job);

        actions.push({
          type: 'auto-fix',
          description: `Re-triggered orchestration to recalculate job status`,
          subjectId: job.id,
          result: 'success',
          context: {
            completedSteps,
            failedSteps,
            skippedSteps,
          },
        });

        metrics.recovered++;
      } catch (error) {
        this.logger.error(`Failed to recover job ${job.id}:`, error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        actions.push({
          type: 'auto-fix',
          description: `Recovery failed: ${errorMessage}`,
          subjectId: job.id,
          result: 'failed',
          context: {
            error: errorMessage,
          },
        });

        metrics.failed++;
      }
    }

    return {
      success: metrics.failed === 0,
      message: `Found ${metrics.orphanedJobsFound} orphaned jobs, recovered ${metrics.recovered}, failed ${metrics.failed}`,
      findings,
      actions,
      metrics,
    };
  }

  /**
   * Recover an orphaned job by re-triggering orchestration
   */
  private async recoverJob(job: Job): Promise<void> {
    this.logger.log(
      `🔧 Recovering orphaned job ${job.id} (${job.steps.length} steps, all terminal)`,
    );

    // Re-trigger orchestration which will recalculate the job status
    // based on current step states
    await this.orchestrationService.continueJob(job.id);

    // Fetch updated job to log result
    const updatedJob = await this.jobRepository.findOne({
      where: { id: job.id },
    });

    if (updatedJob) {
      this.logger.log(
        `✅ Job ${job.id} recovered: status changed from PROCESSING to ${updatedJob.status}`,
      );
    }
  }
}
