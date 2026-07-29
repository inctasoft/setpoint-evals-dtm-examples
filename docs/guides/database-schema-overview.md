# Database Schema Overview

## Core Database (`dtm`)

**Connection**: `docker exec dtm-db psql -U dtm_user -d dtm`
**Host port**: 5448 → Container port: 5432

Three tables power all orchestration (`dtm_jobs`, `dtm_steps`, plus `dtm_dead_letters`
for the redelivery engine's bus-neutral dead-letter quarantine).

---

## dtm_jobs

Tracks workflow job execution.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Job identifier (auto-generated) |
| `workflow_name` | VARCHAR | NOT NULL | Workflow config name (e.g., 'order-processing', 'iot-sensor-pipeline') |
| `type` | VARCHAR | NOT NULL | Variant/type (e.g., 'default', 'quick-order') |
| `status` | ENUM | NOT NULL | `pending`, `processing`, `completed`, `partial_success`, `failed`, `cancelled` |
| `payload` | JSONB | NULL | Job-specific data (filter keys, testOptions, featureFlags) |
| `submitted_by` | VARCHAR | NULL | User/system that created the job |
| `submitted_at` | TIMESTAMP | NOT NULL | Job creation timestamp |
| `started_at` | TIMESTAMP | NULL | When orchestration began |
| `completed_at` | TIMESTAMP | NULL | When job reached terminal state |
| `updated_at` | TIMESTAMP | NOT NULL | Last modification |
| `error` | TEXT | NULL | Error message (failed jobs) |
| `retry_count` | INT | DEFAULT 0 | Job-level retry count |
| `max_retries` | INT | DEFAULT 3 | Job-level max retries |
| `results` | JSONB | NULL | Final statistics (totalRecordsProcessed, totalRecordsFailed, etc.) |

### payload JSONB Structure (example)
```json
{
  "customerId": 1,
  "orderId": 1,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidatePayment": { "failForItemIds": ["99999"] }
  },
  "featureFlags": {
    "enableDeduplication": true
  }
}
```

### results JSONB Structure (example)
```json
{
  "totalRecordsProcessed": 12,
  "totalRecordsFailed": 1,
  "totalDurationMs": 45230,
  "stepsSummary": {
    "completed": 11,
    "failed": 1,
    "skipped": 2
  }
}
```

---

## dtm_steps

Tracks individual step execution within a job.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Step identifier (auto-generated) |
| `job_id` | UUID | FK → dtm_jobs.id | Parent job |
| `step_value` | VARCHAR | NOT NULL | Step name (e.g., 'ValidateCustomer', 'SubmitOrder') |
| `description` | TEXT | NULL | Human-readable description |
| `status` | ENUM | NOT NULL | See Step Status enum below |
| `input` | JSONB | NULL | Input parameters sent to worker via SQS |
| `output` | JSONB | NULL | Output data received via worker callback |
| `started_at` | TIMESTAMP | NULL | When step was created |
| `completed_at` | TIMESTAMP | NULL | When step reached terminal state |
| `duration_ms` | INT | NULL | Total end-to-end duration |
| `error` | TEXT | NULL | Error message (failed steps) |
| `records_processed` | INT | DEFAULT 0 | Successfully processed record count |
| `records_failed` | INT | DEFAULT 0 | Failed record count |
| `lambda_function_name` | VARCHAR | NULL | Lambda function name |
| `sqs_message_id` | VARCHAR | NULL | SQS message ID (for tracking/debugging) |
| `retry_count` | INT | DEFAULT 0 | Current retry attempt |
| `max_retry_count` | INT | DEFAULT 3 | Maximum retries allowed |
| `attempt_count` | INT | DEFAULT 0 | Bus-neutral synthetic dispatch counter — incremented on every (re-)dispatch; the redelivery engine's attempt source of truth. Inert under the SQS profile |
| `lease_expires_at` | TIMESTAMP | NULL | Delegation lease — the redelivery engine re-dispatches the step if still non-terminal past this time. NULL = no lease (never scanned) |
| `first_attempt_at` | TIMESTAMP | NULL | First execution start |
| `last_attempt_at` | TIMESTAMP | NULL | Most recent execution start |
| `execution_history` | JSONB | NULL | Array of ExecutionAttempt records |
| `kafka_published_at` | TIMESTAMP | NULL | When published to Kafka completion topic |
| `ack_received_at` | TIMESTAMP | NULL | When ACK was received from Kafka |
| `ack_metadata` | JSONB | NULL | ACK payload data (externalId, timestamps, etc.) |
| `parent_step_id` | UUID | FK → dtm_steps.id, NULL | Parent step (for fan-out children) |
| `child_index` | INT | NULL | Child position (0-based) in fan-out |
| `child_item_id` | VARCHAR | NULL | Item ID for this child (e.g., order item ID) |
| `child_count` | INT | NULL | Total number of children (set on parent/discovery steps) |

### Step Status Enum
```
pending                  → Not yet started
delegated                → Sent to SQS, awaiting worker pickup
in_progress              → Worker processing
in_progress_retrying     → Transient failure, SQS will re-deliver
completed                → Successfully finished
waiting_for_ack          → Published to Kafka, awaiting external ACK
waiting_for_children     → Discovery step waiting for fan-out children
failed                   → Permanently failed (retries exhausted)
skipped                  → Skipped because a dependency failed
partial_success          → Some children succeeded, some failed (fan-out parents)
```

### execution_history JSONB Structure
```json
[
  {
    "attempt": 1,
    "startedAt": "2026-02-19T10:00:00Z",
    "completedAt": "2026-02-19T10:00:02Z",
    "status": "failed",
    "error": "Connection timeout",
    "processingTimeMs": 2000,
    "sqsMessageId": "msg-001",
    "sqsReceiveCount": 1
  },
  {
    "attempt": 2,
    "startedAt": "2026-02-19T10:00:35Z",
    "completedAt": "2026-02-19T10:00:36Z",
    "status": "completed",
    "processingTimeMs": 1200,
    "sqsMessageId": "msg-001",
    "sqsReceiveCount": 2
  }
]
```

### ack_metadata JSONB Structure
```json
{
  "externalId": "uuid-from-external-system",
  "processedAt": "2026-02-19T10:01:00Z",
  "externalSystemId": "EXT-12345"
}
```

---

## dtm_dead_letters

Bus-neutral dead-letter quarantine written by the redelivery engine (maintenance task
`redelivery-engine`) when a step exhausts `max_retry_count` dispatch attempts. This is
the table-based replacement for a native bus DLQ — under the SQS profile nothing is
written here (SQS routes to its own DLQ, see SE-02).

Deliberately **no foreign keys** to `dtm_steps` / `dtm_jobs`: a dead letter is an
audit record that must survive job cleanup (old-job cleanup cascades delete steps).

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | UUID | PK | Dead-letter identifier (auto-generated) |
| `step_id` | UUID | NOT NULL | Step that exhausted its attempts |
| `job_id` | UUID | NOT NULL | Job the step belonged to |
| `workflow_name` | VARCHAR | NOT NULL | Workflow config name (copied for post-cleanup querying) |
| `step_value` | VARCHAR | NOT NULL | Step name (e.g., 'ValidateCustomer') |
| `attempt_count` | INT | NOT NULL | Synthetic dispatch-attempt count at exhaustion |
| `last_error` | TEXT | NULL | Last error the step reported |
| `input` | JSONB | NULL | Input payload the step was dispatched with (for replay/inspection) |
| `created_at` | TIMESTAMP | NOT NULL | When the dead letter was written |

---

## Relationships

```
dtm_jobs (1) ──→ (N) dtm_steps     [job_id FK]
dtm_steps (1) ──→ (N) dtm_steps     [parent_step_id FK, self-referential for fan-out]
```

Fan-out relationship:
- **Parent step** (discovery): `child_count` set, status `WAITING_FOR_CHILDREN`
- **Child steps**: `parent_step_id` set, `child_index` (0-based), `child_item_id` (item identifier)

---

## Key Queries

### Job status summary
```sql
SELECT id, workflow_name, type, status,
       submitted_at, completed_at,
       (completed_at - started_at) AS duration
FROM dtm_jobs
ORDER BY submitted_at DESC LIMIT 10;
```

### Step breakdown for a job
```sql
SELECT step_value, status, retry_count, records_processed,
       started_at, completed_at, duration_ms
FROM dtm_steps
WHERE job_id = '<JOB_ID>'
ORDER BY step_value;
```

### Fan-out children
```sql
SELECT parent.step_value AS parent, parent.child_count,
       child.step_value, child.child_index, child.child_item_id, child.status
FROM dtm_steps child
JOIN dtm_steps parent ON child.parent_step_id = parent.id
WHERE parent.job_id = '<JOB_ID>'
ORDER BY parent.step_value, child.child_index;
```

### Failed steps with errors
```sql
SELECT step_value, status, error, retry_count, max_retry_count
FROM dtm_steps
WHERE job_id = '<JOB_ID>' AND status IN ('failed', 'skipped')
ORDER BY step_value;
```

### ACK tracking
```sql
SELECT step_value, status, kafka_published_at, ack_received_at,
       (ack_received_at - kafka_published_at) AS ack_latency,
       ack_metadata
FROM dtm_steps
WHERE job_id = '<JOB_ID>' AND kafka_published_at IS NOT NULL
ORDER BY kafka_published_at;
```

---

## Workflow Source Databases

Each workflow has its own isolated source database. Workers query these databases — the orchestrator never accesses them directly.

| Workflow | Container | Host Port | Database | User | Tables |
|----------|-----------|-----------|----------|------|--------|
| order-processing | dtm-order-processing-source-db | 5449 | order_processing_db | order_user | customers, products, orders, line_items, payments, shipments |
| iot-sensor-pipeline | dtm-iot-sensor-pipeline-source-db | 5450 | iot_sensor_pipeline_db | iot_user | devices, sensors, readings, alerts, calibrations |
| infra-provisioning | dtm-infra-provisioning-source-db | 5451 | infra_provisioning_db | infra_user | environments, clusters, services, deployments, configs, secrets, endpoints |

Source database schemas are defined in `workflows/<name>/source-db/init-scripts/`.
