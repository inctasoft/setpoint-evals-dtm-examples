import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { Job, Step } from '@dtm/database';

// Core infrastructure
import { MaintenanceTaskRegistry } from './registry/maintenance-task-registry';
import { MaintenanceSchedulerService } from './scheduler/maintenance-scheduler.service';
import { MaintenanceController } from './maintenance.controller';
import { AdvisoryLockService } from './advisory-lock.service';

// Task implementations
import { StuckAcknowledgementTask } from './tasks/stuck-acknowledgement.task';
import { OrphanedJobRecoveryTask } from './tasks/orphaned-job-recovery.task';
import { StuckInProgressTask } from './tasks/stuck-in-progress.task';
import { OldJobCleanupTask } from './tasks/old-job-cleanup.task';
import { HealthMetricsTask } from './tasks/health-metrics.task';
import { StuckWaitingForChildrenTask } from './tasks/stuck-waiting-for-children.task';
import { StuckDelegatedTask } from './tasks/stuck-delegated.task';
import { StuckPendingTask } from './tasks/stuck-pending.task';

// Dependencies
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { DelegationModule } from '../delegation/delegation.module';

/**
 * Maintenance Module
 *
 * Provides scheduled maintenance tasks for the DTM orchestrator.
 *
 * Features:
 * - Auto-discovers tasks via dependency injection
 * - Schedules tasks using NestJS @Cron decorators
 * - Provides REST API for manual execution
 * - Tracks execution history
 * - Environment-based configuration
 *
 * Adding new tasks:
 * 1. Create task class extending BaseMaintenanceTask
 * 2. Add to providers array below
 * 3. Task will auto-register and be available via API
 *
 * Architecture:
 * - Registry: Discovers and manages all tasks
 * - Scheduler: Orchestrates task execution
 * - Controller: REST API for manual triggers
 * - Tasks: Individual maintenance operations
 */
@Module({
  imports: [
    // Enable cron scheduling
    ScheduleModule.forRoot(),

    // Configuration
    ConfigModule,

    // Database entities
    TypeOrmModule.forFeature([Job, Step]),

    // Orchestration service (for triggering job continuation)
    OrchestrationModule,

    // Delegation service (for re-delegating stuck steps)
    DelegationModule,
  ],

  controllers: [MaintenanceController],

  providers: [
    // Core infrastructure
    MaintenanceTaskRegistry,
    MaintenanceSchedulerService,
    AdvisoryLockService,

    // Task implementations
    // Note: Tasks auto-register themselves on construction
    // Add new tasks here and they'll be automatically discovered
    StuckAcknowledgementTask,
    OrphanedJobRecoveryTask,
    StuckInProgressTask,
    OldJobCleanupTask,
    HealthMetricsTask,

    // New recovery tasks (Phase 4)
    StuckWaitingForChildrenTask,
    StuckDelegatedTask,
    StuckPendingTask,
  ],

  exports: [
    // Export registry and scheduler for use in other modules
    MaintenanceTaskRegistry,
    MaintenanceSchedulerService,
  ],
})
export class MaintenanceModule {}
