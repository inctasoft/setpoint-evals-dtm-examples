-- ============================================================
-- IoT Sensor Pipeline - Source Database Schema and Seed Data
-- ============================================================

-- Create schema
CREATE SCHEMA IF NOT EXISTS dbo;

-- ============================================================
-- Table: dbo.devices
-- ============================================================
CREATE TABLE dbo.devices (
    device_id       VARCHAR(50)     PRIMARY KEY,
    name            VARCHAR(100)    NOT NULL,
    type            VARCHAR(50)     NOT NULL,
    location        VARCHAR(200)    NOT NULL,
    firmware_version VARCHAR(20)    NOT NULL,
    status          VARCHAR(20)     NOT NULL,
    registered_at   TIMESTAMP       NOT NULL,
    last_seen_at    TIMESTAMP       NULL
);

-- ============================================================
-- Table: dbo.sensors
-- ============================================================
CREATE TABLE dbo.sensors (
    sensor_id       VARCHAR(50)     PRIMARY KEY,
    device_id       VARCHAR(50)     NOT NULL REFERENCES dbo.devices(device_id),
    type            VARCHAR(50)     NOT NULL,
    unit            VARCHAR(20)     NOT NULL,
    min_threshold   DECIMAL(10,2)   NULL,
    max_threshold   DECIMAL(10,2)   NULL,
    calibrated_at   TIMESTAMP       NULL,
    status          VARCHAR(20)     NOT NULL
);

-- ============================================================
-- Table: dbo.readings
-- ============================================================
CREATE TABLE dbo.readings (
    reading_id      SERIAL          PRIMARY KEY,
    sensor_id       VARCHAR(50)     NOT NULL REFERENCES dbo.sensors(sensor_id),
    value           DECIMAL(10,4)   NOT NULL,
    timestamp       TIMESTAMP       NOT NULL,
    quality         VARCHAR(20)     NOT NULL,
    raw_value       DECIMAL(10,4)   NULL
);

-- ============================================================
-- Table: dbo.alerts
-- ============================================================
CREATE TABLE dbo.alerts (
    alert_id        SERIAL          PRIMARY KEY,
    device_id       VARCHAR(50)     NOT NULL REFERENCES dbo.devices(device_id),
    sensor_id       VARCHAR(50)     NULL REFERENCES dbo.sensors(sensor_id),
    severity        VARCHAR(20)     NOT NULL,
    message         TEXT            NOT NULL,
    triggered_at    TIMESTAMP       NOT NULL,
    acknowledged_at TIMESTAMP       NULL,
    resolved_at     TIMESTAMP       NULL
);

-- ============================================================
-- Table: dbo.aggregates
-- ============================================================
CREATE TABLE dbo.aggregates (
    aggregate_id    SERIAL          PRIMARY KEY,
    sensor_id       VARCHAR(50)     NOT NULL REFERENCES dbo.sensors(sensor_id),
    period_start    TIMESTAMP       NOT NULL,
    period_end      TIMESTAMP       NOT NULL,
    min_value       DECIMAL(10,4)   NOT NULL,
    max_value       DECIMAL(10,4)   NOT NULL,
    avg_value       DECIMAL(10,4)   NOT NULL,
    sample_count    INTEGER         NOT NULL,
    aggregation_type VARCHAR(20)    NOT NULL
);

-- ============================================================
-- Create indexes
-- ============================================================
CREATE INDEX idx_sensors_device_id ON dbo.sensors(device_id);
CREATE INDEX idx_readings_sensor_id ON dbo.readings(sensor_id);
CREATE INDEX idx_readings_timestamp ON dbo.readings(timestamp);
CREATE INDEX idx_alerts_device_id ON dbo.alerts(device_id);
CREATE INDEX idx_alerts_sensor_id ON dbo.alerts(sensor_id);
CREATE INDEX idx_aggregates_sensor_id ON dbo.aggregates(sensor_id);
CREATE INDEX idx_aggregates_period ON dbo.aggregates(period_start, period_end);

-- ============================================================
-- Story: a greenhouse fleet. Every device is "greenhouse-N" — obviously a
-- demo fixture, not a real deployment. See ../SEED-REGISTRY.md for the full
-- row->SE map.
-- ============================================================

-- ============================================================
-- Seed Data: Devices (6 records)
-- greenhouse-1..5 assigned; greenhouse-offline assigned; greenhouse-6..9
-- RESERVED for future SEs; greenhouse-999 = not-found sentinel
-- ============================================================
INSERT INTO dbo.devices (device_id, name, type, location, firmware_version, status, registered_at, last_seen_at) VALUES
('greenhouse-1',       'Greenhouse 1 — Tomatoes',  'multi-sensor', 'North Field - Bay 1',  'v2.4.1', 'active', '2025-01-15 08:00:00', '2025-06-20 09:15:00'),
('greenhouse-2',       'Greenhouse 2 — Peppers',   'multi-sensor', 'North Field - Bay 2',  'v2.4.1', 'active', '2025-02-01 08:00:00', '2025-06-20 09:15:00'),
('greenhouse-3',       'Greenhouse 3 — Herbs',     'multi-sensor', 'South Field - Bay 1',  'v3.1.0', 'active', '2025-02-10 08:00:00', '2025-06-20 09:15:00'),
('greenhouse-4',       'Greenhouse 4 — Orchids',   'multi-sensor', 'South Field - Bay 2',  'v3.1.0', 'active', '2025-02-15 08:00:00', '2025-06-20 09:15:00'),
('greenhouse-offline', 'Greenhouse Offline — Spare Bay', 'multi-sensor', 'Storage Yard - Unwired', 'v1.0.0', 'active', '2025-03-01 00:00:00', NULL),
('greenhouse-5',       'Greenhouse 5 — Citrus',    'multi-sensor', 'South Field - Bay 3',  'v3.1.0', 'active', '2025-08-01 08:00:00', '2025-08-01 09:15:00');

-- ============================================================
-- Seed Data: Sensors (12 records — 2 per device, 3 for greenhouse-3)
-- ============================================================
INSERT INTO dbo.sensors (sensor_id, device_id, type, unit, min_threshold, max_threshold, calibrated_at, status) VALUES
-- greenhouse-1 (SE-01 happy-path): temp + humidity, calm readings
('SENS-GH1-TEMP', 'greenhouse-1', 'temperature', 'celsius', 15.00, 35.00, '2025-06-01 09:00:00', 'active'),
('SENS-GH1-HUM',  'greenhouse-1', 'humidity',    'percent', 40.00, 80.00, '2025-06-01 09:15:00', 'active'),
-- greenhouse-2 (general story fill)
('SENS-GH2-TEMP', 'greenhouse-2', 'temperature', 'celsius', 15.00, 32.00, '2025-06-01 10:00:00', 'active'),
('SENS-GH2-HUM',  'greenhouse-2', 'humidity',    'percent', 40.00, 80.00, '2025-06-01 10:15:00', 'active'),
-- greenhouse-3 (SE-03 double-fan-out — 3 sensors, wider fan-out breadth)
('SENS-GH3-TEMP', 'greenhouse-3', 'temperature', 'celsius', 15.00, 30.00, '2025-06-01 11:00:00', 'active'),
('SENS-GH3-HUM',  'greenhouse-3', 'humidity',    'percent', 45.00, 85.00, '2025-06-01 11:15:00', 'active'),
('SENS-GH3-SOIL', 'greenhouse-3', 'soil_moisture','percent', 20.00, 80.00, '2025-06-01 11:30:00', 'active'),
-- greenhouse-4 (SE-04 feature-flag-disable-alerts — temp sensor spikes)
('SENS-GH4-TEMP', 'greenhouse-4', 'temperature', 'celsius', 15.00, 35.00, '2025-06-01 12:00:00', 'active'),
('SENS-GH4-HUM',  'greenhouse-4', 'humidity',    'percent', 40.00, 80.00, '2025-06-01 12:15:00', 'active'),
-- greenhouse-offline (SE-05 empty-discovery): ONE sensor, deliberately ZERO
-- readings — this exercises the NESTED fan-out's empty case (DiscoverReadings
-- returns 0 for an otherwise-real sensor), not the outer device->sensor one.
('SENS-GHOFF-TEMP', 'greenhouse-offline', 'temperature', 'celsius', 15.00, 35.00, NULL, 'active'),
-- greenhouse-5 (SE-09 inner-empty-discovery): 2 sensors — TEMP has real
-- readings, SOIL is deliberately ZERO. Unlike greenhouse-offline (SE-05,
-- ITS ONLY sensor is empty), this proves the MIXED case: one sensor in a
-- multi-sensor fan-out set is empty while its SIBLING has real data.
('SENS-GH5-TEMP', 'greenhouse-5', 'temperature',   'celsius', 15.00, 32.00, '2025-08-01 09:00:00', 'active'),
('SENS-GH5-SOIL', 'greenhouse-5', 'soil_moisture', 'percent', 20.00, 80.00, '2025-08-01 09:15:00', 'active');

-- ============================================================
-- Seed Data: Readings (60 records — 6 per sensor; SENS-GH5-SOIL has ZERO)
-- ============================================================

-- SENS-GH1-TEMP: calm, well inside 15-35 threshold
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH1-TEMP', 20.10, '2025-06-20 08:00:00', 'good', 20.11),
('SENS-GH1-TEMP', 20.60, '2025-06-20 08:15:00', 'good', 20.58),
('SENS-GH1-TEMP', 21.20, '2025-06-20 08:30:00', 'good', 21.19),
('SENS-GH1-TEMP', 21.80, '2025-06-20 08:45:00', 'good', 21.83),
('SENS-GH1-TEMP', 22.30, '2025-06-20 09:00:00', 'good', 22.28),
('SENS-GH1-TEMP', 22.90, '2025-06-20 09:15:00', 'good', 22.92);

-- SENS-GH1-HUM
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH1-HUM', 58.20, '2025-06-20 08:00:00', 'good', 58.24),
('SENS-GH1-HUM', 59.00, '2025-06-20 08:15:00', 'good', 59.02),
('SENS-GH1-HUM', 60.10, '2025-06-20 08:30:00', 'good', 60.08),
('SENS-GH1-HUM', 61.40, '2025-06-20 08:45:00', 'good', 61.36),
('SENS-GH1-HUM', 62.00, '2025-06-20 09:00:00', 'good', 62.05),
('SENS-GH1-HUM', 62.80, '2025-06-20 09:15:00', 'good', 62.77);

-- SENS-GH2-TEMP
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH2-TEMP', 19.40, '2025-06-20 08:00:00', 'good', 19.42),
('SENS-GH2-TEMP', 20.00, '2025-06-20 08:15:00', 'good', 19.98),
('SENS-GH2-TEMP', 20.50, '2025-06-20 08:30:00', 'good', 20.51),
('SENS-GH2-TEMP', 21.00, '2025-06-20 08:45:00', 'good', 21.03),
('SENS-GH2-TEMP', 21.60, '2025-06-20 09:00:00', 'good', 21.58),
('SENS-GH2-TEMP', 22.10, '2025-06-20 09:15:00', 'good', 22.12);

-- SENS-GH2-HUM
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH2-HUM', 52.30, '2025-06-20 08:00:00', 'good', 52.31),
('SENS-GH2-HUM', 53.10, '2025-06-20 08:15:00', 'good', 53.08),
('SENS-GH2-HUM', 54.00, '2025-06-20 08:30:00', 'good', 54.03),
('SENS-GH2-HUM', 55.20, '2025-06-20 08:45:00', 'good', 55.17),
('SENS-GH2-HUM', 56.00, '2025-06-20 09:00:00', 'good', 56.04),
('SENS-GH2-HUM', 56.70, '2025-06-20 09:15:00', 'good', 56.68);

-- SENS-GH3-TEMP (SE-03 fan-out fixture)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH3-TEMP', 21.50, '2025-06-20 08:00:00', 'good', 21.52),
('SENS-GH3-TEMP', 22.10, '2025-06-20 08:15:00', 'good', 22.08),
('SENS-GH3-TEMP', 22.70, '2025-06-20 08:30:00', 'good', 22.71),
('SENS-GH3-TEMP', 23.30, '2025-06-20 08:45:00', 'good', 23.28),
('SENS-GH3-TEMP', 23.90, '2025-06-20 09:00:00', 'good', 23.93),
('SENS-GH3-TEMP', 24.50, '2025-06-20 09:15:00', 'good', 24.47);

-- SENS-GH3-HUM (SE-03 fan-out fixture)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH3-HUM', 60.10, '2025-06-20 08:00:00', 'good', 60.14),
('SENS-GH3-HUM', 61.00, '2025-06-20 08:15:00', 'good', 60.98),
('SENS-GH3-HUM', 62.20, '2025-06-20 08:30:00', 'good', 62.24),
('SENS-GH3-HUM', 63.40, '2025-06-20 08:45:00', 'good', 63.36),
('SENS-GH3-HUM', 64.10, '2025-06-20 09:00:00', 'good', 64.15),
('SENS-GH3-HUM', 65.00, '2025-06-20 09:15:00', 'good', 64.96);

-- SENS-GH3-SOIL (SE-03 fan-out fixture — 3rd sensor makes the fan-out wider)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH3-SOIL', 42.00, '2025-06-20 08:00:00', 'good', 42.05),
('SENS-GH3-SOIL', 43.20, '2025-06-20 08:15:00', 'good', 43.18),
('SENS-GH3-SOIL', 44.10, '2025-06-20 08:30:00', 'good', 44.12),
('SENS-GH3-SOIL', 45.00, '2025-06-20 08:45:00', 'good', 44.97),
('SENS-GH3-SOIL', 45.80, '2025-06-20 09:00:00', 'good', 45.83),
('SENS-GH3-SOIL', 46.50, '2025-06-20 09:15:00', 'good', 46.52);

-- SENS-GH4-TEMP (SE-04 feature-flag-disable-alerts — the alert-worthy spike)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH4-TEMP', 24.00, '2025-06-20 08:00:00', 'good', 24.02),
('SENS-GH4-TEMP', 27.50, '2025-06-20 08:15:00', 'good', 27.48),
('SENS-GH4-TEMP', 31.20, '2025-06-20 08:30:00', 'good', 31.24),
('SENS-GH4-TEMP', 35.90, '2025-06-20 08:45:00', 'good', 35.87),
('SENS-GH4-TEMP', 39.60, '2025-06-20 09:00:00', 'good', 39.63),
('SENS-GH4-TEMP', 41.80, '2025-06-20 09:15:00', 'good', 41.77);

-- SENS-GH4-HUM
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH4-HUM', 56.00, '2025-06-20 08:00:00', 'good', 56.03),
('SENS-GH4-HUM', 56.80, '2025-06-20 08:15:00', 'good', 56.77),
('SENS-GH4-HUM', 57.50, '2025-06-20 08:30:00', 'good', 57.52),
('SENS-GH4-HUM', 58.10, '2025-06-20 08:45:00', 'good', 58.08),
('SENS-GH4-HUM', 58.90, '2025-06-20 09:00:00', 'good', 58.93),
('SENS-GH4-HUM', 59.60, '2025-06-20 09:15:00', 'good', 59.58);

-- SENS-GH5-TEMP (SE-09 inner-empty-discovery — the sibling WITH data)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-GH5-TEMP', 21.00, '2025-08-01 08:00:00', 'good', 21.02),
('SENS-GH5-TEMP', 21.50, '2025-08-01 08:15:00', 'good', 21.48),
('SENS-GH5-TEMP', 22.00, '2025-08-01 08:30:00', 'good', 22.03),
('SENS-GH5-TEMP', 22.40, '2025-08-01 08:45:00', 'good', 22.38),
('SENS-GH5-TEMP', 22.90, '2025-08-01 09:00:00', 'good', 22.92),
('SENS-GH5-TEMP', 23.30, '2025-08-01 09:15:00', 'good', 23.27);
-- SENS-GH5-SOIL: deliberately ZERO readings — the inner-empty-discovery case.

-- ============================================================
-- Seed Data: Alerts (1 record — the greenhouse-4 heat spike)
-- EvaluateAlert queries by device_id, so this is the ONLY device with any
-- alert; greenhouse-1/2/3 legitimately have zero (valid empty result).
-- ============================================================
INSERT INTO dbo.alerts (device_id, sensor_id, severity, message, triggered_at, acknowledged_at, resolved_at) VALUES
('greenhouse-4', 'SENS-GH4-TEMP', 'critical', 'Temperature spike: 41.80°C exceeds max threshold 35.00°C — orchids at risk', '2025-06-20 09:15:00', NULL, NULL);

-- ============================================================
-- Seed Data: Aggregates (9 records — 1 hourly rollup per sensor)
-- ============================================================
INSERT INTO dbo.aggregates (sensor_id, period_start, period_end, min_value, max_value, avg_value, sample_count, aggregation_type) VALUES
('SENS-GH1-TEMP', '2025-06-20 08:00:00', '2025-06-20 09:15:00', 20.10, 22.90, 21.48, 6, 'hourly'),
('SENS-GH1-HUM',  '2025-06-20 08:00:00', '2025-06-20 09:15:00', 58.20, 62.80, 60.58, 6, 'hourly'),
('SENS-GH2-TEMP', '2025-06-20 08:00:00', '2025-06-20 09:15:00', 19.40, 22.10, 20.77, 6, 'hourly'),
('SENS-GH2-HUM',  '2025-06-20 08:00:00', '2025-06-20 09:15:00', 52.30, 56.70, 54.55, 6, 'hourly'),
('SENS-GH3-TEMP', '2025-06-20 08:00:00', '2025-06-20 09:15:00', 21.50, 24.50, 23.00, 6, 'hourly'),
('SENS-GH3-HUM',  '2025-06-20 08:00:00', '2025-06-20 09:15:00', 60.10, 65.00, 62.64, 6, 'hourly'),
('SENS-GH3-SOIL', '2025-06-20 08:00:00', '2025-06-20 09:15:00', 42.00, 46.50, 44.43, 6, 'hourly'),
('SENS-GH4-TEMP', '2025-06-20 08:00:00', '2025-06-20 09:15:00', 24.00, 41.80, 33.33, 6, 'hourly'),
('SENS-GH4-HUM',  '2025-06-20 08:00:00', '2025-06-20 09:15:00', 56.00, 59.60, 57.83, 6, 'hourly');

-- ============================================================
-- Verify seed data counts
-- ============================================================
DO $$
DECLARE
    v_devices    INTEGER;
    v_sensors    INTEGER;
    v_readings   INTEGER;
    v_alerts     INTEGER;
    v_aggregates INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_devices    FROM dbo.devices;
    SELECT COUNT(*) INTO v_sensors    FROM dbo.sensors;
    SELECT COUNT(*) INTO v_readings   FROM dbo.readings;
    SELECT COUNT(*) INTO v_alerts     FROM dbo.alerts;
    SELECT COUNT(*) INTO v_aggregates FROM dbo.aggregates;

    RAISE NOTICE '=== IoT Sensor Pipeline Seed Data Summary ===';
    RAISE NOTICE 'Devices:    % rows', v_devices;
    RAISE NOTICE 'Sensors:    % rows', v_sensors;
    RAISE NOTICE 'Readings:   % rows', v_readings;
    RAISE NOTICE 'Alerts:     % rows', v_alerts;
    RAISE NOTICE 'Aggregates: % rows', v_aggregates;
END $$;
