import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { MaintenanceSchedulerService } from './scheduler/maintenance-scheduler.service';
import { MaintenanceTaskRegistry } from './registry/maintenance-task-registry';
import { TaskResult, TaskMetadata } from './interfaces/maintenance-task.interface';

/**
 * Maintenance Controller
 *
 * REST API endpoints for managing and executing maintenance tasks.
 *
 * Endpoints:
 * - GET /maintenance/tasks - List all tasks
 * - GET /maintenance/tasks/category/:category - Filter by category
 * - POST /maintenance/tasks/:taskName/execute - Execute task manually
 * - POST /maintenance/tasks/category/:category/execute - Execute all in category
 * - GET /maintenance/tasks/:taskName/history - Get execution history
 * - GET /maintenance/tasks/:taskName/stats - Get task statistics
 * - GET /maintenance/history - All execution history
 * - GET /maintenance/health - System health check
 * - GET /maintenance/stats - Overall statistics
 */
@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly schedulerService: MaintenanceSchedulerService,
    private readonly taskRegistry: MaintenanceTaskRegistry,
  ) {}

  /**
   * Get all registered maintenance tasks
   */
  @Get('tasks')
  @ApiOperation({ summary: 'List all maintenance tasks' })
  @ApiResponse({
    status: 200,
    description: 'List of all tasks with metadata',
  })
  getAllTasks(): TaskMetadata[] {
    return this.taskRegistry.getAllMetadata();
  }

  /**
   * Get tasks by category
   */
  @Get('tasks/category/:category')
  @ApiOperation({ summary: 'Get tasks by category' })
  @ApiParam({
    name: 'category',
    enum: ['health-check', 'cleanup', 'recovery', 'metrics', 'custom'],
    description: 'Task category',
  })
  @ApiResponse({ status: 200, description: 'Tasks in the specified category' })
  @ApiResponse({ status: 400, description: 'Invalid category' })
  getTasksByCategory(@Param('category') category: string): TaskMetadata[] {
    const validCategories = ['health-check', 'cleanup', 'recovery', 'metrics', 'custom'];

    if (!validCategories.includes(category)) {
      throw new BadRequestException(
        `Invalid category. Must be one of: ${validCategories.join(', ')}`,
      );
    }

    const tasks = this.taskRegistry.getTasksByCategory(category);
    return tasks.map((task) => task.getMetadata());
  }

  /**
   * Execute a task manually
   */
  @Post('tasks/:taskName/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a maintenance task manually' })
  @ApiParam({
    name: 'taskName',
    description: 'Name of the task to execute (e.g., "stuck-acknowledgement")',
  })
  @ApiBody({
    description: 'Optional execution parameters (passed to task)',
    required: false,
    schema: {
      type: 'object',
      example: {
        ackTimeoutMinutes: 0.25,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Task execution result',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async executeTask(
    @Param('taskName') taskName: string,
    @Body() options?: Record<string, any>,
  ): Promise<TaskResult> {
    if (!this.taskRegistry.hasTask(taskName)) {
      throw new NotFoundException(`Task not found: ${taskName}`);
    }

    // Allow options from body, or fallback to query (for backward compatibility during refactor)
    // But moving forward, body is preferred for POST requests
    const executionOptions = options || {};

    return await this.schedulerService.executeTaskManually(taskName, executionOptions);
  }

  /**
   * Execute all tasks in a category
   */
  @Post('tasks/category/:category/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute all tasks in a category' })
  @ApiParam({
    name: 'category',
    enum: ['health-check', 'cleanup', 'recovery', 'metrics'],
    description: 'Category of tasks to execute',
  })
  @ApiResponse({
    status: 200,
    description: 'Execution results for all tasks in category',
  })
  @ApiResponse({ status: 400, description: 'Invalid category' })
  async executeCategory(@Param('category') category: string): Promise<Record<string, TaskResult>> {
    const validCategories = ['health-check', 'cleanup', 'recovery', 'metrics', 'custom'];

    if (!validCategories.includes(category)) {
      throw new BadRequestException(
        `Invalid category. Must be one of: ${validCategories.join(', ')}`,
      );
    }

    const results = await this.schedulerService.executeCategory(category);
    return Object.fromEntries(results);
  }

  /**
   * Execute all enabled tasks (emergency recovery operation)
   */
  @Post('tasks/execute-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute ALL enabled tasks (emergency recovery)',
  })
  @ApiResponse({
    status: 200,
    description: 'Execution results for all enabled tasks',
  })
  async executeAllEnabled(): Promise<Record<string, TaskResult>> {
    const results = await this.schedulerService.executeAllEnabled();
    return Object.fromEntries(results);
  }

  /**
   * Get execution history for a task
   */
  @Get('tasks/:taskName/history')
  @ApiOperation({ summary: 'Get execution history for a task' })
  @ApiParam({
    name: 'taskName',
    description: 'Name of the task',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return (default: 10)',
  })
  @ApiResponse({ status: 200, description: 'Execution history' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getTaskHistory(@Param('taskName') taskName: string, @Query('limit') limit?: number) {
    if (!this.taskRegistry.hasTask(taskName)) {
      throw new NotFoundException(`Task not found: ${taskName}`);
    }

    return this.schedulerService.getExecutionHistory(
      taskName,
      limit ? parseInt(limit.toString(), 10) : 10,
    );
  }

  /**
   * Get statistics for a task
   */
  @Get('tasks/:taskName/stats')
  @ApiOperation({ summary: 'Get execution statistics for a task' })
  @ApiParam({
    name: 'taskName',
    description: 'Name of the task',
  })
  @ApiResponse({ status: 200, description: 'Task statistics' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getTaskStats(@Param('taskName') taskName: string) {
    if (!this.taskRegistry.hasTask(taskName)) {
      throw new NotFoundException(`Task not found: ${taskName}`);
    }

    return this.schedulerService.getTaskStats(taskName);
  }

  /**
   * Get all execution history (for monitoring dashboard)
   */
  @Get('history')
  @ApiOperation({ summary: 'Get execution history for all tasks' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records per task (default: 50)',
  })
  @ApiResponse({ status: 200, description: 'Complete execution history' })
  getAllHistory(@Query('limit') limit?: number) {
    const history = this.schedulerService.getAllExecutionHistory(
      limit ? parseInt(limit.toString(), 10) : 50,
    );
    return Object.fromEntries(history);
  }

  /**
   * Get overall scheduler statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get overall scheduler statistics' })
  @ApiResponse({ status: 200, description: 'Scheduler statistics' })
  getStats() {
    return this.schedulerService.getSchedulerStats();
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  @ApiOperation({ summary: 'Maintenance system health check' })
  @ApiResponse({ status: 200, description: 'Health status' })
  getHealth() {
    const tasks = this.taskRegistry.getAllMetadata();
    const enabledTasks = tasks.filter((t) => t.enabled).length;
    const stats = this.schedulerService.getSchedulerStats();

    return {
      status: 'healthy',
      scheduler: {
        enabled: stats.schedulerEnabled,
        totalExecutions: stats.totalExecutions,
      },
      tasks: {
        total: tasks.length,
        enabled: enabledTasks,
        disabled: tasks.length - enabledTasks,
      },
      categories: {
        'health-check': tasks.filter((t) => t.category === 'health-check').length,
        cleanup: tasks.filter((t) => t.category === 'cleanup').length,
        recovery: tasks.filter((t) => t.category === 'recovery').length,
        metrics: tasks.filter((t) => t.category === 'metrics').length,
        custom: tasks.filter((t) => t.category === 'custom').length,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
