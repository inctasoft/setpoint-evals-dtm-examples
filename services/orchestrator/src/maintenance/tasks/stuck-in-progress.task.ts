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
import { WorkflowConfigService } from '../../workflow-loader';

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes

/**
 * Stuck In-Progress Task
 *
 * Detects steps stuck in IN_PROGRESS or IN_PROGRESS_RETRYING state.
 * This can indicate:
 * - Lambda function timeout without error callback
 * - SQS message visibility timeout issues
 * - Lambda worker crash without proper error handling
 * - Network issues preventing callback delivery
 *
 * Detection strategy:
 * - Find steps in progress states for longer than the detection threshold
 * - Severity based on duration (warning -> critical)
 *
 * Recovery strategy (Phase 4 upgrade):
 * - Auto-fail steps that exceed their per-step timeoutMs (from StepDefinition)
 * - Gated by MAINTENANCE_IN_PROGRESS_AUTO_FAIL_ENABLED env var
 * - After auto-fail, triggers continueJob() to cascade the failure
 * - Falls back to alert-only when auto-fail is disabled
 *
 * Configuration:
 * - MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES: Detection threshold (default: 30)
 * - MAINTENANCE_IN_PROGRESS_AUTO_FAIL_ENABLED: Enable auto-fail (default: true)
 * - StepDefinition.timeoutMs: Per-step auto-fail threshold (default: 30 min)
 */
@Injectable()
export class StuckInProgressTask extends BaseMaintenanceTask {
  private readonly stuckTimeoutMinutes: number;
  private readonly autoFailEnabled: boolean;

  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly orchestrationService: OrchestrationService,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly advisoryLock: AdvisoryLockService,
  ) {
    super('StuckInProgressTask');

    this.stuckTimeoutMinutes = parseInt(
      this.configService.get<string>('MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES', '30'),
      10,
    );

    this.autoFailEnabled =
      this.configService.get<string>('MAINTENANCE_IN_PROGRESS_AUTO_FAIL_ENABLED', 'true') ===
      'true';

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'stuck-in-progress',
      description:
        'Detects steps stuck in IN_PROGRESS state and auto-fails them after per-step timeout',
      schedule: CronExpression.EVERY_10_MINUTES,
      priority: 85,
      category: 'recovery',
      timeoutMs: 120000,
      enabled: true,
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async scheduledRun() {
    const acquired = await this.advisoryLock.tryAcquire(LockId.STUCK_IN_PROGRESS);
    if (!acquired) return;
    try {
      await this.execute();
    } finally {
      await this.advisoryLock.release(LockId.STUCK_IN_PROGRESS);
    }
  }

  protected async doExecute(options?: Record<string, any>): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      stuckStepsFound: 0,
      criticalAlerts: 0,
      warningAlerts: 0,
      stuckInProgress: 0,
      stuckInProgressRetrying: 0,
      autoFailed: 0,
      autoFailSkipped: 0,
    };

    // Allow overriding timeout via execution options
    const effectiveTimeoutMinutes =
      options?.stuckTimeoutMinutes !== undefined
        ? parseFloat(options.stuckTimeoutMinutes)
        : this.stuckTimeoutMinutes;

    const effectiveAutoFail =
      options?.autoFailEnabled !== undefined
        ? options.autoFailEnabled === true || options.autoFailEnabled === 'true'
        : this.autoFailEnabled;

    this.logger.log(
      `Executing with timeout: ${effectiveTimeoutMinutes} minutes, auto-fail: ${effectiveAutoFail} (Configured: ${this.stuckTimeoutMinutes}min, ${this.autoFailEnabled})`,
    );

    const cutoffTime = new Date(Date.now() - effectiveTimeoutMinutes * 60 * 1000);

    // Find steps stuck in IN_PROGRESS or IN_PROGRESS_RETRYING
    const stuckSteps = await this.stepRepository.find({
      where: [
        {
          status: StepStatus.IN_PROGRESS,
          startedAt: LessThan(cutoffTime),
        },
        {
          status: StepStatus.IN_PROGRESS_RETRYING,
          startedAt: LessThan(cutoffTime),
        },
      ],
      relations: ['job'],
      order: { startedAt: 'ASC' }, // Oldest first
    });

    metrics.stuckStepsFound = stuckSteps.length;

    if (stuckSteps.length === 0) {
      return {
        success: true,
        message: 'No stuck in-progress steps found - all processing normally',
        metrics,
      };
    }

    // Process each stuck step
    for (const step of stuckSteps) {
      const stuckMs = Date.now() - step.startedAt.getTime();
      const stuckMinutes = Math.round(stuckMs / 1000 / 60);

      // Track by status
      if (step.status === StepStatus.IN_PROGRESS) {
        metrics.stuckInProgress++;
      } else if (step.status === StepStatus.IN_PROGRESS_RETRYING) {
        metrics.stuckInProgressRetrying++;
      }

      // Determine severity based on how long it's been stuck
      const severity = stuckMinutes > 60 ? 'critical' : 'warning';

      if (severity === 'critical') {
        metrics.criticalAlerts++;
      } else {
        metrics.warningAlerts++;
      }

      // Determine likely cause
      let likelyCause = 'Unknown';
      if (step.status === StepStatus.IN_PROGRESS_RETRYING) {
        likelyCause = 'Multiple Lambda failures - check retry logic and error handling';
      } else if (step.retryCount > 0) {
        likelyCause = 'Lambda timeout or crash without callback';
      } else {
        likelyCause = 'SQS visibility timeout issue or Lambda not invoking';
      }

      // Look up per-step timeout from workflow definition
      const stepDef = step.job?.type
        ? this.workflowConfig.getStepDefinition(step.job.type, step.stepValue)
        : undefined;
      const stepTimeoutMs = stepDef?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      findings.push({
        severity,
        description: `Step stuck in ${step.status} for ${stuckMinutes} minutes (per-step timeout: ${Math.round(stepTimeoutMs / 60000)}min)`,
        subjectId: step.id,
        subjectType: 'step',
        context: {
          jobId: step.job?.id,
          stepValue: step.stepValue,
          status: step.status,
          startedAt: step.startedAt,
          stuckMinutes,
          stepTimeoutMs,
          retryCount: step.retryCount,
          maxRetryCount: step.maxRetryCount,
          lambdaFunction: step.lambdaFunctionName,
          likelyCause,
        },
      });

      // Auto-fail if enabled AND step has exceeded its per-step timeout
      if (effectiveAutoFail && stuckMs > stepTimeoutMs) {
        const jobId = step.job?.id;
        if (!jobId || step.job.status !== JobStatus.PROCESSING) {
          metrics.autoFailSkipped++;
          actions.push({
            type: 'alert',
            description: `Would auto-fail but job is ${step.job?.status ?? 'unknown'} — skipped`,
            subjectId: step.id,
          });
          continue;
        }

        try {
          this.logger.warn(
            `Auto-failing step ${step.id} (${step.stepValue}) — stuck in ${step.status} for ${stuckMinutes}min (timeout: ${Math.round(stepTimeoutMs / 60000)}min)`,
          );

          await this.stepRepository.update(step.id, {
            status: StepStatus.FAILED,
            error: `Auto-failed by maintenance task: step exceeded ${Math.round(stepTimeoutMs / 60000)} minute timeout (stuck for ${stuckMinutes} minutes). Likely cause: ${likelyCause}`,
            completedAt: new Date(),
          });

          await this.orchestrationService.continueJob(jobId);

          actions.push({
            type: 'auto-fix',
            description: `Auto-failed step after ${stuckMinutes}min (per-step timeout: ${Math.round(stepTimeoutMs / 60000)}min)`,
            subjectId: step.id,
            result: 'success',
            context: { jobId, stepValue: step.stepValue },
          });

          metrics.autoFailed++;
        } catch (error) {
          this.logger.error(`Failed to auto-fail step ${step.id}:`, error);

          actions.push({
            type: 'auto-fix',
            description: `Auto-fail failed: ${error.message}`,
            subjectId: step.id,
            result: 'failed',
          });
        }
      } else if (effectiveAutoFail && stuckMs <= stepTimeoutMs) {
        // Detected by global threshold but not yet exceeded per-step timeout
        metrics.autoFailSkipped++;
        actions.push({
          type: 'alert',
          description: `Detected but within per-step timeout (${Math.round(stepTimeoutMs / 60000)}min) — monitoring. ${likelyCause}`,
          subjectId: step.id,
          context: {
            recommendation: this.getRecommendation(step, stuckMinutes),
          },
        });
      } else {
        // Auto-fail disabled — alert only
        actions.push({
          type: 'alert',
          description: `Auto-fail disabled. Operations team should investigate: ${likelyCause}`,
          subjectId: step.id,
          context: {
            recommendation: this.getRecommendation(step, stuckMinutes),
          },
        });
      }
    }

    return {
      success: true,
      message: `Found ${metrics.stuckStepsFound} stuck steps (${metrics.autoFailed} auto-failed, ${metrics.autoFailSkipped} below per-step timeout, ${metrics.criticalAlerts} critical, ${metrics.warningAlerts} warnings)`,
      findings,
      actions,
      metrics,
    };
  }

  /**
   * Get troubleshooting recommendation based on step state
   */
  private getRecommendation(step: Step, stuckMinutes: number): string {
    if (stuckMinutes > 120) {
      return 'URGENT: Step has been stuck >2 hours — investigate immediately';
    }

    if (step.status === StepStatus.IN_PROGRESS_RETRYING) {
      return 'Check Lambda error logs and SQS retry configuration';
    }

    if (step.retryCount > 0) {
      return 'Check Lambda execution time and timeout settings';
    }

    return 'Check SQS queue depth and Lambda event source mapping';
  }
}
