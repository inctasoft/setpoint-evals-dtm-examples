import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Job, JobStatus } from '@dtm/database';
import { ConfigService } from '@nestjs/config';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';
import { TaskMetadata, TaskResult, TaskAction } from '../interfaces/maintenance-task.interface';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';

/**
 * Old Job Cleanup Task
 *
 * Archives or deletes old completed/failed jobs based on retention policy.
 *
 * Why this is important:
 * - Prevents database bloat
 * - Maintains query performance
 * - Complies with data retention policies
 * - Reduces storage costs
 *
 * Cleanup strategy:
 * - Only delete jobs in terminal states (COMPLETED, FAILED)
 * - Process in batches to avoid long-running transactions
 * - Cascade delete steps (via database foreign key)
 * - Log all deletions for auditing
 *
 * Future enhancement:
 * - Archive to S3 before deletion
 * - Selective retention (keep failed jobs longer)
 * - Soft delete with archive flag
 *
 * Configuration:
 * - MAINTENANCE_JOB_RETENTION_DAYS: How long to keep jobs (default: 30)
 * - MAINTENANCE_CLEANUP_BATCH_SIZE: Max jobs per run (default: 100)
 */
@Injectable()
export class OldJobCleanupTask extends BaseMaintenanceTask {
  private readonly retentionDays: number;
  private readonly batchSize: number;

  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('OldJobCleanupTask', advisoryLock);

    this.retentionDays = parseInt(
      this.configService.get<string>('MAINTENANCE_JOB_RETENTION_DAYS', '30'),
      10,
    );

    this.batchSize = parseInt(
      this.configService.get<string>('MAINTENANCE_CLEANUP_BATCH_SIZE', '100'),
      10,
    );

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'old-job-cleanup',
      description: 'Archives or deletes old completed/failed jobs based on retention policy',
      schedule: CronExpression.EVERY_DAY_AT_2AM, // Run at 2 AM daily
      priority: 10, // Low priority
      category: 'cleanup',
      timeoutMs: 300000, // 5 minutes
      enabled: true,
      lockId: LockId.OLD_JOB_CLEANUP,
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(): Promise<TaskResult> {
    const actions: TaskAction[] = [];
    const metrics = {
      jobsFound: 0,
      jobsDeleted: 0,
      stepsDeleted: 0,
      errors: 0,
      oldestJobAge: 0,
      newestJobAge: 0,
    };

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    this.logger.log(
      `🧹 Cleaning up jobs completed/failed before ${cutoffDate.toISOString()} (retention: ${this.retentionDays} days)`,
    );

    // Find old jobs in terminal states
    const oldJobs = await this.jobRepository.find({
      where: {
        status: In([JobStatus.COMPLETED, JobStatus.FAILED]),
        completedAt: LessThan(cutoffDate),
      },
      relations: ['steps'],
      take: this.batchSize,
      order: { completedAt: 'ASC' }, // Delete oldest first
    });

    metrics.jobsFound = oldJobs.length;

    if (oldJobs.length === 0) {
      return {
        success: true,
        message: `No jobs older than ${this.retentionDays} days found`,
        metrics,
      };
    }

    // Calculate age range
    if (oldJobs.length > 0 && oldJobs[0].completedAt) {
      metrics.oldestJobAge = this.getAgeInDays(oldJobs[0].completedAt);
      const lastJob = oldJobs[oldJobs.length - 1];
      if (lastJob.completedAt) {
        metrics.newestJobAge = this.getAgeInDays(lastJob.completedAt);
      }
    }

    // Delete jobs (steps will be cascade deleted via FK)
    for (const job of oldJobs) {
      try {
        const stepCount = job.steps.length;
        const jobAge = job.completedAt ? this.getAgeInDays(job.completedAt) : 0;

        // Log before deletion for audit trail
        this.logger.debug(
          `Deleting job ${job.id} (${job.status}, age: ${jobAge} days, ${stepCount} steps)`,
        );

        await this.jobRepository.remove(job);

        metrics.jobsDeleted++;
        metrics.stepsDeleted += stepCount;

        actions.push({
          type: 'auto-fix',
          description: `Deleted job and ${stepCount} steps (age: ${jobAge} days, status: ${job.status})`,
          subjectId: job.id,
          result: 'success',
          context: {
            jobStatus: job.status,
            ageInDays: jobAge,
            stepsDeleted: stepCount,
            submittedAt: job.submittedAt,
            completedAt: job.completedAt,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to delete job ${job.id}:`, error);
        metrics.errors++;

        const errorMessage = error instanceof Error ? error.message : String(error);
        actions.push({
          type: 'auto-fix',
          description: `Failed to delete: ${errorMessage}`,
          subjectId: job.id,
          result: 'failed',
          context: {
            error: errorMessage,
          },
        });
      }
    }

    // Log summary
    if (metrics.jobsDeleted > 0) {
      this.logger.log(
        `✅ Cleaned up ${metrics.jobsDeleted} jobs (${metrics.stepsDeleted} steps) - age range: ${metrics.newestJobAge}-${metrics.oldestJobAge} days`,
      );
    }

    // Warn if batch limit reached (more jobs to clean)
    if (metrics.jobsFound >= this.batchSize) {
      this.logger.warn(
        `⚠️  Batch limit reached (${this.batchSize}). More jobs may need cleanup. Consider increasing batch size or running more frequently.`,
      );
    }

    return {
      success: metrics.errors === 0,
      message: `Cleaned up ${metrics.jobsDeleted}/${metrics.jobsFound} old jobs (retention: ${this.retentionDays} days)`,
      actions,
      metrics,
    };
  }

  /**
   * Calculate job age in days
   */
  private getAgeInDays(completedAt: Date): number {
    return Math.floor((Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24));
  }
}
