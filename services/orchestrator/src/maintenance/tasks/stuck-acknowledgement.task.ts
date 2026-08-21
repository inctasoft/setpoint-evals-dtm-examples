import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Step, StepStatus } from '@dtm/database';
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
 * Stuck Acknowledgement Task
 *
 * Detects steps stuck waiting for external system acknowledgements.
 * After a configurable timeout, automatically fails the step and triggers orchestration.
 *
 * Why this is critical:
 * - If external system is down, jobs can hang indefinitely
 * - Kafka issues can prevent acknowledgements from being received
 * - DevAckSimulator failures in development can cause stuck jobs
 *
 * Configuration:
 * - MAINTENANCE_ACK_TIMEOUT_MINUTES: When to auto-fail (default: 30)
 * - MAINTENANCE_AUTO_FIX_ENABLED: Enable auto-fix (default: true)
 */
@Injectable()
export class StuckAcknowledgementTask extends BaseMaintenanceTask {
  private readonly ackTimeoutMinutes: number;
  private readonly autoFixEnabled: boolean;

  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly orchestrationService: OrchestrationService,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('StuckAcknowledgementTask', advisoryLock);

    // Configuration
    this.ackTimeoutMinutes = parseInt(
      this.configService.get<string>('MAINTENANCE_ACK_TIMEOUT_MINUTES', '30'),
      10,
    );

    this.autoFixEnabled =
      this.configService.get<string>('MAINTENANCE_AUTO_FIX_ENABLED', 'true') === 'true';

    // Register with registry
    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'stuck-acknowledgement',
      description: 'Detects and auto-fails steps stuck waiting for external acknowledgements',
      schedule: CronExpression.EVERY_5_MINUTES,
      priority: 100, // High priority
      category: 'health-check',
      timeoutMs: 60000, // 1 minute
      enabled: true,
      lockId: LockId.STUCK_ACKNOWLEDGEMENT,
    };
  }

  /**
   * Run every 5 minutes via NestJS scheduler
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(options?: Record<string, any>): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      stuckStepsFound: 0,
      autoFixed: 0,
      alertsRaised: 0,
    };

    // Allow overriding timeout via execution options
    const effectiveTimeoutMinutes =
      options?.ackTimeoutMinutes !== undefined
        ? parseFloat(options.ackTimeoutMinutes)
        : this.ackTimeoutMinutes;

    this.logger.log(
      `Executing with timeout: ${effectiveTimeoutMinutes} minutes (Configured: ${this.ackTimeoutMinutes})`,
    );

    // Find steps stuck waiting for acknowledgement
    const cutoffTime = new Date(Date.now() - effectiveTimeoutMinutes * 60 * 1000);

    const stuckSteps = await this.stepRepository.find({
      where: {
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: LessThan(cutoffTime),
      },
      relations: ['job'],
    });

    metrics.stuckStepsFound = stuckSteps.length;

    if (stuckSteps.length === 0) {
      return {
        success: true,
        message: 'No stuck acknowledgements found - all steps healthy',
        metrics,
      };
    }

    // Process each stuck step
    for (const step of stuckSteps) {
      const waitTimeMinutes = step.kafkaPublishedAt
        ? Math.round((Date.now() - step.kafkaPublishedAt.getTime()) / 1000 / 60)
        : 0;

      findings.push({
        severity: 'critical',
        description: `Step stuck waiting for acknowledgement for ${waitTimeMinutes} minutes (threshold: ${effectiveTimeoutMinutes}min)`,
        subjectId: step.id,
        subjectType: 'step',
        context: {
          jobId: step.job?.id,
          stepValue: step.stepValue,
          kafkaPublishedAt: step.kafkaPublishedAt,
          waitTimeMinutes,
          thresholdMinutes: effectiveTimeoutMinutes,
        },
      });

      // Auto-fix if enabled
      if (this.autoFixEnabled) {
        try {
          await this.autoFailStep(step, effectiveTimeoutMinutes);

          actions.push({
            type: 'auto-fix',
            description: `Auto-failed step after ${effectiveTimeoutMinutes}min timeout`,
            subjectId: step.id,
            result: 'success',
            context: {
              jobId: step.job?.id,
              stepValue: step.stepValue,
              waitTimeMinutes,
            },
          });

          metrics.autoFixed++;
        } catch (error) {
          this.logger.error(`Failed to auto-fix step ${step.id}:`, error);

          actions.push({
            type: 'auto-fix',
            description: `Auto-fix failed: ${error.message}`,
            subjectId: step.id,
            result: 'failed',
          });
        }
      } else {
        actions.push({
          type: 'manual-review-required',
          description: `Manual intervention required (auto-fix disabled)`,
          subjectId: step.id,
          context: {
            reason: 'MAINTENANCE_AUTO_FIX_ENABLED=false',
            recommendation: 'Enable auto-fix or manually fail the step via API',
          },
        });

        metrics.alertsRaised++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.stuckStepsFound} stuck acknowledgements, auto-fixed ${metrics.autoFixed}, raised ${metrics.alertsRaised} alerts`,
      findings,
      actions,
      metrics,
    };
  }

  /**
   * Auto-fail a stuck step and trigger orchestration
   */
  private async autoFailStep(step: Step, effectiveTimeoutMinutes: number): Promise<void> {
    const jobId = step.job?.id;
    if (!jobId) {
      this.logger.error(`Cannot auto-fail step ${step.id}: job relation not loaded`);
      return;
    }

    this.logger.warn(
      `🔴 Auto-failing step ${step.id} (${step.stepValue}) due to acknowledgement timeout (${effectiveTimeoutMinutes}min)`,
    );

    // LEADER-2: conditional UPDATE — only transition WAITING_FOR_ACK → FAILED.
    // The reaper's SELECT (in doExecute) and this UPDATE are two separate
    // round-trips; a real ACK can land on the step in between them (e.g. a
    // slow-but-alive external system finally responds). An id-only update
    // would blindly overwrite that legitimate progress back to FAILED. Gating
    // the UPDATE's WHERE clause on the status the SELECT actually observed
    // makes the race resolve safely: if the row is no longer WAITING_FOR_ACK,
    // `affected` comes back 0 and we skip — the real ACK's own orchestration
    // trigger (already in flight) is left to finish the job, instead of us
    // double-triggering continueJob for a step we didn't actually fail.
    const updateResult = await this.stepRepository.update(
      { id: step.id, status: StepStatus.WAITING_FOR_ACK },
      {
        status: StepStatus.FAILED,
        error: `Acknowledgement timeout - external system did not respond within ${effectiveTimeoutMinutes} minutes. This could indicate: 1) External system is down, 2) Kafka connectivity issues, 3) DevAckSimulator failure (development only)`,
        completedAt: new Date(),
      },
    );

    if (updateResult.affected === 0) {
      this.logger.log(
        `↩️  Step ${step.id} no longer in WAITING_FOR_ACK — a real ACK (or another reaper) already moved it; skipping continueJob`,
      );
      return;
    }

    // Trigger orchestration to handle the failure
    // This will mark dependent steps as skipped/aborted and potentially fail the job
    await this.orchestrationService.continueJob(jobId);

    this.logger.log(
      `✅ Step ${step.id} marked as FAILED, orchestration triggered for job ${jobId}`,
    );
  }
}
