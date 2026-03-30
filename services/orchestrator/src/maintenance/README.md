# Maintenance Task Framework

Quick reference for the Maintenance Task System.

## 📁 Directory Structure

```
maintenance/
├── interfaces/
│   └── maintenance-task.interface.ts    # Core interfaces
├── base/
│   └── base-maintenance-task.ts         # Abstract base class
├── registry/
│   └── maintenance-task-registry.ts     # Task discovery & management
├── scheduler/
│   └── maintenance-scheduler.service.ts # Execution orchestration
├── tasks/
│   ├── stuck-acknowledgement.task.ts    # Auto-fail stuck acks
│   ├── orphaned-job-recovery.task.ts    # Recover zombie jobs
│   ├── stuck-in-progress.task.ts        # Alert on stuck steps
│   ├── old-job-cleanup.task.ts          # Delete old jobs
│   └── health-metrics.task.ts           # Generate metrics
├── maintenance.controller.ts            # REST API
├── maintenance.module.ts                # NestJS module
└── README.md                            # This file
```

## 🚀 Quick Start

### 1. Configuration

Add to `.env.local`:

```bash
MAINTENANCE_SCHEDULER_ENABLED=true
MAINTENANCE_TASK_STUCK_ACKNOWLEDGEMENT_ENABLED=true
MAINTENANCE_ACK_TIMEOUT_MINUTES=30
MAINTENANCE_AUTO_FIX_ENABLED=true
```

### 2. Verify Installation

```bash
# Check health
curl http://localhost:3000/maintenance/health

# List tasks
curl http://localhost:3000/maintenance/tasks | jq

# Check logs
docker logs dtm-orchestrator | grep Maintenance
```

## 📋 Built-in Tasks

| Task | Schedule | Category | Priority | Auto-Fix |
|------|----------|----------|----------|----------|
| `stuck-acknowledgement` | Every 5 min | health-check | 100 | ✅ Yes |
| `orphaned-job-recovery` | Every 10 min | recovery | 90 | ✅ Yes |
| `stuck-in-progress` | Every 10 min | health-check | 80 | ❌ Alert only |
| `old-job-cleanup` | Daily 2 AM | cleanup | 10 | ✅ Yes |
| `health-metrics` | Every 5 min | metrics | 50 | N/A |

## 🔌 API Endpoints

```bash
# List all tasks
GET /maintenance/tasks

# Execute task manually
POST /maintenance/tasks/{taskName}/execute

# Execute category
POST /maintenance/tasks/category/{category}/execute

# Get execution history
GET /maintenance/tasks/{taskName}/history?limit=10

# Get task stats
GET /maintenance/tasks/{taskName}/stats

# Health check
GET /maintenance/health
```

## ➕ Adding a New Task

### 1. Create Task Class

```typescript
// tasks/my-task.task.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';

@Injectable()
export class MyTask extends BaseMaintenanceTask {
  constructor(private readonly taskRegistry: MaintenanceTaskRegistry) {
    super('MyTask');
    this.taskRegistry.register(this);
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'my-task',
      description: 'Does something useful',
      schedule: CronExpression.EVERY_HOUR,
      priority: 50,
      category: 'custom',
      timeoutMs: 60000,
      enabled: true,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(): Promise<TaskResult> {
    // Implementation
    return {
      success: true,
      message: 'Done',
      metrics: {},
    };
  }
}
```

### 2. Register in Module

```typescript
// maintenance.module.ts
@Module({
  providers: [
    // ... existing tasks
    MyTask, // Add here
  ],
})
export class MaintenanceModule {}
```

### 3. Configure (Optional)

```bash
# .env.local
MAINTENANCE_TASK_MY_TASK_ENABLED=true
```

That's it! Task is auto-discovered and scheduled.

## 🏗️ Architecture

### Base Classes

- **`IMaintenanceTask`** - Interface all tasks implement
- **`BaseMaintenanceTask`** - Abstract base with:
  - ✅ Automatic error handling
  - ✅ Execution timing
  - ✅ Timeout protection
  - ✅ Cleanup hooks

### Services

- **`MaintenanceTaskRegistry`** - Task discovery and management
- **`MaintenanceSchedulerService`** - Execution orchestration
- **`MaintenanceController`** - REST API

### Task Lifecycle

```
Construction → Auto-register → Apply config → Schedule
                                                 ↓
                                            Cron trigger
                                                 ↓
                                            canRun()?
                                                 ↓
                                            execute()
                                                 ↓
                                            doExecute()
                                                 ↓
                                            Record history
```

## 📊 Execution Result

All tasks return `TaskResult`:

```typescript
{
  success: boolean;
  message: string;
  findings?: TaskFinding[];  // Issues detected
  actions?: TaskAction[];    // Actions taken
  metrics?: Record<string, number>;
  executionTimeMs?: number;
  error?: string;
}
```

## 🔍 Task Finding

```typescript
{
  severity: 'info' | 'warning' | 'error' | 'critical';
  description: string;
  entityId?: string;       // Job/Step ID
  entityType?: 'job' | 'step';
  context?: Record<string, any>;
}
```

## ⚡ Task Action

```typescript
{
  type: 'auto-fix' | 'alert' | 'metric' | 'manual-review-required';
  description: string;
  entityId?: string;
  result?: 'success' | 'failed' | 'skipped';
  context?: Record<string, any>;
}
```

## 🎯 Best Practices

1. **Idempotency** - Tasks should be safe to run multiple times
2. **Timeout Protection** - Set appropriate `timeoutMs`
3. **Error Handling** - Provide context in error messages
4. **Detailed Results** - Return comprehensive findings and actions
5. **Structured Logging** - Use emojis and context
6. **Progressive Enhancement** - Start with alerts, add auto-fix later

## 📚 Full Documentation

See [../MAINTENANCE.md](../MAINTENANCE.md) for:
- Complete configuration reference
- All API endpoints
- Task implementation guides
- Troubleshooting
- Monitoring & metrics

## 🔗 Related Files

- **Implementation Plan**: [../../../../MAINTENANCE-IMPLEMENTATION-PLAN.md](../../../../MAINTENANCE-IMPLEMENTATION-PLAN.md)
- **Environment Config**: [../../../../ENV-MAINTENANCE-CONFIG.md](../../../../ENV-MAINTENANCE-CONFIG.md)
- **System Architecture**: [../../../../docs/system-architecture.md](../../../../docs/system-architecture.md)

---

**Version**: 1.0.0  
**Status**: ✅ Production Ready

