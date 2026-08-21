# IoT Sensor Pipeline Workflow

## Overview

The IoT Sensor Pipeline is a DTM (Distributed Task Manager) workflow that ingests and transforms data from an IoT sensor monitoring system. It demonstrates advanced orchestration capabilities including **double/nested fan-out**, **feature flags**, **conditional steps**, and **empty discovery handling**.

The pipeline processes IoT device registrations along with their associated sensors, time-series readings, threshold alerts, and hourly aggregations. Data flows from a source PostgreSQL database through domain-specific pipeline steps (register, provision, calibrate, activate, ingest, publish, evaluate, dispatch, compute), ultimately producing target system formatted records.

## Domain Model (5 Entities)

```
Device (root)
  |                           |
  | 1:N (device_id)           | 1:N (device_id)
  v                           v
Sensor                      Alert
  |
  | 1:N (sensor_id)           | 1:N (sensor_id)
  v                           v
Reading                     Aggregate
```

| Entity | Type | PK | FK | Description |
|--------|------|----|----|-------------|
| **Device** | Root | `device_id` (varchar) | -- | IoT device registration (name, type, location, firmware, status) |
| **Sensor** | Fan-out child | `sensor_id` (varchar) | `device_id` | Sensor attached to device (type, unit, thresholds, calibration) |
| **Reading** | Nested fan-out child | `reading_id` (serial) | `sensor_id` | Individual sensor measurement (value, timestamp, quality) |
| **Alert** | Dependent | `alert_id` (serial) | `device_id` | Threshold breach alert (severity, message, triggered/acknowledged/resolved) |
| **Aggregate** | Dependent | `aggregate_id` (serial) | `sensor_id` | Hourly rollup of readings (min, max, avg, sample count) |

### Entity Criticality

| Entity | Criticality | Notes |
|--------|------------|-------|
| Device | **Required** | Root entity -- pipeline fails without it |
| Sensor | **Required** | Must have at least 1 sensor |
| Reading | **Required** | Must have at least 1 reading |
| Alert | Optional | Pipeline succeeds even if alerts fail |
| Aggregate | Optional | Pipeline succeeds even if aggregates fail |

## Step DAG Visualization

```
RegisterDevice
      |
ProvisionDevice
      |
      +----------------------------+
      |                            |
DiscoverSensors                    |
      |                            |
      +-- N x CalibrateSensor      |
              |                    |
      N x ActivateSensor           |
              |                    |
      +-------+-------+           |
      |               |           |
N x DiscoverReadings  |           |
      |               |           |
N x M x IngestReading |           |
      |               |           |
N x M x PublishReading             |
      |               |           |
      +-------+-------+           |
              |                    |
      +-------+-------+           |
      |               |           |
EvaluateAlert   ComputeAggregate   |
      |               |           |
DispatchAlert   PublishAggregate   |
      |               |           |
      +-------+-------+-----------+
              |
         Job Complete
```

## DTM Capabilities Demonstrated

### 1. Double/Nested Fan-Out
The pipeline features a **two-level fan-out**:
- **Level 1**: `DiscoverSensors` discovers N sensors for a device, spawning N `CalibrateSensor` child step chains
- **Level 2**: Each sensor triggers `DiscoverReadings`, which discovers M readings, spawning M `IngestReading` child step chains

This creates a tree of `1 x N x M` reading processing steps from a single device.

### 2. Feature Flags
The workflow defines feature flags that can be overridden per-job:
- `ENABLE_ALERT_GENERATION` -- When `false`, EvaluateAlert and DispatchAlert steps are skipped
- `ENABLE_AGGREGATION` -- When `false`, ComputeAggregate and PublishAggregate steps are skipped
- `ENABLE_DEDUPLICATION` -- Controls job-level deduplication
- `ENABLE_CASCADE_FK_INJECTION` -- Controls FK propagation through entity cascade

### 3. Conditional Steps
Alert and Aggregate steps depend on both the reading pipeline and the device/sensor pipeline respectively, creating multi-dependency conditional execution paths.

### 4. Empty Discovery Handling
When `DiscoverReadings` returns 0 reading IDs for a sensor, the orchestrator gracefully handles this:
- No child steps are created (childCount: 0)
- The reading entity is marked as "empty" (valid outcome)
- The pipeline continues without failure

## Step Descriptions

| # | Step | Type | Queue | Description |
|---|------|------|-------|-------------|
| 1 | RegisterDevice | Register | `iot-register-device` | Register device and validate identity/firmware |
| 2 | ProvisionDevice | Provision | `iot-provision-device` | Provision device configuration to IoT platform |
| 3 | DiscoverSensors | Discovery | `iot-discover-sensors` | Find sensor IDs for device (fan-out) |
| 4 | CalibrateSensor | Calibrate (child) | `iot-calibrate-sensor` | Calibrate sensor and validate measurement parameters |
| 5 | ActivateSensor | Activate (child) | `iot-activate-sensor` | Activate sensor on IoT platform |
| 6 | DiscoverReadings | Discovery (nested) | `iot-discover-readings` | Find reading IDs for sensor (nested fan-out) |
| 7 | IngestReading | Ingest (child) | `iot-ingest-reading` | Ingest one reading batch from sensor data store |
| 8 | PublishReading | Publish (child) | `iot-publish-reading` | Publish normalized reading to analytics platform |
| 9 | EvaluateAlert | Evaluate | `iot-evaluate-alert` | Evaluate threshold conditions to detect anomalies |
| 10 | DispatchAlert | Dispatch | `iot-dispatch-alert` | Dispatch alert notification |
| 11 | ComputeAggregate | Compute | `iot-compute-aggregate` | Compute statistical aggregation over readings |
| 12 | PublishAggregate | Publish | `iot-publish-aggregate` | Publish aggregated metrics to analytics platform |

## Source Database Schema

**Database**: `iot_sensor_pipeline_db`
**Port**: 5450 (host) -> 5432 (container)
**User**: `iot_user` / `iot_pass`
**Schema**: `dbo`

### Tables

```sql
-- dbo.devices
CREATE TABLE dbo.devices (
  device_id      VARCHAR(50) PRIMARY KEY,
  name           VARCHAR(100),
  type           VARCHAR(50),
  location       VARCHAR(200),
  firmware_version VARCHAR(20),
  status         VARCHAR(20),
  registered_at  TIMESTAMP,
  last_seen_at   TIMESTAMP
);

-- dbo.sensors
CREATE TABLE dbo.sensors (
  sensor_id      VARCHAR(50) PRIMARY KEY,
  device_id      VARCHAR(50) REFERENCES dbo.devices,
  type           VARCHAR(50),
  unit           VARCHAR(20),
  min_threshold  DECIMAL(10,2),
  max_threshold  DECIMAL(10,2),
  calibrated_at  TIMESTAMP,
  status         VARCHAR(20)
);

-- dbo.readings
CREATE TABLE dbo.readings (
  reading_id     SERIAL PRIMARY KEY,
  sensor_id      VARCHAR(50) REFERENCES dbo.sensors,
  value          DECIMAL(10,4),
  timestamp      TIMESTAMP,
  quality        VARCHAR(20),
  raw_value      DECIMAL(10,4)
);

-- dbo.alerts
CREATE TABLE dbo.alerts (
  alert_id       SERIAL PRIMARY KEY,
  device_id      VARCHAR(50) REFERENCES dbo.devices,
  sensor_id      VARCHAR(50),
  severity       VARCHAR(20),
  message        TEXT,
  triggered_at   TIMESTAMP,
  acknowledged_at TIMESTAMP,
  resolved_at    TIMESTAMP
);

-- dbo.aggregates
CREATE TABLE dbo.aggregates (
  aggregate_id   SERIAL PRIMARY KEY,
  sensor_id      VARCHAR(50) REFERENCES dbo.sensors,
  period_start   TIMESTAMP,
  period_end     TIMESTAMP,
  min_value      DECIMAL(10,4),
  max_value      DECIMAL(10,4),
  avg_value      DECIMAL(10,4),
  sample_count   INTEGER,
  aggregation_type VARCHAR(20)
);
```

## SE Catalog (Setpoint Evals)

| # | Test | Purpose | Expected Status |
|---|------|---------|----------------|
| 01 | Happy Path | Full pipeline: device with sensors, readings, alerts, aggregates | COMPLETED |
| 02 | Device Not Found | Missing device (critical entity fails) | FAILED |
| 03 | Double Fan-Out | 3 sensors x N readings each, verify nested fan-out | COMPLETED |
| 04 | Feature Flag: Disable Alerts | Set `ENABLE_ALERT_GENERATION: false`, verify alert steps skipped | COMPLETED |
| 05 | Empty Discovery | Sensor with 0 readings, DiscoverReadings returns empty array | COMPLETED |
| 06 | Seed Data Integrity | Proves the seed validator itself is load-bearing (deletes a row from a clone, requires RED) | PASS (validator) |
| 07 | Feature Flag Three-Layer Resolution | `ENABLE_ALERT_GENERATION` default < env var < per-request (gated by `clientOverridable`) against the live gating path, not just the documented contract | multiple (destructive, 2 orchestrator recreates) |
| 08 | Nested Fan-Out Partial Failure | IngestReading (grandchild-level) forced to fail every attempt — proves failure aggregates through BOTH fan-out levels | PARTIAL_SUCCESS / FAILED |
| 09 | Inner-Empty Discovery (mixed sensor set) | One sensor has zero readings, its sibling has real data — empty result must not affect the sibling or fail the pipeline | COMPLETED |

### Running SEs

```bash
# Run all iot-sensor-pipeline SEs
./workflows/iot-sensor-pipeline/setpoint-evals/run-all.sh

# Run a specific SE (id or name substring; --se is an alias for --eval)
./workflows/iot-sensor-pipeline/setpoint-evals/run-all.sh --se 01

# Or invoke a test.sh directly
bash ./workflows/iot-sensor-pipeline/setpoint-evals/SE-01-happy-path/test.sh
```

## Project Structure

```
workflows/iot-sensor-pipeline/
  workflow.config.ts                          # Step DAG, cascades, outcome rules, feature flags
  docker-compose.iot-sensor-pipeline.yml      # Source database container
  README.md                                   # This file
  source-db/
    src/
      config/datasource.ts                    # TypeORM DataSource configuration
      entities/
        device.entity.ts                      # Device entity
        sensor.entity.ts                      # Sensor entity
        reading.entity.ts                     # Reading entity
        alert.entity.ts                       # Alert entity
        aggregate.entity.ts                   # Aggregate entity
        index.ts                              # Entity barrel export
      index.ts                                # Package barrel export
    init-scripts/                             # SQL seed data (mounted into container)
  workers/
    package.json                              # @dtm-workflows/iot-sensor-pipeline-workers
    tsconfig.json                             # TypeScript configuration
    esbuild.config.js                         # Build config (12 handlers)
    src/
      index.ts                                # Handler map + named exports
      handlers/
        register-device.ts                    # Register device and validate identity
        provision-device.ts                   # Provision device to IoT platform
        discover-sensors.ts                   # Discover sensor IDs (fan-out)
        calibrate-sensor.ts                   # Calibrate sensor (child step)
        activate-sensor.ts                    # Activate sensor on platform (child step)
        discover-readings.ts                  # Discover reading IDs (nested fan-out)
        ingest-reading.ts                     # Ingest one reading (child step)
        publish-reading.ts                    # Publish reading to analytics (child step)
        evaluate-alert.ts                     # Evaluate threshold conditions
        dispatch-alert.ts                     # Dispatch alert notification
        compute-aggregate.ts                  # Compute statistical aggregation
        publish-aggregate.ts                  # Publish aggregated metrics
  setpoint-evals/
    run-all.sh                                # Run all 5 SEs
    shared/helpers.sh                         # Workflow-specific SE helpers
    01-happy-path/test.sh                     # Full pipeline success
    02-device-not-found/test.sh               # Critical entity failure
    03-double-fan-out/test.sh                 # Nested fan-out verification
    04-feature-flag-disable-alerts/test.sh    # Feature flag conditional steps
    05-empty-discovery/test.sh                # Empty discovery graceful handling
```
