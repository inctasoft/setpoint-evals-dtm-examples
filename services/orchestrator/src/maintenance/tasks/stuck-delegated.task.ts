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
import { DelegationService } from '../../delegation/delegation.service';

/**
 * Stuck Delegated Task
 *
 * Detects steps stuck in DELEGATED state, meaning the SQS message was sent
 * but the Lambda worker never picked it up. This happens when:
 * - SQS message was lost or expired
 * - SQS poller is down or misconfigured
 * - Lambda function deployment is broken
 * - Queue URL mismatch
 *
 * Recovery: Re-delegate the step via DelegationService.retryDelegation() which
 * re-sends the SQS message. Workers have terminal-state guards, so duplicate
 * processing is prevented if the original message eventually gets processed.
 *
 * Configuration:
 * - MAINTENANCE_DELEGATED_TIMEOUT_MINUTES: Detection threshold (default: 10)
 */
@Injectable()
export class StuckDelegatedTask extends BaseMaintenanceTask {
  private readonly delegatedTimeoutMinutes: number;

  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly delegationService: DelegationService,
    private readonly advisoryLock: AdvisoryLockService,
  ) {
    super('StuckDelegatedTask');

    this.delegatedTimeoutMinutes = parseInt(
      this.configService.get<string>('MAINTENANCE_DELEGATED_TIMEOUT_MINUTES', '10'),
      10,
    );

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'stuck-delegated',
      description:
        'Detects and re-delegates steps stuck in DELEGATED state (SQS message lost or not picked up)',
      schedule: CronExpression.EVERY_10_MINUTES,
      priority: 85,
      category: 'recovery',
      timeoutMs: 120000,
      enabled: true,
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledRun() {
    const acquired = await this.advisoryLock.tryAcquire(LockId.STUCK_DELEGATED);
    if (!acquired) return;
    try {
      await this.execute();
    } finally {
      await this.advisoryLock.release(LockId.STUCK_DELEGATED);
    }
  }

  protected async doExecute(options?: Record<string, any>): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      stuckDelegatedFound: 0,
      reDelegated: 0,
      skipped: 0,
      failed: 0,
    };

    const effectiveTimeoutMinutes =
      options?.delegatedTimeoutMinutes !== undefined
        ? parseFloat(options.delegatedTimeoutMinutes)
        : this.delegatedTimeoutMinutes;

    this.logger.log(
      `Executing with timeout: ${effectiveTimeoutMinutes} minutes (Configured: ${this.delegatedTimeoutMinutes})`,
    );

    const cutoffTime = new Date(Date.now() - effectiveTimeoutMinutes * 60 * 1000);

    const stuckSteps = await this.stepRepository.find({
      where: {
        status: StepStatus.DELEGATED,
        startedAt: LessThan(cutoffTime),
      },
      relations: ['job'],
      order: { startedAt: 'ASC' },
    });

    metrics.stuckDelegatedFound = stuckSteps.length;

    if (stuckSteps.length === 0) {
      return {
        success: true,
        message: 'No stuck DELEGATED steps found',
        metrics,
      };
    }

    for (const step of stuckSteps) {
      const stuckMinutes = Math.round((Date.now() - step.startedAt.getTime()) / 1000 / 60);
      const jobId = step.job?.id;

      if (!jobId) {
        this.logger.error(`Cannot re-delegate step ${step.id}: job relation not loaded`);
        metrics.failed++;
        continue;
      }

      // Skip if job is already terminal
      if (step.job.status !== JobStatus.PROCESSING) {
        this.logger.debug(`Skipping step ${step.id}: job ${jobId} is already ${step.job.status}`);
        metrics.skipped++;
        continue;
      }

      findings.push({
        severity: 'warning',
        description: `Step stuck in DELEGATED for ${stuckMinutes} minutes (threshold: ${effectiveTimeoutMinutes}min)`,
        subjectId: step.id,
        subjectType: 'step',
        context: {
          jobId,
          stepValue: step.stepValue,
          stuckMinutes,
          originalSqsMessageId: step.sqsMessageId,
          lambdaFunction: step.lambdaFunctionName,
        },
      });

      try {
        this.logger.warn(
          `Re-delegating stuck step ${step.id} (${step.stepValue}) — stuck in DELEGATED for ${stuckMinutes}min`,
        );

        const result = await this.delegationService.retryDelegation(step.id);

        actions.push({
          type: 'auto-fix',
          description: `Re-delegated step after ${stuckMinutes}min timeout`,
          subjectId: step.id,
          result: result.success ? 'success' : 'failed',
          context: {
            jobId,
            stepValue: step.stepValue,
            newSqsMessageId: result.sqsMessageId,
          },
        });

        if (result.success) {
          metrics.reDelegated++;
        } else {
          metrics.failed++;
        }
      } catch (error) {
        this.logger.error(`Failed to re-delegate step ${step.id}:`, error);

        actions.push({
          type: 'auto-fix',
          description: `Re-delegation failed: ${error.message}`,
          subjectId: step.id,
          result: 'failed',
        });

        metrics.failed++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.stuckDelegatedFound} stuck delegated steps, re-delegated ${metrics.reDelegated}, skipped ${metrics.skipped}, failed ${metrics.failed}`,
      findings,
      actions,
      metrics,
    };
  }
}
