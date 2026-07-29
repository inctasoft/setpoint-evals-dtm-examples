import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { Step, DeadLetter, StepStatus, JobStatus } from '@dtm/database';
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
import { OrchestrationService } from '../../orchestration/orchestration.service';
import {
  QueueTransport,
  isRedeliveryEngineActive,
} from '../../transport/queue-transport.interface';

/**
 * Redelivery Engine Task
 *
 * Orchestrator-driven redelivery (Phase 1 of the bus-agnosticism program):
 * re-dispatches steps whose delegation lease (`dtm_steps.lease_expires_at`)
 * has expired while still in a non-terminal dispatch state (DELEGATED,
 * IN_PROGRESS, IN_PROGRESS_RETRYING). This replaces the "leave the SQS
 * message undeleted and let the bus redeliver" mechanism for transports that
 * have no native redelivery.
 *
 * Attempt bookkeeping: every dispatch (initial or re-) increments the
 * synthetic bus-neutral `dtm_steps.attempt_count` and refreshes the lease
 * (stamped in DelegationService.delegateStep). When a lease-expired step's
 * attemptCount has reached its maxRetryCount, the engine writes a
 * `dtm_dead_letters` row, marks the step FAILED, and nudges orchestration so
 * the job can reach its own terminal state.
 *
 * ACTIVATION (fail-closed): the task is a total no-op unless the active
 * transport declares `redelivery: 'orchestrator'` OR the
 * REDELIVERY_ENGINE_FORCE_ENABLED escape hatch is set (setpoint evals). Under
 * the default aws/SQS profile nothing here fires — SQS redelivery semantics
 * are unchanged.
 *
 * Configuration:
 * - REDELIVERY_ENGINE_FORCE_ENABLED: force-enable the engine (default: false)
 * - REDELIVERY_LEASE_SECONDS: lease stamped at each dispatch (default: 300)
 */
@Injectable()
export class RedeliveryEngineTask extends BaseMaintenanceTask {
  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    @InjectRepository(DeadLetter)
    private readonly deadLetterRepository: Repository<DeadLetter>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly delegationService: DelegationService,
    private readonly orchestrationService: OrchestrationService,
    private readonly transport: QueueTransport,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('RedeliveryEngineTask', advisoryLock);

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'redelivery-engine',
      description:
        'Orchestrator-driven redelivery: re-dispatches lease-expired DELEGATED/IN_PROGRESS/IN_PROGRESS_RETRYING steps and dead-letters attempt-exhausted ones (active only when the transport declares orchestrator redelivery or REDELIVERY_ENGINE_FORCE_ENABLED=true)',
      schedule: CronExpression.EVERY_30_SECONDS,
      priority: 95,
      category: 'recovery',
      timeoutMs: 60000,
      enabled: true,
      lockId: LockId.REDELIVERY_ENGINE,
    };
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduledRun() {
    await this.execute();
  }

  /**
   * Fail-closed gate: no scan, no re-dispatch, no dead-letter writes unless
   * the engine is active for this deployment.
   */
  override canRun(): Promise<boolean> {
    const metadata = this.getMetadata();
    if (!metadata.enabled) {
      this.logger.log(`Task ${metadata.name} is disabled`);
      return Promise.resolve(false);
    }

    const forceEnabled =
      this.configService.get<string>('REDELIVERY_ENGINE_FORCE_ENABLED', 'false') === 'true';
    return Promise.resolve(isRedeliveryEngineActive(this.transport.capabilities, forceEnabled));
  }

  protected async doExecute(): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      expiredLeasesFound: 0,
      reDispatched: 0,
      deadLettered: 0,
      skipped: 0,
      failed: 0,
    };

    const now = new Date();

    const expiredSteps = await this.stepRepository.find({
      where: {
        status: In([StepStatus.DELEGATED, StepStatus.IN_PROGRESS, StepStatus.IN_PROGRESS_RETRYING]),
        leaseExpiresAt: LessThan(now),
      },
      relations: ['job'],
      order: { leaseExpiresAt: 'ASC' },
    });

    metrics.expiredLeasesFound = expiredSteps.length;

    if (expiredSteps.length === 0) {
      return {
        success: true,
        message: 'No expired delegation leases found',
        metrics,
      };
    }

    for (const step of expiredSteps) {
      const jobId = step.job?.id;

      if (!jobId) {
        this.logger.error(`Cannot re-dispatch step ${step.id}: job relation not loaded`);
        metrics.failed++;
        continue;
      }

      // Skip if job is already terminal
      if (step.job.status !== JobStatus.PROCESSING) {
        this.logger.debug(`Skipping step ${step.id}: job ${jobId} is already ${step.job.status}`);
        metrics.skipped++;
        continue;
      }

      // Attempt exhaustion → dead letter + terminal FAILED (engine-owned;
      // transports with dlq:'table' have no bus-side DLQ to fall back on).
      if ((step.attemptCount ?? 0) >= step.maxRetryCount) {
        this.logger.warn(
          `Step ${step.id} (${step.stepValue}) exhausted attempts (${step.attemptCount}/${step.maxRetryCount}) — writing dead letter`,
        );

        try {
          await this.deadLetterRepository.save(
            this.deadLetterRepository.create({
              stepId: step.id,
              jobId,
              workflowName: step.job.workflowName,
              stepValue: step.stepValue,
              attemptCount: step.attemptCount ?? 0,
              lastError: step.error ?? null,
              input: step.input,
            }),
          );

          await this.stepRepository.update(step.id, {
            status: StepStatus.FAILED,
            error: `Attempts exhausted under redelivery engine (${step.attemptCount}/${step.maxRetryCount}): ${step.error ?? 'no error recorded'}`,
            completedAt: new Date(),
          });

          actions.push({
            type: 'auto-fix',
            description: `Dead-lettered step after ${step.attemptCount} attempts`,
            subjectId: step.id,
            result: 'success',
            context: { jobId, stepValue: step.stepValue, attemptCount: step.attemptCount },
          });

          metrics.deadLettered++;

          // Nudge orchestration so the job observes the permanently failed
          // step and reaches its own terminal state.
          await this.orchestrationService.continueJob(jobId);
        } catch (error) {
          this.logger.error(`Failed to dead-letter step ${step.id}:`, error);
          metrics.failed++;
        }
        continue;
      }

      findings.push({
        severity: 'warning',
        description: `Step lease expired in ${step.status} (attempt ${step.attemptCount}/${step.maxRetryCount})`,
        subjectId: step.id,
        subjectType: 'step',
        context: {
          jobId,
          stepValue: step.stepValue,
          status: step.status,
          attemptCount: step.attemptCount,
          leaseExpiresAt: step.leaseExpiresAt,
        },
      });

      try {
        this.logger.warn(
          `Re-dispatching lease-expired step ${step.id} (${step.stepValue}) — attempt ${(step.attemptCount ?? 0) + 1}/${step.maxRetryCount}`,
        );

        const result = await this.delegationService.retryDelegation(step.id);

        actions.push({
          type: 'auto-fix',
          description: 'Re-dispatched step after delegation lease expiry',
          subjectId: step.id,
          result: result.success ? 'success' : 'failed',
          context: {
            jobId,
            stepValue: step.stepValue,
            newTaskHandle: result.sqsMessageId,
          },
        });

        if (result.success) {
          metrics.reDispatched++;
        } else {
          metrics.failed++;
        }
      } catch (error) {
        this.logger.error(`Failed to re-dispatch step ${step.id}:`, error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        actions.push({
          type: 'auto-fix',
          description: `Re-dispatch failed: ${errorMessage}`,
          subjectId: step.id,
          result: 'failed',
        });

        metrics.failed++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.expiredLeasesFound} expired leases, re-dispatched ${metrics.reDispatched}, dead-lettered ${metrics.deadLettered}, skipped ${metrics.skipped}, failed ${metrics.failed}`,
      findings,
      actions,
      metrics,
    };
  }
}
