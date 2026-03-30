# Maintenance Task System

**Version**: 1.0.0  
**Status**: ✅ Production Ready  
**Last Updated**: November 23, 2025

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Built-in Tasks](#built-in-tasks)
5. [Configuration](#configuration)
6. [API Reference](#api-reference)
7. [Adding Custom Tasks](#adding-custom-tasks)
8. [Monitoring & Metrics](#monitoring--metrics)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

---

## Overview

The Maintenance Task System is a flexible, extensible framework for running scheduled maintenance operations on the DTM orchestrator. It provides automatic health monitoring, recovery operations, cleanup, and metrics collection with minimal operational overhead.

### Key Features

- ✅ **Automatic Health Monitoring** - Detect and fix stuck jobs
- ✅ **Recovery Operations** - Recover from crashes and edge cases
- ✅ **Cleanup Operations** - Maintain database hygiene
- ✅ **Metrics Collection** - Generate operational insights
- ✅ **Manual Triggers** - Run tasks on-demand via REST API
- ✅ **Environment Configuration** - Enable/disable per environment
- ✅ **Execution History** - Track all task executions
- ✅ **Extensible** - Easy to add new custom tasks

### Why You Need This

Without maintenance tasks, your system can experience:
- **Stuck jobs** - Hanging indefinitely waiting for acknowledgements
- **Zombie jobs** - Orphaned after orchestrator crashes
- **Database bloat** - Old jobs filling up storage
- **No visibility** - Missing operational metrics
- **Manual intervention** - Constant firefighting

With maintenance tasks, you get:
- **Self-healing** - Automatic recovery from common issues
- **Proactive monitoring** - Issues detected before they impact users
- **Operational efficiency** - Less manual intervention required
- **Data hygiene** - Automatic cleanup of old data
- **Visibility** - Clear metrics for dashboards and alerts

---

## Quick Start

### 1. Install Dependencies

```bash
cd services/orchestrator
pnpm install  # Installs @nestjs/schedule
```

### 2. Configure Environment

Add to your `.env.local` or `.env`:

```bash
# Enable maintenance scheduler
MAINTENANCE_SCHEDULER_ENABLED=true

# Enable all tasks (default)
MAINTENANCE_TASK_STUCK_ACKNOWLEDGEMENT_ENABLED=true
MAINTENANCE_TASK_ORPHANED_JOB_RECOVERY_ENABLED=true
MAINTENANCE_TASK_STUCK_IN_PROGRESS_ENABLED=true
MAINTENANCE_TASK_OLD_JOB_CLEANUP_ENABLED=true
MAINTENANCE_TASK_HEALTH_METRICS_ENABLED=true

# Configure task settings
MAINTENANCE_ACK_TIMEOUT_MINUTES=30
MAINTENANCE_AUTO_FIX_ENABLED=true
MAINTENANCE_JOB_RETENTION_DAYS=30
```

See [ENV-MAINTENANCE-CONFIG.md](../../../ENV-MAINTENANCE-CONFIG.md) for complete configuration reference.

### 3. Restart Orchestrator

```bash
docker compose restart orchestrator
```

### 4. Verify Installation

```bash
# Check health
curl http://localhost:3000/maintenance/health

# List all tasks
curl http://localhost:3000/maintenance/tasks | jq

# Check logs
docker logs dtm-orchestrator | grep "Maintenance"
```

Expected log output:
```
[MaintenanceTaskRegistry] 📋 Maintenance Task Registry initialized
[MaintenanceTaskRegistry] ✅ Registered task: stuck-acknowledgement (health-check, ENABLED)
...
[MaintenanceSchedulerService] ⚙️ Maintenance scheduler is ENABLED
```

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                  Maintenance Module                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │      MaintenanceSchedulerService                   │    │
│  │  - Orchestrates all maintenance tasks              │    │
│  │  - Manages execution history                       │    │
│  │  - Provides manual execution API                   │    │
│  └───────────────┬────────────────────────────────────┘    │
│                  │                                           │
│                  ▼                                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │      MaintenanceTaskRegistry                       │    │
│  │  - Auto-discovers tasks via DI                     │    │
│  │  - Applies environment configuration               │    │
│  │  - Provides task lookup and filtering              │    │
│  └───────────────┬────────────────────────────────────┘    │
│                  │                                           │
│                  ▼                                           │
│  ┌────────────────────────────────────────────────────┐    │
│  │      Concrete Task Implementations                 │    │
│  │  - StuckAcknowledgementTask                        │    │
│  │  - OrphanedJobRecoveryTask                         │    │
│  │  - StuckInProgressTask                             │    │
│  │  - OldJobCleanupTask                               │    │
│  │  - HealthMetricsTask                               │    │
│  │  - (Your custom tasks...)                          │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Core Classes

1. **`IMaintenanceTask`** - Interface all tasks implement
2. **`BaseMaintenanceTask`** - Abstract base with timing, error handling, timeout protection
3. **`MaintenanceTaskRegistry`** - Discovers and manages all tasks
4. **`MaintenanceSchedulerService`** - Orchestrates execution and tracks history
5. **`MaintenanceController`** - REST API for manual execution

### Task Lifecycle

```
1. Task Construction
   └─> Auto-registers with registry
       └─> Applies environment configuration
           └─> Scheduled via @Cron decorator

2. Scheduled Execution (or Manual Trigger)
   └─> canRun() check (enabled? prerequisites met?)
       └─> execute() with timeout protection
           └─> doExecute() (actual work)
               └─> Return TaskResult
                   └─> Record in execution history

3. Optional Cleanup
   └─> cleanup() hook for resource cleanup
```

---

## Built-in Tasks

### 1. Stuck Acknowledgement Task

**Category**: `health-check`  
**Schedule**: Every 5 minutes  
**Priority**: 100 (highest)

**Purpose**: Detects steps stuck waiting for external acknowledgements and auto-fails them after a timeout.

**Configuration**:
- `MAINTENANCE_ACK_TIMEOUT_MINUTES` - Timeout in minutes (default: 30)
- `MAINTENANCE_AUTO_FIX_ENABLED` - Enable auto-fix (default: true)

**What it does**:
1. Finds steps in `WAITING_FOR_ACK` status longer than timeout
2. If auto-fix enabled: Marks step as `FAILED` and triggers orchestration
3. If auto-fix disabled: Raises alert for manual intervention

**When to adjust**:
- Development: Set timeout to 5 minutes for faster testing
- Production with slow systems: Increase to 60 minutes
- Disable auto-fix: For manual control during investigations

**Manual execution**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/stuck-acknowledgement/execute
```

---

### 2. Orphaned Job Recovery Task

**Category**: `recovery`  
**Schedule**: Every 10 minutes  
**Priority**: 90 (high)

**Purpose**: Recovers jobs stuck in `PROCESSING` state despite all steps being terminal.

**What it does**:
1. Finds jobs in `PROCESSING` with all steps in terminal states (`COMPLETED`, `FAILED`, `SKIPPED`)
2. Re-triggers orchestration to recalculate job status
3. Job status updated to correct terminal state

**Why this happens**:
- Orchestrator crashes after step completion
- Race conditions in concurrent step completions
- Database transaction failures

**Manual execution**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/orphaned-job-recovery/execute
```

---

### 3. Stuck In-Progress Task

**Category**: `health-check`  
**Schedule**: Every 10 minutes  
**Priority**: 80

**Purpose**: Detects steps stuck in `IN_PROGRESS` or `IN_PROGRESS_RETRYING` state.

**Configuration**:
- `MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES` - Alert threshold (default: 30)

**What it does**:
1. Finds steps in progress states longer than threshold
2. Generates alerts with severity based on duration
3. Provides troubleshooting recommendations
4. **NO AUTO-FIX** (steps might be legitimately processing)

**Severity levels**:
- `warning`: 30-60 minutes stuck
- `critical`: >60 minutes stuck

**What it indicates**:
- Lambda timeout without error callback
- SQS visibility timeout issues
- Lambda worker crash
- Network issues preventing callback

**Manual execution**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/stuck-in-progress/execute
```

---

### 4. Old Job Cleanup Task

**Category**: `cleanup`  
**Schedule**: Daily at 2 AM  
**Priority**: 10 (low)

**Purpose**: Deletes old completed/failed jobs based on retention policy.

**Configuration**:
- `MAINTENANCE_JOB_RETENTION_DAYS` - Days to keep jobs (default: 30)
- `MAINTENANCE_CLEANUP_BATCH_SIZE` - Max jobs per run (default: 100)

**What it does**:
1. Finds completed/failed jobs older than retention period
2. Deletes jobs in batches (steps cascade deleted via FK)
3. Logs all deletions for audit trail

**Retention recommendations**:
- Development: 7 days
- Production: 30-90 days
- Compliance: 365+ days (consider archiving to S3 first)

**Batch size considerations**:
- Small systems: 50
- Standard: 100 (default)
- Large cleanup: 500 (watch database locks)

**Manual execution**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/old-job-cleanup/execute
```

---

### 5. Health Metrics Task

**Category**: `metrics`  
**Schedule**: Every 5 minutes  
**Priority**: 50

**Purpose**: Generates operational health metrics for monitoring dashboards.

**Metrics generated**:
- Active/pending job counts
- Success rates (last hour, last 24 hours)
- Job throughput (projected per hour)
- Step health indicators
- Potential issues (stuck steps, retries)
- Overall health score (0-100)

**What it does**:
1. Queries database for current state
2. Calculates derived metrics and trends
3. Logs metrics in structured format
4. Ready for export to CloudWatch/Datadog/Prometheus

**Manual execution**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/health-metrics/execute
```

**Example output**:
```json
{
  "success": true,
  "message": "Generated health metrics (120 jobs in last 24h, 98% success rate, health score: 95/100)",
  "metrics": {
    "activeJobs": 5,
    "successRateLast24h": 98,
    "jobThroughputPerHour": 240,
    "totalIssues": 1,
    "healthScore": 95
  }
}
```

---

## Configuration

See [ENV-MAINTENANCE-CONFIG.md](../../../ENV-MAINTENANCE-CONFIG.md) for complete configuration reference.

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MAINTENANCE_SCHEDULER_ENABLED` | `true` | Enable/disable entire scheduler |
| `MAINTENANCE_TASK_{NAME}_ENABLED` | `true` | Enable/disable specific task |
| `MAINTENANCE_ACK_TIMEOUT_MINUTES` | `30` | Stuck acknowledgement timeout |
| `MAINTENANCE_AUTO_FIX_ENABLED` | `true` | Enable automatic fixes |
| `MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES` | `30` | In-progress alert threshold |
| `MAINTENANCE_JOB_RETENTION_DAYS` | `30` | Old job retention period |
| `MAINTENANCE_CLEANUP_BATCH_SIZE` | `100` | Cleanup batch size |

---

## API Reference

Base URL: `http://localhost:3000/maintenance` (development) or `https://your-domain.com/maintenance` (production)

### List All Tasks

```http
GET /maintenance/tasks
```

**Response**:
```json
[
  {
    "name": "stuck-acknowledgement",
    "description": "Detects and auto-fails steps stuck waiting for external acknowledgements",
    "schedule": "*/5 * * * *",
    "priority": 100,
    "category": "health-check",
    "timeoutMs": 60000,
    "enabled": true
  }
]
```

### Get Tasks by Category

```http
GET /maintenance/tasks/category/:category
```

**Parameters**:
- `category`: `health-check` | `cleanup` | `recovery` | `metrics` | `custom`

**Example**:
```bash
curl http://localhost:3000/maintenance/tasks/category/health-check
```

### Execute Task Manually

```http
POST /maintenance/tasks/:taskName/execute
```

**Example**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/stuck-acknowledgement/execute
```

**Response**:
```json
{
  "success": true,
  "message": "Found 2 stuck acknowledgements, auto-fixed 2",
  "findings": [
    {
      "severity": "critical",
      "description": "Step stuck waiting for acknowledgement for 35 minutes",
      "entityId": "step-uuid-123",
      "context": { ... }
    }
  ],
  "actions": [
    {
      "type": "auto-fix",
      "description": "Auto-failed step after 30min timeout",
      "entityId": "step-uuid-123",
      "result": "success"
    }
  ],
  "metrics": {
    "stuckStepsFound": 2,
    "autoFixed": 2
  },
  "executionTimeMs": 123
}
```

### Execute All Tasks in Category

```http
POST /maintenance/tasks/category/:category/execute
```

**Example**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/category/health-check/execute
```

### Execute All Enabled Tasks (Emergency)

```http
POST /maintenance/tasks/execute-all
```

**Example**:
```bash
curl -X POST http://localhost:3000/maintenance/tasks/execute-all
```

### Get Execution History

```http
GET /maintenance/tasks/:taskName/history?limit=10
```

**Example**:
```bash
curl "http://localhost:3000/maintenance/tasks/stuck-acknowledgement/history?limit=20"
```

### Get Task Statistics

```http
GET /maintenance/tasks/:taskName/stats
```

**Response**:
```json
{
  "taskName": "stuck-acknowledgement",
  "totalExecutions": 50,
  "successCount": 48,
  "failureCount": 2,
  "successRate": 96,
  "lastExecution": { ... },
  "averageExecutionTimeMs": 150
}
```

### Get Overall Statistics

```http
GET /maintenance/stats
```

### Health Check

```http
GET /maintenance/health
```

**Response**:
```json
{
  "status": "healthy",
  "scheduler": {
    "enabled": true,
    "totalExecutions": 250
  },
  "tasks": {
    "total": 5,
    "enabled": 5,
    "disabled": 0
  },
  "categories": {
    "health-check": 2,
    "cleanup": 1,
    "recovery": 1,
    "metrics": 1
  },
  "timestamp": "2025-11-23T10:30:00Z"
}
```

---

## Adding Custom Tasks

### Step 1: Create Task Class

```typescript
// src/maintenance/tasks/my-custom-task.task.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BaseMaintenanceTask } from '../base/base-maintenance-task';
import {
  TaskMetadata,
  TaskResult,
} from '../interfaces/maintenance-task.interface';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';

@Injectable()
export class MyCustomTask extends BaseMaintenanceTask {
  constructor(
    // Inject dependencies here
    private readonly taskRegistry: MaintenanceTaskRegistry,
  ) {
    super('MyCustomTask'); // Logger context
    this.taskRegistry.register(this); // Auto-register
  }

  getMetadata(): TaskMetadata {
    return {
      name: 'my-custom-task',
      description: 'Does something useful',
      schedule: CronExpression.EVERY_HOUR,
      priority: 50,
      category: 'custom',
      timeoutMs: 120000, // 2 minutes
      enabled: true,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRun() {
    await this.execute();
  }

  protected async doExecute(): Promise<TaskResult> {
    // Your implementation here
    const findings = [];
    const actions = [];
    const metrics = {};

    // Do work...

    return {
      success: true,
      message: 'Task completed successfully',
      findings,
      actions,
      metrics,
    };
  }
}
```

### Step 2: Register in Module

```typescript
// src/maintenance/maintenance.module.ts
import { MyCustomTask } from './tasks/my-custom-task.task';

@Module({
  providers: [
    // ... existing tasks
    MyCustomTask, // Add your task here
  ],
})
export class MaintenanceModule {}
```

That's it! Your task will be:
- ✅ Auto-discovered by the registry
- ✅ Scheduled according to its cron expression
- ✅ Available via the API
- ✅ Configurable via `MAINTENANCE_TASK_MY_CUSTOM_TASK_ENABLED`

---

## Monitoring & Metrics

### Built-in Metrics

The Health Metrics task generates these metrics every 5 minutes:

- **Job Counts**: Active, pending, completed, failed
- **Success Rates**: Hourly and daily
- **Throughput**: Jobs per hour (projected)
- **Step Health**: In progress, retrying, waiting for ack
- **Issues**: Stuck acknowledgements, stuck in-progress
- **Health Score**: 0-100 overall system health

### Exporting to External Systems

#### CloudWatch (AWS)

```typescript
// Uncomment in health-metrics.task.ts
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({});
await cloudwatch.send(new PutMetricDataCommand({
  Namespace: 'DTM/Maintenance',
  MetricData: Object.entries(metrics).map(([name, value]) => ({
    MetricName: name,
    Value: value,
    Unit: 'Count',
  })),
}));
```

#### Datadog

```typescript
// Uncomment in health-metrics.task.ts
import { StatsD } from 'node-dogstatsd';

const dogstatsd = new StatsD();
for (const [name, value] of Object.entries(metrics)) {
  dogstatsd.gauge(`dtm.${name}`, value);
}
```

### Dashboard Setup

Query the metrics endpoint in your dashboard:

```bash
# Get current metrics
curl http://localhost:3000/maintenance/tasks/health-metrics/execute
```

---

## Troubleshooting

### Scheduler Not Running

**Symptom**: Tasks don't execute automatically

**Check**:
```bash
curl http://localhost:3000/maintenance/health | jq '.scheduler.enabled'
```

**Fix**:
```bash
# Set in .env or .env.local
MAINTENANCE_SCHEDULER_ENABLED=true

# Restart orchestrator
docker compose restart orchestrator
```

### Task Not Executing

**Symptom**: Specific task doesn't run

**Check**:
```bash
# Verify task is enabled
curl http://localhost:3000/maintenance/tasks | jq '.[] | select(.name == "stuck-acknowledgement")'
```

**Fix**:
```bash
# Enable task
MAINTENANCE_TASK_STUCK_ACKNOWLEDGEMENT_ENABLED=true
```

### Tasks Timing Out

**Symptom**: Task executions fail with timeout errors

**Check execution history**:
```bash
curl http://localhost:3000/maintenance/tasks/my-task/history | jq '.[0].result'
```

**Fix**:
- Increase `timeoutMs` in task metadata
- Optimize slow database queries
- Add batch processing for large datasets

### Can't Find Environment Variables

**Symptom**: Tasks use default values

**Check**:
```bash
# Check env file location
docker exec dtm-orchestrator printenv | grep MAINTENANCE
```

**Fix**:
- Ensure `.env.local` or `.env` is in correct location
- Restart orchestrator after changing env vars
- Verify no typos in variable names

---

## Best Practices

### 1. Task Idempotency

Tasks should be safe to run multiple times:

```typescript
// Good: Check before acting
const stuckSteps = await findStuckSteps();
if (stuckSteps.length === 0) {
  return { success: true, message: 'No issues found' };
}

// Bad: Assumes state
await failAllSteps(); // What if none are stuck?
```

### 2. Timeout Protection

Always set appropriate timeouts:

```typescript
getMetadata(): TaskMetadata {
  return {
    timeoutMs: 120000, // 2 minutes for database-heavy tasks
    // ...
  };
}
```

### 3. Error Handling

BaseMaintenanceTask handles errors automatically, but provide context:

```typescript
protected async doExecute(): TaskResult {
  try {
    // Your logic
  } catch (error) {
    return {
      success: false,
      message: `Failed to process: ${error.message}`,
      error: error.stack,
    };
  }
}
```

### 4. Comprehensive Results

Return detailed findings and actions:

```typescript
return {
  success: true,
  message: `Found ${issues.length} issues, fixed ${fixed}`,
  findings: issues.map(issue => ({
    severity: 'critical',
    description: 'What was found',
    entityId: 'job-123',
    context: { /* useful debugging info */ },
  })),
  actions: actions.map(action => ({
    type: 'auto-fix',
    description: 'What was done',
    result: 'success',
  })),
  metrics: { /* quantitative data */ },
};
```

### 5. Logging

Use structured logging:

```typescript
this.logger.log(`🔧 Processing ${items.length} items`);
this.logger.warn(`⚠️  Found ${warnings} warnings`);
this.logger.error(`❌ Failed to process item ${id}`, error);
this.logger.debug(`📊 Metrics: ${JSON.stringify(metrics)}`);
```

### 6. Progressive Enhancement

Start with alerting, add auto-fix later:

```typescript
// Version 1: Alert only
if (isStuck) {
  actions.push({ type: 'alert', description: 'Manual review needed' });
}

// Version 2: Add auto-fix after monitoring
if (this.autoFixEnabled && isStuck) {
  await this.fixIssue();
  actions.push({ type: 'auto-fix', result: 'success' });
}
```

---

## Additional Resources

- **Implementation Plan**: [MAINTENANCE-IMPLEMENTATION-PLAN.md](../../../MAINTENANCE-IMPLEMENTATION-PLAN.md)
- **Environment Configuration**: [ENV-MAINTENANCE-CONFIG.md](../../../ENV-MAINTENANCE-CONFIG.md)
- **System Architecture**: [docs/system-architecture.md](../../../docs/system-architecture.md)
- **NestJS Schedule Documentation**: https://docs.nestjs.com/techniques/task-scheduling

---

**Maintained by**: DTM Team
**Last Updated**: November 23, 2025  
**Version**: 1.0.0

