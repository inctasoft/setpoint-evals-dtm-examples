import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Step, StepStatus } from '@dtm/database';

export interface ThroughputBucket {
  /** ISO-8601, minute-truncated (UTC), the start of the bucket. */
  bucket: string;
  completed: number;
  failed: number;
}

export interface ThroughputResponse {
  windowMinutes: number;
  workflow: string | null;
  buckets: ThroughputBucket[];
  totalCompleted: number;
  totalFailed: number;
}

const MIN_WINDOW_MINUTES = 1;
const MAX_WINDOW_MINUTES = 24 * 60;
const DEFAULT_WINDOW_MINUTES = 30;

/**
 * MetricsService — backs the monitor's "Throughput" tab (steps-per-minute
 * mini-chart). Deliberately reads `dtm_steps.completed_at` directly (not a
 * derived/cached counter) so it can never drift from the same rows the Job
 * Detail / Payloads panels show.
 */
@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(Step)
    private readonly stepRepo: Repository<Step>,
  ) {}

  /** Clamp to a sane range — an unbounded window would let a client force a full-table scan. */
  static normalizeWindowMinutes(raw: unknown): number {
    const parsed = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WINDOW_MINUTES;
    return Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, Math.floor(parsed)));
  }

  async getThroughput(windowMinutesRaw: unknown, workflow?: string): Promise<ThroughputResponse> {
    const windowMinutes = MetricsService.normalizeWindowMinutes(windowMinutesRaw);
    const since = new Date(Date.now() - windowMinutes * 60_000);

    const qb = this.stepRepo
      .createQueryBuilder('step')
      .leftJoin('step.job', 'job')
      .select("date_trunc('minute', step.completedAt)", 'bucket')
      .addSelect(`COUNT(*) FILTER (WHERE step.status = :completedStatus)`, 'completed')
      .addSelect(`COUNT(*) FILTER (WHERE step.status = :failedStatus)`, 'failed')
      .where('step.completedAt IS NOT NULL')
      .andWhere('step.completedAt >= :since', { since })
      .setParameters({
        completedStatus: StepStatus.COMPLETED,
        failedStatus: StepStatus.FAILED,
      })
      .groupBy("date_trunc('minute', step.completedAt)")
      .orderBy("date_trunc('minute', step.completedAt)", 'ASC');

    if (workflow) {
      qb.andWhere('job.workflowName = :workflow', { workflow });
    }

    const rows = await qb.getRawMany<{ bucket: Date; completed: string; failed: string }>();

    const buckets: ThroughputBucket[] = rows.map((r) => ({
      bucket: new Date(r.bucket).toISOString(),
      completed: Number(r.completed) || 0,
      failed: Number(r.failed) || 0,
    }));

    const totalCompleted = buckets.reduce((sum, b) => sum + b.completed, 0);
    const totalFailed = buckets.reduce((sum, b) => sum + b.failed, 0);

    return {
      windowMinutes,
      workflow: workflow ?? null,
      buckets,
      totalCompleted,
      totalFailed,
    };
  }
}
