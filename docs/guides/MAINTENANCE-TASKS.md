# 🛠️ Maintenance Tasks & Scheduler Guide

## Overview

The DTM orchestrator includes a robust maintenance scheduler designed to ensure system health and data integrity. It handles tasks such as detecting stuck processes, cleaning up orphaned jobs, and generating health metrics.

This guide details the available tasks, how to execute them (scheduled or manual), and the security controls in place for test-specific configurations.

---

## 📋 Available Tasks

### 1. Stuck Acknowledgement Recovery (`stuck-acknowledgement`)
*   **Purpose**: Detects steps stuck in `WAITING_FOR_ACK` state for too long (e.g., if the external system failed to respond).
*   **Action**: Can optionally "Auto-Fail" steps to unblock the job, or just alert.
*   **Default Timeout**: 30 minutes.
*   **Schedule**: Every 15 minutes.

### 2. Stuck In-Progress Detection (`stuck-in-progress`)
*   **Purpose**: Detects steps stuck in `IN_PROGRESS` state (e.g., if a Lambda worker crashed or timed out silently).
*   **Action**: Alerts only (requires manual investigation).
*   **Default Timeout**: 30 minutes.
*   **Schedule**: Every 15 minutes.

### 3. Orphaned Job Recovery (`orphaned-job-recovery`)
*   **Purpose**: Detects jobs that are "Processing" but have no active steps.
*   **Action**: Reconciles job status based on step completion.
*   **Schedule**: Every hour.

### 4. Health Metrics (`health-metrics`)
*   **Purpose**: Aggregates system health statistics (active jobs, success rates, failure rates).
*   **Schedule**: Every 5 minutes.

---

## 🚀 Execution Methods

### 1. Automatic Scheduling
By default, the scheduler runs tasks automatically based on their CRON definitions.
*   **Enable/Disable**: Set `MAINTENANCE_SCHEDULER_ENABLED=true/false` in `.env`.

### 2. Manual Execution (API)
You can trigger any task manually via the API. This is useful for:
*   Immediate recovery operations.
*   Testing and validation.
*   E2E scenarios.

**Endpoint:**
```http
POST /api/v1/maintenance/tasks/:taskName/execute
```

**Example:**
```bash
curl -X POST http://localhost:3002/api/v1/maintenance/tasks/health-metrics/execute
```

---

## 🔧 Runtime Options (Test Configurations)

The API allows passing runtime options to override task defaults. **However, this is strictly controlled for security.**

### Supported Options
*   `ackTimeoutMinutes`: Override timeout for Stuck Acknowledgement task.
*   `stuckTimeoutMinutes`: Override timeout for Stuck In-Progress task.

### 🔒 Security Gate
To prevent abuse in production (e.g., an attacker triggering a task with a 1ms timeout to fail all active jobs), these options are **ignored** unless the system is in a secure test mode.

**Mechanism:**
1.  **Check**: The scheduler checks the `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` environment variable.
2.  **Enforce**:
    *   If `false` (Production default): All passed options are **ignored**. The task runs with its safe, hardcoded defaults. A warning is logged.
    *   If `true` (Dev/Test only): The options are passed to the task.

**Example (Development/Test):**
```bash
# This works ONLY if ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
curl -X POST http://localhost:3002/api/v1/maintenance/tasks/stuck-acknowledgement/execute \
  -H "Content-Type: application/json" \
  -d '{"ackTimeoutMinutes": 0.25}'
```

### 📝 Developer Note
If future requirements demand *production-grade* runtime options (e.g., an admin dashboard to tune timeouts dynamically), the codebase must be refactored to separate "Safe Production Options" from "Unsafe Test Overrides".

*See `MaintenanceSchedulerService.executeTaskManually` for implementation details.*

