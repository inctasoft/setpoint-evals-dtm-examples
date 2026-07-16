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
 * ⚠️ Session-pinning is mandatory (LEADER-1).
 * `pg_try_advisory_lock` is scoped to the *connection* that acquired it, and is
 * re-entrant on that same connection. A pool-backed `DataSource.query()` call
 * borrows a connection, runs one statement, and returns it to the pool — the
 * acquire and a later release are NOT guaranteed to run on the same physical
 * connection, and neither is a concurrent competitor's acquire. That makes a
 * naive "acquire via query(), release via query()" pair pool-nondeterministic:
 * a second caller can be handed the very connection the first caller just
 * returned to the pool (still holding the lock) and re-enter for free —
 * "exactly one execution" becomes a coin flip that depends on pool scheduling.
 * `runExclusive` avoids this by pinning a single `QueryRunner` (one physical
 * connection) for the whole acquire → fn → release span.
 *
 * Usage:
 *   const result = await this.advisoryLock.runExclusive(LockId.STUCK_ACKNOWLEDGEMENT, () => this.run());
 *   if (result === null) { // leader lock held elsewhere — skipped this tick }
 */
@Injectable()
export class AdvisoryLockService {
  private readonly logger = new Logger(AdvisoryLockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Run `fn` while holding a session-scoped Postgres advisory lock keyed on `lockId`.
   *
   * Pins one `QueryRunner` (one physical connection) for the whole
   * acquire → fn → release span, so the lock can never be released from — or
   * re-entered via — a different connection than the one that acquired it.
   *
   * Returns `fn`'s result, or `null` if another session already holds the lock
   * (the caller should treat `null` as "skipped — leader elsewhere").
   */
  async runExclusive<T>(lockId: number, fn: () => Promise<T>): Promise<T | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const acquireResult: Array<{ got: boolean }> = await queryRunner.query(
        'SELECT pg_try_advisory_lock($1) AS got',
        [lockId],
      );
      const acquired = acquireResult[0]?.got === true;
      if (!acquired) {
        this.logger.debug(`Advisory lock ${lockId} not acquired — another instance holds it`);
        return null;
      }
      try {
        return await fn();
      } finally {
        try {
          await queryRunner.query('SELECT pg_advisory_unlock($1)', [lockId]);
        } catch (releaseError) {
          const msg = releaseError instanceof Error ? releaseError.message : String(releaseError);
          this.logger.warn(`Failed to release advisory lock ${lockId}: ${msg}`);
        }
      }
    } finally {
      await queryRunner.release();
    }
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
