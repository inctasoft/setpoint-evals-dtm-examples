import { Logger } from '@nestjs/common';
import {
  IMaintenanceTask,
  TaskMetadata,
  TaskResult,
} from '../interfaces/maintenance-task.interface';
import { AdvisoryLockService } from '../advisory-lock.service';

/**
 * Base Maintenance Task
 *
 * Abstract base class that all maintenance tasks extend.
 * Provides common functionality:
 * - Logging
 * - Execution timing
 * - Timeout protection
 * - Error handling
 * - Cleanup hooks
 * - **Postgres advisory-lock leader election (LEADER-1)** — when the subclass's
 *   `getMetadata().lockId` is set, `execute()` runs the timed body inside
 *   `AdvisoryLockService.runExclusive(lockId, ...)`. This guards BOTH the
 *   `@Cron`-scheduled path AND the manual-trigger API path (both call
 *   `execute()`), so two concurrent executions of the same task — whether
 *   two replicas' cron ticks or two overlapping manual API calls — never
 *   run their bodies at the same time. The loser returns a distinguishable
 *   "skipped — leader lock held" result instead of racing the winner.
 */
export abstract class BaseMaintenanceTask implements IMaintenanceTask {
  protected readonly logger: Logger;

  constructor(
    loggerContext: string,
    private readonly advisoryLock?: AdvisoryLockService,
  ) {
    this.logger = new Logger(loggerContext);
  }

  /**
   * Subclasses must implement metadata
   * This defines the task's configuration, schedule, category, etc.
   */
  abstract getMetadata(): TaskMetadata;

  /**
   * Subclasses must implement execution logic
   * This is where the actual work happens
   */
  protected abstract doExecute(options?: Record<string, any>): Promise<TaskResult>;

  /**
   * Default implementation - can be overridden
   * Checks if task is enabled via metadata
   */
  canRun(): Promise<boolean> {
    const metadata = this.getMetadata();

    if (!metadata.enabled) {
      this.logger.log(`Task ${metadata.name} is disabled`);
      return Promise.resolve(false);
    }

    return Promise.resolve(true);
  }

  /**
   * Execute the task with timing, error handling, and timeout protection
   * This is the main entry point called by the scheduler
   */
  async execute(options?: Record<string, any>): Promise<TaskResult> {
    const metadata = this.getMetadata();
    const startTime = Date.now();

    this.logger.log(`🚀 Starting task: ${metadata.name}`);

    try {
      // Check if we can run
      const canRun = await this.canRun();
      if (!canRun) {
        return {
          success: true,
          message: 'Task skipped (canRun returned false)',
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Execute the task with timeout protection, gated by the advisory lock
      // (LEADER-1) when this task opts in via metadata.lockId.
      const result = await this.executeGuarded(metadata, options);
      if (result === null) {
        // Another replica/concurrent caller holds the leader lock — no-op.
        const message = 'Skipped — leader lock held by another replica or in-flight execution';
        this.logger.log(`🪪 ${metadata.name}: ${message}`);
        return {
          success: true,
          message,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Add execution time to result
      result.executionTimeMs = Date.now() - startTime;

      // Log appropriate message based on success
      if (result.success) {
        this.logger.log(`✅ Task ${metadata.name} completed successfully: ${result.message}`);
        if (result.metrics) {
          this.logger.debug(`📊 MetricsTest: ${JSON.stringify(result.metrics, null, 2)}`);
        }
      } else {
        this.logger.warn(`⚠️ Task ${metadata.name} completed with warnings: ${result.message}`);
      }

      return result;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      this.logger.error(
        `❌ Task ${metadata.name} failed after ${executionTimeMs}ms:`,
        error.stack || error.message,
      );

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      return {
        success: false,
        message: `Task failed with error: ${errorMessage}`,
        error: errorStack || errorMessage,
        executionTimeMs,
      };
    } finally {
      // Optional cleanup
      if (this.cleanup) {
        try {
          await this.cleanup();
        } catch (cleanupError) {
          this.logger.error(`Cleanup failed for ${metadata.name}:`, cleanupError);
        }
      }
    }
  }

  /**
   * Run `executeWithTimeout` gated by the advisory lock (LEADER-1) when
   * `metadata.lockId` is set and an `AdvisoryLockService` was injected.
   * Returns `null` when the lock was held elsewhere (caller treats that as skip).
   * Falls back to running unguarded when no lock is configured — this keeps
   * unit tests that construct a `BaseMaintenanceTask` subclass without an
   * `AdvisoryLockService` working unchanged.
   */
  private async executeGuarded(
    metadata: TaskMetadata,
    options?: Record<string, any>,
  ): Promise<TaskResult | null> {
    if (this.advisoryLock && metadata.lockId !== undefined) {
      return this.advisoryLock.runExclusive(metadata.lockId, () =>
        this.executeWithTimeout(metadata.timeoutMs, options),
      );
    }
    return this.executeWithTimeout(metadata.timeoutMs, options);
  }

  /**
   * Execute task with timeout protection
   * Uses Promise.race to kill task if it exceeds timeout
   */
  private async executeWithTimeout(
    timeoutMs: number,
    options?: Record<string, any>,
  ): Promise<TaskResult> {
    return Promise.race([
      this.doExecute(options),
      new Promise<TaskResult>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Task timeout after ${timeoutMs}ms - exceeded maximum execution time`),
            ),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Optional cleanup hook
   * Override this if your task needs cleanup (close connections, release locks, etc.)
   */
  async cleanup?(): Promise<void>;
}
