import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, In, LessThan } from 'typeorm';
import { Job, Step, JobStatus, StepStatus } from '@dtm/database';
import { ConfigService } from '@nestjs/config';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';
import { TaskMetadata, TaskResult } from '../interfaces/maintenance-task.interface';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';

/**
 * Health Metrics Task
 *
 * Generates operational health metrics for monitoring dashboards.
 *
 * Metrics generated:
 * - Job counts by status (active, pending, completed, failed)
 * - Success rates (hourly, daily)
 * - Processing throughput
 * - Step health indicators
 * - Potential issues (stuck steps, retries, etc.)
 *
 * These metrics can be:
 * - Logged for scraping by monitoring tools
 * - Exported to CloudWatch/Datadog/Prometheus
 * - Displayed in dashboards
 * - Used for alerting
 *
 * Future enhancements:
 * - CloudWatch Metrics integration
 * - Datadog APM integration
 * - Prometheus /metrics endpoint
 * - Historical trend analysis
 * - Performance SLO tracking
 */
@Injectable()
export class HealthMetricsTask extends BaseMaintenanceTask {
  constructor(
    @InjectRepository(Job)
    private readonly jobRepository: Repository<Job>,
    @InjectRepository(Step)
    private readonly stepRepository: Repository<Step>,
    private readonly configService: ConfigService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly advisoryLock: AdvisoryLockService,
  ) {
    super('HealthMetricsTask');
    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'health-metrics',
      description: 'Generates operational health metrics for monitoring dashboards',
      schedule: CronExpression.EVERY_5_MINUTES,
      priority: 50,
      category: 'metrics',
      timeoutMs: 30000, // 30 seconds
      enabled: true,
    };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledRun() {
    const acquired = await this.advisoryLock.tryAcquire(LockId.HEALTH_METRICS);
    if (!acquired) return;
    try {
      await this.execute();
    } finally {
      await this.advisoryLock.release(LockId.HEALTH_METRICS);
    }
  }

  protected async doExecute(): Promise<TaskResult> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);
    const last5Minutes = new Date(now.getTime() - 5 * 60 * 1000);

    // Generate comprehensive metrics
    const metrics: Record<string, number> = {
      // === Total Jobs (all time) ===
      totalJobs: await this.jobRepository.count(),

      // === Current State ===
      activeJobs: await this.jobRepository.count({
        where: { status: JobStatus.PROCESSING },
      }),

      pendingJobs: await this.jobRepository.count({
        where: { status: JobStatus.PENDING },
      }),

      // === Last 5 Minutes (Real-time throughput) ===
      jobsCompletedLast5min: await this.jobRepository.count({
        where: {
          status: JobStatus.COMPLETED,
          completedAt: MoreThan(last5Minutes),
        },
      }),

      jobsFailedLast5min: await this.jobRepository.count({
        where: {
          status: JobStatus.FAILED,
          completedAt: MoreThan(last5Minutes),
        },
      }),

      // === Last Hour ===
      jobsCompletedLastHour: await this.jobRepository.count({
        where: {
          status: JobStatus.COMPLETED,
          completedAt: MoreThan(lastHour),
        },
      }),

      jobsFailedLastHour: await this.jobRepository.count({
        where: {
          status: JobStatus.FAILED,
          completedAt: MoreThan(lastHour),
        },
      }),

      // === Last 24 Hours ===
      jobsCompletedLast24h: await this.jobRepository.count({
        where: {
          status: JobStatus.COMPLETED,
          completedAt: MoreThan(last24Hours),
        },
      }),

      jobsFailedLast24h: await this.jobRepository.count({
        where: {
          status: JobStatus.FAILED,
          completedAt: MoreThan(last24Hours),
        },
      }),

      // === Step Health ===
      stepsInProgress: await this.stepRepository.count({
        where: { status: StepStatus.IN_PROGRESS },
      }),

      stepsRetrying: await this.stepRepository.count({
        where: { status: StepStatus.IN_PROGRESS_RETRYING },
      }),

      stepsWaitingForAck: await this.stepRepository.count({
        where: { status: StepStatus.WAITING_FOR_ACK },
      }),

      stepsDelegated: await this.stepRepository.count({
        where: { status: StepStatus.DELEGATED },
      }),

      // === Potential Issues ===
      stuckAcknowledgements: await this.stepRepository.count({
        where: {
          status: StepStatus.WAITING_FOR_ACK,
          kafkaPublishedAt: LessThan(new Date(now.getTime() - 15 * 60 * 1000)), // >15 min
        },
      }),

      stuckInProgress: await this.stepRepository.count({
        where: {
          status: In([StepStatus.IN_PROGRESS, StepStatus.IN_PROGRESS_RETRYING]),
          startedAt: LessThan(new Date(now.getTime() - 30 * 60 * 1000)), // >30 min
        },
      }),

      stuckDelegated: await this.stepRepository.count({
        where: {
          status: StepStatus.DELEGATED,
          startedAt: LessThan(new Date(now.getTime() - 5 * 60 * 1000)), // >5 min
        },
      }),
    };

    // Calculate derived metrics

    // Success rates
    const totalJobsLastHour = metrics.jobsCompletedLastHour + metrics.jobsFailedLastHour;
    metrics.successRateLastHour =
      totalJobsLastHour > 0
        ? Math.round((metrics.jobsCompletedLastHour / totalJobsLastHour) * 100)
        : 0;

    const totalJobsLast24h = metrics.jobsCompletedLast24h + metrics.jobsFailedLast24h;
    metrics.successRateLast24h =
      totalJobsLast24h > 0
        ? Math.round((metrics.jobsCompletedLast24h / totalJobsLast24h) * 100)
        : 0;

    // Throughput (jobs per hour, extrapolated from last 5 minutes)
    metrics.jobThroughputPerHour = metrics.jobsCompletedLast5min * 12; // 5min * 12 = 1 hour

    // Total issues
    metrics.totalIssues =
      metrics.stuckAcknowledgements + metrics.stuckInProgress + metrics.stuckDelegated;

    // Health score (0-100, lower if issues detected)
    metrics.healthScore = this.calculateHealthScore(metrics);

    // Log metrics in structured format (can be scraped by monitoring tools)
    this.logger.log(`📊 Health Metrics Report:`);
    this.logger.log(`  🔄 Active Jobs: ${metrics.activeJobs}`);
    this.logger.log(`  ✅ Success Rate (24h): ${metrics.successRateLast24h}%`);
    this.logger.log(`  📈 Throughput: ${metrics.jobThroughputPerHour} jobs/hour (projected)`);
    this.logger.log(
      `  ⚠️  Issues: ${metrics.totalIssues} (stuck acks: ${metrics.stuckAcknowledgements}, stuck in-progress: ${metrics.stuckInProgress})`,
    );
    this.logger.log(`  🏥 Health Score: ${metrics.healthScore}/100`);

    // Log full metrics as JSON for parsing by monitoring tools
    this.logger.debug(`Full metrics: ${JSON.stringify(metrics, null, 2)}`);

    // TODO: Export to external monitoring systems
    // await this.exportToCloudWatch(metrics);
    // await this.exportToDatadog(metrics);
    // await this.exportToPrometheus(metrics);

    return {
      success: true,
      message: `Generated health metrics (${totalJobsLast24h} jobs in last 24h, ${metrics.successRateLast24h}% success rate, health score: ${metrics.healthScore}/100)`,
      metrics,
    };
  }

  /**
   * Calculate overall health score (0-100)
   * Factors:
   * - Success rate (weight: 40%)
   * - Active issues (weight: 30%)
   * - Throughput (weight: 20%)
   * - System responsiveness (weight: 10%)
   */
  private calculateHealthScore(metrics: Record<string, number>): number {
    let score = 100;

    // Success rate impact (max -40 points)
    const successRate = metrics.successRateLast24h || 100;
    score -= (100 - successRate) * 0.4;

    // Active issues impact (max -30 points)
    const issueScore = Math.min(metrics.totalIssues * 5, 30);
    score -= issueScore;

    // Stuck acknowledgements are critical (additional -10 per stuck ack)
    score -= metrics.stuckAcknowledgements * 10;

    // Active job backlog impact (max -20 points)
    if (metrics.activeJobs > 50) {
      score -= Math.min((metrics.activeJobs - 50) / 5, 20);
    }

    // Pending job backlog impact (max -10 points)
    if (metrics.pendingJobs > 20) {
      score -= Math.min((metrics.pendingJobs - 20) / 2, 10);
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Example: Export metrics to CloudWatch
   * Uncomment and implement when CloudWatch integration is needed
   */
  /*
  private async exportToCloudWatch(
    metrics: Record<string, number>,
  ): Promise<void> {
    const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
    const cloudwatch = new CloudWatchClient({});

    const metricData = Object.entries(metrics).map(([name, value]) => ({
      MetricName: name,
      Value: value,
      Unit: name.includes('Rate') || name.includes('Score') ? 'Percent' : 'Count',
      Timestamp: new Date(),
    }));

    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: 'DTM/Health',
        MetricData: metricData,
      }),
    );

    this.logger.log(`✅ Exported ${metricData.length} metrics to CloudWatch`);
  }
  */

  /**
   * Example: Export metrics to Datadog
   * Uncomment and implement when Datadog integration is needed
   */
  /*
  private async exportToDatadog(
    metrics: Record<string, number>,
  ): Promise<void> {
    const { StatsD } = require('node-dogstatsd');
    const dogstatsd = new StatsD();

    for (const [name, value] of Object.entries(metrics)) {
      dogstatsd.gauge(`dtm.${name}`, value);
    }

    this.logger.log(`✅ Exported ${Object.keys(metrics).length} metrics to Datadog`);
  }
  */
}
