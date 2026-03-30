import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Advisory Lock Service
 *
 * Provides distributed mutex semantics using PostgreSQL session-scoped advisory locks.
 * `pg_try_advisory_lock` is non-blocking — it returns false immediately if the lock
 * is already held by another session, instead of waiting.
 *
 * Properties:
 * - Crash-safe: locks are automatically released when the PostgreSQL connection drops
 * - Non-blocking: failed acquisitions return immediately (no queuing)
 * - Zero infrastructure: uses the existing dtm PostgreSQL connection
 *
 * Usage (in a @Cron task):
 *   const acquired = await this.advisoryLock.tryAcquire(LockId.STUCK_ACK);
 *   if (!acquired) return;
 *   try { await this.run(); }
 *   finally { await this.advisoryLock.release(LockId.STUCK_ACK); }
 */
@Injectable()
export class AdvisoryLockService {
  private readonly logger = new Logger(AdvisoryLockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Attempt to acquire a session-scoped advisory lock.
   * Returns true if the lock was acquired, false if another session holds it.
   */
  async tryAcquire(lockId: number): Promise<boolean> {
    const result = await this.dataSource.query<[{ pg_try_advisory_lock: boolean }]>(
      'SELECT pg_try_advisory_lock($1)',
      [lockId],
    );
    const acquired = result[0]?.pg_try_advisory_lock === true;
    if (!acquired) {
      this.logger.debug(`Advisory lock ${lockId} not acquired — another instance holds it`);
    }
    return acquired;
  }

  /**
   * Release a previously acquired session-scoped advisory lock.
   */
  async release(lockId: number): Promise<void> {
    await this.dataSource.query('SELECT pg_advisory_unlock($1)', [lockId]);
  }
}

/**
 * Stable lock IDs for each maintenance task.
 * These must never change — doing so would allow two instances to run
 * the same task simultaneously during a rolling deploy.
 */
export const LockId = {
  STUCK_ACKNOWLEDGEMENT: 1001,
  ORPHANED_JOB_RECOVERY: 1002,
  STUCK_IN_PROGRESS: 1003,
  OLD_JOB_CLEANUP: 1004,
  HEALTH_METRICS: 1005,
  STUCK_WAITING_FOR_CHILDREN: 1006,
  STUCK_DELEGATED: 1007,
  STUCK_PENDING: 1008,
} as const;
