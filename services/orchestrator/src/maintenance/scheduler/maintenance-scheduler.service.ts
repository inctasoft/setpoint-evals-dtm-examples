import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { TaskResult } from '../interfaces/maintenance-task.interface';

/**
 * Task execution record for history tracking
 */
export interface TaskExecutionRecord {
  taskName: string;
  timestamp: Date;
  triggerType: 'scheduled' | 'manual' | 'bulk';
  result: TaskResult;
}

/**
 * Maintenance Scheduler Service
 *
 * Orchestrates maintenance task execution:
 * - Manages scheduled task execution (via @Cron decorators in tasks)
 * - Provides manual task execution API
 * - Tracks execution history
 * - Supports bulk category execution
 */
@Injectable()
export class MaintenanceSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceSchedulerService.name);
  private readonly executionHistory = new Map<string, TaskExecutionRecord[]>();
  private isSchedulerEnabled: boolean;
  private readonly maxHistoryPerTask = 100; // Keep last 100 executions per task

  constructor(
    private readonly taskRegistry: MaintenanceTaskRegistry,
    private readonly configService: ConfigService,
  ) {
    this.isSchedulerEnabled =
      this.configService.get<string>('MAINTENANCE_SCHEDULER_ENABLED', 'true') === 'true';
  }

  async onModuleInit() {
    if (!this.isSchedulerEnabled) {
      this.logger.warn('⏸️  Maintenance scheduler is DISABLED');
      this.logger.warn('   Set MAINTENANCE_SCHEDULER_ENABLED=true to enable scheduled tasks');
      this.logger.warn('   Tasks can still be executed manually via API endpoints');
      return Promise.resolve();
    }

    this.logger.log('⚙️  Maintenance scheduler is ENABLED');
    this.logSchedulerStatus();
    return Promise.resolve();
  }

  /**
   * Execute a task manually (for API triggers)
   */
  async executeTaskManually(taskName: string, options?: Record<string, any>): Promise<TaskResult> {
    this.logger.log(`🔧 Manual execution requested for: ${taskName}`);

    const task = this.taskRegistry.getTask(taskName);
    if (!task) {
      throw new Error(`Task not found: ${taskName}`);
    }

    // Security: Only allow execution options if simulation/overrides are enabled
    // TODO: Refactor this logic if production use cases arise.
    // Currently, 'options' are treated as test-only overrides (e.g., custom timeouts for E2E tests).
    // If we need safe, production-grade options in the future, we should:
    // 1. Separate 'testOptions' from 'runtimeOptions' in the API DTO.
    // 2. Validate 'runtimeOptions' strictly against a whitelist.
    // 3. Continue guarding 'testOptions' with the ENABLE_REQUESTS_FOR_SIMULATED_DELAYS flag.
    let effectiveOptions = options;
    if (options && Object.keys(options).length > 0) {
      const areOverridesEnabled =
        this.configService.get<string>('ENABLE_REQUESTS_FOR_SIMULATED_DELAYS', 'false') === 'true';

      if (!areOverridesEnabled) {
        this.logger.warn(
          `⚠️ Execution options provided for task ${taskName} but ENABLE_REQUESTS_FOR_SIMULATED_DELAYS is not enabled. Ignoring options to prevent abuse.`,
        );
        effectiveOptions = undefined;
      }
    }

    const result = await task.execute(effectiveOptions);

    // Record execution
    this.recordExecution(taskName, result, 'manual');

    return result;
  }

  /**
   * Execute all tasks in a category (for bulk operations)
   */
  async executeCategory(category: string): Promise<Map<string, TaskResult>> {
    this.logger.log(`🔧 Executing all tasks in category: ${category}`);

    const tasks = this.taskRegistry.getTasksByCategory(category);

    if (tasks.length === 0) {
      this.logger.warn(`No tasks found in category: ${category}`);
      return new Map();
    }

    const results = new Map<string, TaskResult>();

    // Execute tasks in priority order
    const sortedTasks = tasks.sort((a, b) => b.getMetadata().priority - a.getMetadata().priority);

    for (const task of sortedTasks) {
      const metadata = task.getMetadata();

      try {
        const result = await task.execute();
        results.set(metadata.name, result);

        this.recordExecution(metadata.name, result, 'bulk');
      } catch (error) {
        this.logger.error(`Failed to execute task ${metadata.name} in bulk operation:`, error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorResult: TaskResult = {
          success: false,
          message: `Bulk execution failed: ${errorMessage}`,
          error: errorStack || errorMessage,
        };

        results.set(metadata.name, errorResult);
        this.recordExecution(metadata.name, errorResult, 'bulk');
      }
    }

    return results;
  }

  /**
   * Execute all enabled tasks (emergency recovery operation)
   */
  async executeAllEnabled(): Promise<Map<string, TaskResult>> {
    this.logger.log('🚨 Executing ALL enabled tasks (emergency operation)');

    const tasks = this.taskRegistry.getEnabledTasks();
    const results = new Map<string, TaskResult>();

    // Execute in priority order
    const sortedTasks = tasks.sort((a, b) => b.getMetadata().priority - a.getMetadata().priority);

    for (const task of sortedTasks) {
      const metadata = task.getMetadata();

      try {
        this.logger.log(`  Executing: ${metadata.name}...`);
        const result = await task.execute();
        results.set(metadata.name, result);

        this.recordExecution(metadata.name, result, 'bulk');
      } catch (error) {
        this.logger.error(`  Failed: ${metadata.name}`, error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorResult: TaskResult = {
          success: false,
          message: `Execution failed: ${errorMessage}`,
          error: errorStack || errorMessage,
        };

        results.set(metadata.name, errorResult);
        this.recordExecution(metadata.name, errorResult, 'bulk');
      }
    }

    return results;
  }

  /**
   * Get execution history for a task
   */
  getExecutionHistory(taskName: string, limit = 10): TaskExecutionRecord[] {
    const history = this.executionHistory.get(taskName) || [];
    return history.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Get all execution history (for monitoring dashboard)
   */
  getAllExecutionHistory(limit = 50): Map<string, TaskExecutionRecord[]> {
    const result = new Map<string, TaskExecutionRecord[]>();

    for (const [taskName, records] of this.executionHistory.entries()) {
      result.set(taskName, records.slice(-limit).reverse());
    }

    return result;
  }

  /**
   * Get execution statistics for a task
   */
  getTaskStats(taskName: string) {
    const history = this.executionHistory.get(taskName) || [];

    if (history.length === 0) {
      return {
        taskName,
        totalExecutions: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        lastExecution: null,
        averageExecutionTimeMs: 0,
      };
    }

    const successCount = history.filter((r) => r.result.success).length;
    const failureCount = history.length - successCount;
    const avgExecutionTime =
      history.reduce((sum, r) => sum + (r.result.executionTimeMs || 0), 0) / history.length;

    return {
      taskName,
      totalExecutions: history.length,
      successCount,
      failureCount,
      successRate: (successCount / history.length) * 100,
      lastExecution: history[history.length - 1],
      averageExecutionTimeMs: Math.round(avgExecutionTime),
    };
  }

  /**
   * Get overall scheduler statistics
   */
  getSchedulerStats() {
    const allTasks = this.taskRegistry.getAllMetadata();
    const enabledTasks = allTasks.filter((t) => t.enabled);

    const totalExecutions = Array.from(this.executionHistory.values()).reduce(
      (sum, records) => sum + records.length,
      0,
    );

    return {
      schedulerEnabled: this.isSchedulerEnabled,
      totalTasks: allTasks.length,
      enabledTasks: enabledTasks.length,
      disabledTasks: allTasks.length - enabledTasks.length,
      totalExecutions,
      tasksByCategory: {
        'health-check': allTasks.filter((t) => t.category === 'health-check').length,
        cleanup: allTasks.filter((t) => t.category === 'cleanup').length,
        recovery: allTasks.filter((t) => t.category === 'recovery').length,
        metrics: allTasks.filter((t) => t.category === 'metrics').length,
        custom: allTasks.filter((t) => t.category === 'custom').length,
      },
    };
  }

  /**
   * Clear execution history (for testing/cleanup)
   */
  clearHistory(taskName?: string): void {
    if (taskName) {
      this.executionHistory.delete(taskName);
      this.logger.log(`Cleared history for task: ${taskName}`);
    } else {
      this.executionHistory.clear();
      this.logger.log('Cleared all execution history');
    }
  }

  /**
   * Record task execution for history/metrics
   */
  private recordExecution(
    taskName: string,
    result: TaskResult,
    triggerType: 'scheduled' | 'manual' | 'bulk',
  ): void {
    if (!this.executionHistory.has(taskName)) {
      this.executionHistory.set(taskName, []);
    }

    const history = this.executionHistory.get(taskName)!;
    history.push({
      taskName,
      timestamp: new Date(),
      triggerType,
      result,
    });

    // Keep only last N executions per task
    if (history.length > this.maxHistoryPerTask) {
      history.shift();
    }
  }

  /**
   * Log scheduler status on startup
   */
  private logSchedulerStatus(): void {
    const stats = this.getSchedulerStats();

    this.logger.log(`📊 Scheduler Status:`);
    this.logger.log(`  Total tasks: ${stats.totalTasks}`);
    this.logger.log(`  Enabled: ${stats.enabledTasks}`);
    this.logger.log(`  Disabled: ${stats.disabledTasks}`);
    this.logger.log(`  By category:`);
    this.logger.log(`    - health-check: ${stats.tasksByCategory['health-check']}`);
    this.logger.log(`    - cleanup: ${stats.tasksByCategory.cleanup}`);
    this.logger.log(`    - recovery: ${stats.tasksByCategory.recovery}`);
    this.logger.log(`    - metrics: ${stats.tasksByCategory.metrics}`);
    this.logger.log(`    - custom: ${stats.tasksByCategory.custom}`);
  }
}
