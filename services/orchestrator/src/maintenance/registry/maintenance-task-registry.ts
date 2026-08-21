import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMaintenanceTask, TaskMetadata } from '../interfaces/maintenance-task.interface';

/**
 * Maintenance Task Registry
 *
 * Central registry for all maintenance tasks.
 * Responsibilities:
 * - Auto-discover tasks via dependency injection
 * - Apply environment-based configuration
 * - Provide task lookup by name/category/schedule
 * - Track task metadata
 */
@Injectable()
export class MaintenanceTaskRegistry implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceTaskRegistry.name);
  private readonly tasks = new Map<string, IMaintenanceTask>();
  private readonly taskMetadata = new Map<string, TaskMetadata>();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Initialize registry after module loads
   */
  onModuleInit() {
    this.logger.log('📋 Maintenance Task Registry initialized');
    this.logRegisteredTasks();
  }

  /**
   * Register a task (called by tasks on construction)
   * Tasks auto-register themselves by calling this in their constructor
   */
  register(task: IMaintenanceTask): void {
    const metadata = task.getMetadata();

    // Apply environment-based configuration
    const enabled = this.isTaskEnabled(metadata.name);
    metadata.enabled = enabled;

    this.tasks.set(metadata.name, task);
    this.taskMetadata.set(metadata.name, metadata);

    this.logger.log(
      `✅ Registered task: ${metadata.name} (${metadata.category}, ${enabled ? 'ENABLED' : 'DISABLED'})`,
    );
  }

  /**
   * Get all registered tasks
   */
  getAllTasks(): IMaintenanceTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get enabled tasks only
   */
  getEnabledTasks(): IMaintenanceTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.getMetadata().enabled);
  }

  /**
   * Get tasks by category
   */
  getTasksByCategory(category: string): IMaintenanceTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.getMetadata().category === category,
    );
  }

  /**
   * Get task by name
   */
  getTask(name: string): IMaintenanceTask | undefined {
    return this.tasks.get(name);
  }

  /**
   * Get all task metadata (for API/monitoring)
   */
  getAllMetadata(): TaskMetadata[] {
    return Array.from(this.taskMetadata.values());
  }

  /**
   * Get metadata for a specific task
   */
  getTaskMetadata(name: string): TaskMetadata | undefined {
    return this.taskMetadata.get(name);
  }

  /**
   * Get tasks scheduled to run at a specific cron expression
   */
  getTasksBySchedule(cronExpression: string): IMaintenanceTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.getMetadata().schedule === cronExpression,
    );
  }

  /**
   * Check if task exists
   */
  hasTask(name: string): boolean {
    return this.tasks.has(name);
  }

  /**
   * Get count of registered tasks
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * Get count of enabled tasks
   */
  getEnabledTaskCount(): number {
    return this.getEnabledTasks().length;
  }

  /**
   * Log all registered tasks (called on initialization)
   */
  private logRegisteredTasks(): void {
    const tasks = this.getAllMetadata();
    const enabledCount = tasks.filter((t) => t.enabled).length;

    this.logger.log(
      `📊 Task Registry Summary: ${tasks.length} tasks registered, ${enabledCount} enabled`,
    );

    // Group by category
    const byCategory = tasks.reduce(
      (acc, task) => {
        if (!acc[task.category]) {
          acc[task.category] = [];
        }
        acc[task.category].push(task);
        return acc;
      },
      {} as Record<string, TaskMetadata[]>,
    );

    // Log each category
    for (const [category, categoryTasks] of Object.entries(byCategory)) {
      const enabledInCategory = categoryTasks.filter((t) => t.enabled).length;
      this.logger.log(
        `  📁 ${category}: ${categoryTasks.length} tasks (${enabledInCategory} enabled)`,
      );
      categoryTasks.forEach((task) => {
        const status = task.enabled ? '✅' : '⏸️';
        this.logger.log(`    ${status} ${task.name} - ${task.schedule} - ${task.description}`);
      });
    }
  }

  /**
   * Check if task is enabled via environment variables
   * Convention: MAINTENANCE_TASK_{TASK_NAME}_ENABLED=true/false
   *
   * Examples:
   * - MAINTENANCE_TASK_STUCK_ACKNOWLEDGEMENT_ENABLED=false
   * - MAINTENANCE_TASK_OLD_JOB_CLEANUP_ENABLED=true
   */
  private isTaskEnabled(taskName: string): boolean {
    const envKey = `MAINTENANCE_TASK_${this.toEnvVarName(taskName)}_ENABLED`;
    const envValue = this.configService.get<string>(envKey);

    // Default to enabled if not specified
    if (envValue === undefined || envValue === null) {
      return true;
    }

    return envValue === 'true';
  }

  /**
   * Convert task name to environment variable format
   * Examples:
   * - "stuck-acknowledgement" -> "STUCK_ACKNOWLEDGEMENT"
   * - "old-job-cleanup" -> "OLD_JOB_CLEANUP"
   */
  private toEnvVarName(taskName: string): string {
    return taskName.toUpperCase().replace(/-/g, '_');
  }
}
