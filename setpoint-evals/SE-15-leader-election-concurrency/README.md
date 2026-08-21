# SE-15: leader-election concurrency (LEADER-1)

**Category**: maintenance · **Isolation**: destructive · **Duration**: ~10s · **Timeout**: 60s

The `stuck-acknowledgement` task it fires is **global** — it sweeps every row
in `WAITING_FOR_ACK` across the whole `dtm_steps` table (matching
`ackTimeoutMinutes`), not just this SE's own tagged rows (`payload.se='SE-15'`
scopes seeding/cleanup, not the task's own query). Same reason `SE-06`/`SE-07`
(and the other maintenance-task SEs) are `destructive`: run-all.sh's own
Phase-2 rationale is "evals use global maintenance tasks" (`run-all.sh`
header comment) — a parallel-safe label here would let this SE race a
sibling SE's own `WAITING_FOR_ACK` step and clobber it (or get clobbered),
passing only by luck of the concurrent set not colliding.

## Scenario
```gherkin
Feature: A maintenance task's leader lock guards every execution path, not just the cron path
  Scenario: two concurrent manual triggers of the same task never both run its body
    Given 15 synthetic steps stuck WAITING_FOR_ACK, each on its own synthetic job
    When two POST /maintenance/tasks/stuck-acknowledgement/execute requests are fired
      concurrently (near-simultaneous, both in flight together)
    Then exactly one request's response reports "leader lock held" (skipped)
    And the OTHER request's response shows it actually processed all 15 seeded steps
    And neither request duplicates the other's work (no double auto-fail / double continueJob)
```

## Why this exists
`BaseMaintenanceTask.execute()` is the single entry point for BOTH the
`@Cron`-scheduled path and the manual-trigger REST API
(`MaintenanceSchedulerService.executeTaskManually` → `task.execute()` directly).
Before LEADER-1, `AdvisoryLockService` was only consulted inside each task's own
`scheduledRun()` handler — a hand-rolled `tryAcquire`/`release` pair wrapped
around `this.execute()`. That guarded replica-vs-replica CRON races, but the
manual-trigger path called `execute()` straight through, completely unguarded.
Two operators (or one flaky client retry) firing the manual endpoint at the same
moment would run the task's body twice, concurrently — double auto-fail attempts,
double `continueJob()` triggers, double everything.

The fix moves the lock into `BaseMaintenanceTask.execute()` itself, keyed by
`getMetadata().lockId` (a stable per-task integer, `AdvisoryLockService.LockId`),
so **every** call path is guarded by the same lock.

## Why 15 seeded steps
A `pg_try_advisory_lock` guard is trivially easy to get "accidentally green":
if the winner's `doExecute()` returns before the loser's request even reaches
the lock check, both requests may complete without ever truly overlapping —
"exactly one execution" would then be true for the wrong reason (timing luck,
not the guard), and the assertion would flake under different load/scheduling.
Seeding 15 real WAITING_FOR_ACK rows forces the winner's `doExecute()` to do 15
sequential conditional-UPDATE + `continueJob()` round-trips to Postgres —
comfortably long enough that the loser's near-simultaneous request is
guaranteed to observe the lock still held, deterministically, not by luck.

## Architecture
```mermaid
sequenceDiagram
    participant T as test.sh
    participant DB as dtm-db (Postgres)
    participant API as MaintenanceController
    participant Base as BaseMaintenanceTask.execute()
    participant Lock as AdvisoryLockService

    T->>DB: seed 15x (job, step=WAITING_FOR_ACK)
    par concurrent manual triggers
        T->>API: POST .../stuck-acknowledgement/execute  (request A)
        API->>Base: task.execute()
        Base->>Lock: runExclusive(LockId.STUCK_ACKNOWLEDGEMENT, fn)
        Lock->>DB: pg_try_advisory_lock(1001)  -- pinned QueryRunner
        DB-->>Lock: got = true
        Note over Base: doExecute() runs — 15x conditional UPDATE + continueJob()
    and
        T->>API: POST .../stuck-acknowledgement/execute  (request B)
        API->>Base: task.execute()
        Base->>Lock: runExclusive(LockId.STUCK_ACKNOWLEDGEMENT, fn)
        Lock->>DB: pg_try_advisory_lock(1001)  -- different pinned QueryRunner
        DB-->>Lock: got = false  (A still holds it)
        Lock-->>Base: null
        Base-->>API: {message: "Skipped — leader lock held..."}
    end
    Base->>Lock: pg_advisory_unlock(1001)  (A's finally block)
    API-->>T: response A (real: stuckStepsFound=15) + response B (skipped)
    T->>DB: cleanup — DELETE seeded jobs (cascades to steps)
```

## Artifacts

### Seed (arrange)
```sql
WITH new_jobs AS (
  INSERT INTO dtm_jobs (workflow_name, type, status, payload, submitted_at)
  SELECT 'order-processing', 'quick-order', 'processing', '{"se":"SE-15"}'::jsonb, NOW()
  FROM generate_series(1, 15)
  RETURNING id
)
INSERT INTO dtm_steps (job_id, step_value, status, kafka_published_at, started_at)
SELECT id, 'SubmitCustomer', 'waiting_for_ack', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour'
FROM new_jobs
RETURNING job_id;
```

### Request (act) — fired twice, concurrently
```
POST /api/v1/maintenance/tasks/stuck-acknowledgement/execute
Content-Type: application/json

{"ackTimeoutMinutes": 0.001}
```
(The override is a courtesy for speed under `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true`;
the seed's `kafka_published_at` is 1 hour old, so this SE also passes under the
default 30-minute production threshold if overrides are disabled.)

### Expected output (GREEN) — actual captured run
```
ℹ️  Seeding 15 synthetic WAITING_FOR_ACK steps (own synthetic jobs)...
✓ seeded exactly 15 synthetic WAITING_FOR_ACK steps
ℹ️  Firing two concurrent manual triggers of 'stuck-acknowledgement'...
ℹ️  Response 1: HTTP 200 — {"success":true,"message":"Found 15 stuck acknowledgements, auto-fixed 15, raised 0 alerts","metrics":{"stuckStepsFound":15,"autoFixed":15,"alertsRaised":0}}
ℹ️  Response 2: HTTP 200 — {"success":true,"message":"Skipped — leader lock held by another replica or in-flight execution","metrics":null}
✓ request 1 returned HTTP 200
✓ request 2 returned HTTP 200
✓ exactly one concurrent manual trigger was skipped by the leader lock
✓ the winner actually detected the seeded stuck steps (stuckStepsFound >= 15)
── assertions: 5 pass, 0 fail
```

### Negative-control proof (RED) — pre-LEADER-1 code, ACTUAL captured run
`advisory-lock.service.ts` + `base-maintenance-task.ts` + `maintenance-task.interface.ts`
+ all 8 task files were reverted to `origin/master` (advisory lock only
inside each task's own `scheduledRun()`, manual-trigger path unguarded), the
orchestrator image was rebuilt, and this SE was run unmodified:
```
ℹ️  Seeding 15 synthetic WAITING_FOR_ACK steps (own synthetic jobs)...
✓ seeded exactly 15 synthetic WAITING_FOR_ACK steps
ℹ️  Firing two concurrent manual triggers of 'stuck-acknowledgement'...
ℹ️  Response 1: HTTP 200 — {"success":true,"message":"Found 15 stuck acknowledgements, auto-fixed 15, raised 0 alerts","metrics":{"stuckStepsFound":15,"autoFixed":15,"alertsRaised":0}}
ℹ️  Response 2: HTTP 200 — {"success":true,"message":"Found 14 stuck acknowledgements, auto-fixed 14, raised 0 alerts","metrics":{"stuckStepsFound":14,"autoFixed":14,"alertsRaised":0}}
✓ request 1 returned HTTP 200
✓ request 2 returned HTTP 200
✗ exactly one concurrent manual trigger was skipped by the leader lock  (actual='0' expected='1')
✓ the winner actually detected the seeded stuck steps (stuckStepsFound >= 15)
── assertions: 4 pass, 1 fail
```
This is the double-execution race caught live, not simulated: both requests
ran `doExecute()` fully unguarded and concurrently — response 1 found and
auto-fixed all 15 seeded rows; response 2, racing microseconds behind, found
only 14 (one row had already flipped out of `WAITING_FOR_ACK` under it) and
auto-fixed those 14 too. Neither response's message contains "leader lock
held" (that string doesn't exist pre-fix). Exit code: `1`.
After capturing this transcript: the 10 reverted files were restored via
`git checkout --`, the orchestrator image was rebuilt, and this SE was
re-run — GREEN (see above), confirmed as part of the full `run-all.sh
--all-workflows` pass in the PR body.

## Assertions
<!-- one checkbox per ck/ck_eq call in test.sh — keep 1:1 -->
- [ ] seeded exactly 15 synthetic WAITING_FOR_ACK steps
- [ ] request 1 returned HTTP 200
- [ ] request 2 returned HTTP 200
- [ ] exactly one concurrent manual trigger was skipped by the leader lock
- [ ] the winner actually detected the seeded stuck steps (stuckStepsFound >= 15)

## Run
```bash
bash setpoint-evals/run-all.sh --se 15
```

Guards LEADER-1: the moment the advisory lock is re-scoped to only the CRON
path again (e.g. someone "simplifies" `BaseMaintenanceTask.execute()` by moving
the lock back out into each task's `scheduledRun()`), this SE goes red —
`SKIPPED_COUNT` reverts to `0` — instead of the double-execution race being
discovered later as duplicated `continueJob()` cascades in production.
