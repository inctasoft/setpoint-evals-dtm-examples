import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
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
import { CascadePublishService } from '../../orchestration/cascade-publish.service';
import { EventBus, isEventRepublishScanActive } from '../../event-bus/event-bus.interface';

/**
 * Event Republish Scan Task (Phase 3 of the bus-agnosticism program — the
 * A5 gap-closer).
 *
 * Under a drop-realistic event bus (zmq PUB/SUB), a publish fired while no
 * subscriber is attached vanishes silently. Without this task the step sits
 * WAITING_FOR_ACK until the 30-minute stuck-acknowledgement task auto-FAILS
 * it (and checkAndExecutePendingPublishSteps only re-fires from incoming
 * ACKs). On a short cadence this scan:
 *
 *   A. re-publishes WAITING_FOR_ACK steps whose kafka_published_at is older
 *      than EVENT_REPUBLISH_LEASE_SECONDS (dropped publish OR dropped ack —
 *      the re-publish is idempotent: a duplicate ACK is claim-guarded), and
 *   B. re-fires the pending-publish check per affected job for COMPLETED
 *      output steps with kafka_published_at IS NULL.
 *
 * ACTIVATION (fail-closed): a total no-op unless the active event bus
 * declares `droppedPublishRecovery: 'orchestrator'` OR the
 * EVENT_REPUBLISH_SCAN_FORCE_ENABLED escape hatch is set (setpoint evals).
 * Under the default Kafka bus nothing here fires and the 30-minute
 * stuck-ack behavior is byte-identical to pre-Phase-3.
 *
 * Column note: the marker stays named kafka_published_at (a rename to a
 * bus-neutral event_published_at was considered and rejected as not cheap:
 * entity + migration + every reader; the name is documented here and in
 * CLAUDE.md as the bus-neutral publish marker).
 *
 * Configuration:
 * - EVENT_REPUBLISH_SCAN_FORCE_ENABLED: force-enable the scan (default: false)
 * - EVENT_REPUBLISH_LEASE_SECONDS: un-ACKed publish age before re-publish (default: 60)
 */
@Injectable()
export class EventRepublishScanTask extends BaseMaintenanceTask {
  constructor(
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly cascadePublishService: CascadePublishService,
    private readonly eventBus: EventBus,
    advisoryLock: AdvisoryLockService, // passed to super() only — not stored (avoids TS2415: 'private advisoryLock' can't be redeclared over the base class's)
  ) {
    super('EventRepublishScanTask', advisoryLock);

    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'event-republish-scan',
      description:
        'Dropped-publish recovery: re-publishes un-ACKed WAITING_FOR_ACK steps past their lease and re-fires pending publishes (active only when the event bus declares orchestrator dropped-publish recovery or EVENT_REPUBLISH_SCAN_FORCE_ENABLED=true)',
      schedule: CronExpression.EVERY_30_SECONDS,
      priority: 90,
      category: 'recovery',
      timeoutMs: 60000,
      enabled: true,
      lockId: LockId.EVENT_REPUBLISH_SCAN,
    };
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduledRun() {
    await this.execute();
  }

  /**
   * Fail-closed gate: no scan, no re-publish unless the scan is active for
   * this deployment (drops-realistic bus or the escape hatch).
   */
  override canRun(): Promise<boolean> {
    const metadata = this.getMetadata();
    if (!metadata.enabled) {
      this.logger.log(`Task ${metadata.name} is disabled`);
      return Promise.resolve(false);
    }

    const forceEnabled =
      this.configService.get<string>('EVENT_REPUBLISH_SCAN_FORCE_ENABLED', 'false') === 'true';
    return Promise.resolve(isEventRepublishScanActive(this.eventBus.capabilities, forceEnabled));
  }

  protected async doExecute(): Promise<TaskResult> {
    const findings: TaskFinding[] = [];
    const actions: TaskAction[] = [];
    const metrics: Record<string, number> = {
      expiredPublishesFound: 0,
      republished: 0,
      pendingPublished: 0,
      skipped: 0,
      failed: 0,
    };

    const leaseSeconds = parseInt(
      this.configService.get<string>('EVENT_REPUBLISH_LEASE_SECONDS', '60'),
      10,
    );
    const cutoff = new Date(Date.now() - leaseSeconds * 1000);

    // A. Un-ACKed publishes past the lease (dropped publish or dropped ack)
    const expiredSteps = await this.stepRepository.find({
      where: {
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: LessThan(cutoff),
      },
      relations: ['job'],
      order: { kafkaPublishedAt: 'ASC' },
    });

    metrics.expiredPublishesFound = expiredSteps.length;

    for (const step of expiredSteps) {
      const jobId = step.job?.id;

      if (!jobId) {
        this.logger.error(`Cannot re-publish step ${step.id}: job relation not loaded`);
        metrics.failed++;
        continue;
      }

      // Terminal guard: only jobs still in flight get re-publishes.
      if (step.job.status !== JobStatus.PROCESSING) {
        this.logger.debug(`Skipping step ${step.id}: job ${jobId} is already ${step.job.status}`);
        metrics.skipped++;
        continue;
      }

      findings.push({
        severity: 'warning',
        description: `Un-ACKed publish past lease (${leaseSeconds}s) — re-publishing`,
        subjectId: step.id,
        subjectType: 'step',
        context: {
          jobId,
          stepValue: step.stepValue,
          kafkaPublishedAt: step.kafkaPublishedAt,
        },
      });

      try {
        const republished = await this.cascadePublishService.republishStepEvent(step);

        actions.push({
          type: 'auto-fix',
          description: republished
            ? 'Re-published un-ACKed step event (dropped-publish recovery)'
            : 'Re-publish skipped (nothing honest to re-publish)',
          subjectId: step.id,
          result: republished ? 'success' : 'failed',
          context: { jobId, stepValue: step.stepValue },
        });

        if (republished) {
          metrics.republished++;
        } else {
          metrics.skipped++;
        }
      } catch (error) {
        this.logger.error(`Failed to re-publish step ${step.id}:`, error);
        metrics.failed++;
      }
    }

    // B. Pending publishes that never fired (per affected job)
    const pendingSteps = await this.stepRepository.find({
      where: {
        status: StepStatus.COMPLETED,
        kafkaPublishedAt: IsNull(),
      },
      relations: ['job'],
    });

    const jobIds = new Set<string>();
    for (const step of pendingSteps) {
      if (step.job?.id && step.job.status === JobStatus.PROCESSING) {
        jobIds.add(step.job.id);
      }
    }

    for (const jobId of jobIds) {
      try {
        const result = await this.cascadePublishService.checkAndExecutePendingPublishSteps(jobId);
        metrics.pendingPublished += result.publishedSteps;

        if (result.publishedSteps > 0) {
          actions.push({
            type: 'auto-fix',
            description: `Re-fired pending publish for ${result.publishedSteps} step(s)`,
            subjectId: jobId,
            result: 'success',
            context: { jobId },
          });
        }
      } catch (error) {
        this.logger.error(`Failed pending-publish check for job ${jobId}:`, error);
        metrics.failed++;
      }
    }

    return {
      success: true,
      message: `Found ${metrics.expiredPublishesFound} un-ACKed publishes past lease, re-published ${metrics.republished}, pending-published ${metrics.pendingPublished}, skipped ${metrics.skipped}, failed ${metrics.failed}`,
      findings,
      actions,
      metrics,
    };
  }
}
