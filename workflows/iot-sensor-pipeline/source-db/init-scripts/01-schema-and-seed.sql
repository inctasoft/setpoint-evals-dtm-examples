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
-- Seed Data: Devices
-- ============================================================
INSERT INTO dbo.devices (device_id, name, type, location, firmware_version, status, registered_at, last_seen_at) VALUES
('DEV-001', 'IoT Gateway Alpha',    'temperature', 'Building A - Floor 1 - Server Room',     'v2.4.1', 'active',      '2025-01-15 08:00:00', '2025-06-15 14:30:00'),
('DEV-002', 'Smart Hub Beta',        'humidity',    'Building B - Floor 3 - Greenhouse',       'v3.1.0', 'active',      '2025-02-20 10:30:00', '2025-06-15 14:28:00'),
('DEV-003', 'Field Controller Gamma','pressure',    'Outdoor Station C - Weather Monitoring',   'v1.8.5', 'maintenance', '2025-03-10 14:00:00', '2025-06-14 09:15:00'),
('DEV-EMPTY', 'Empty Reading Device', 'temperature', 'Test Lab - No Readings', 'v1.0.0', 'active', '2025-04-01 00:00:00', '2025-04-01 00:00:00');

-- ============================================================
-- Seed Data: Sensors (3 per device = 9 total + 1 empty-reading sensor)
-- ============================================================
INSERT INTO dbo.sensors (sensor_id, device_id, type, unit, min_threshold, max_threshold, calibrated_at, status) VALUES
-- DEV-EMPTY sensor (has 0 readings — for SE 05 empty discovery test)
('SENS-EMPTY-1', 'DEV-EMPTY', 'temperature', 'celsius', 0.00, 100.00, NULL, 'active'),
-- Device 1 sensors
('SENS-001-TEMP', 'DEV-001', 'temperature', 'celsius',  15.00, 35.00, '2025-05-01 09:00:00', 'active'),
('SENS-001-HUM',  'DEV-001', 'humidity',    'percent',  30.00, 80.00, '2025-05-01 09:15:00', 'active'),
('SENS-001-PRES', 'DEV-001', 'pressure',    'hpa',     980.00, 1030.00, '2025-05-01 09:30:00', 'active'),
-- Device 2 sensors
('SENS-002-TEMP', 'DEV-002', 'temperature', 'celsius',  18.00, 32.00, '2025-04-15 11:00:00', 'active'),
('SENS-002-HUM',  'DEV-002', 'humidity',    'percent',  40.00, 90.00, '2025-04-15 11:15:00', 'active'),
('SENS-002-PRES', 'DEV-002', 'pressure',    'hpa',     990.00, 1025.00, '2025-04-15 11:30:00', 'active'),
-- Device 3 sensors
('SENS-003-TEMP', 'DEV-003', 'temperature', 'celsius',  -10.00, 45.00, '2025-03-20 14:00:00', 'inactive'),
('SENS-003-HUM',  'DEV-003', 'humidity',    'percent',  20.00, 95.00, '2025-03-20 14:15:00', 'error'),
('SENS-003-PRES', 'DEV-003', 'pressure',    'hpa',     970.00, 1040.00, '2025-03-20 14:30:00', 'active');

-- ============================================================
-- Seed Data: Readings (100 readings distributed across sensors)
-- ============================================================

-- SENS-001-TEMP: Temperature readings (12 readings, 20-28 celsius range)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-001-TEMP', 22.3400, '2025-06-15 08:00:00', 'good', 22.3512),
('SENS-001-TEMP', 22.8100, '2025-06-15 08:15:00', 'good', 22.8203),
('SENS-001-TEMP', 23.1500, '2025-06-15 08:30:00', 'good', 23.1487),
('SENS-001-TEMP', 23.7200, '2025-06-15 08:45:00', 'good', 23.7310),
('SENS-001-TEMP', 24.0800, '2025-06-15 09:00:00', 'good', 24.0915),
('SENS-001-TEMP', 24.5600, '2025-06-15 09:15:00', 'good', 24.5588),
('SENS-001-TEMP', 25.1300, '2025-06-15 09:30:00', 'good', 25.1421),
('SENS-001-TEMP', 25.8900, '2025-06-15 09:45:00', 'good', 25.8776),
('SENS-001-TEMP', 26.4200, '2025-06-15 10:00:00', 'good', 26.4315),
('SENS-001-TEMP', 27.0100, '2025-06-15 10:15:00', 'uncertain', 27.0542),
('SENS-001-TEMP', 27.5500, '2025-06-15 10:30:00', 'good', 27.5389),
('SENS-001-TEMP', 28.0300, '2025-06-15 10:45:00', 'good', 28.0412);

-- SENS-001-HUM: Humidity readings (11 readings, 45-65% range)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-001-HUM', 52.4500, '2025-06-15 08:00:00', 'good', 52.4610),
('SENS-001-HUM', 53.1200, '2025-06-15 08:15:00', 'good', 53.1305),
('SENS-001-HUM', 53.8800, '2025-06-15 08:30:00', 'good', 53.8912),
('SENS-001-HUM', 54.2100, '2025-06-15 08:45:00', 'good', 54.2233),
('SENS-001-HUM', 55.0600, '2025-06-15 09:00:00', 'good', 55.0488),
('SENS-001-HUM', 55.7400, '2025-06-15 09:15:00', 'good', 55.7521),
('SENS-001-HUM', 56.3200, '2025-06-15 09:30:00', 'uncertain', 56.3810),
('SENS-001-HUM', 57.1500, '2025-06-15 09:45:00', 'good', 57.1399),
('SENS-001-HUM', 58.0100, '2025-06-15 10:00:00', 'good', 58.0234),
('SENS-001-HUM', 58.6800, '2025-06-15 10:15:00', 'good', 58.6712),
('SENS-001-HUM', 59.4400, '2025-06-15 10:30:00', 'good', 59.4518);

-- SENS-001-PRES: Pressure readings (11 readings, 1010-1018 hpa range)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-001-PRES', 1013.2500, '2025-06-15 08:00:00', 'good', 1013.2610),
('SENS-001-PRES', 1013.1800, '2025-06-15 08:15:00', 'good', 1013.1912),
('SENS-001-PRES', 1013.0500, '2025-06-15 08:30:00', 'good', 1013.0623),
('SENS-001-PRES', 1012.9200, '2025-06-15 08:45:00', 'good', 1012.9315),
('SENS-001-PRES', 1012.8100, '2025-06-15 09:00:00', 'good', 1012.8234),
('SENS-001-PRES', 1012.6500, '2025-06-15 09:15:00', 'good', 1012.6612),
('SENS-001-PRES', 1012.5200, '2025-06-15 09:30:00', 'good', 1012.5310),
('SENS-001-PRES', 1012.3800, '2025-06-15 09:45:00', 'good', 1012.3921),
('SENS-001-PRES', 1012.2100, '2025-06-15 10:00:00', 'good', 1012.2244),
('SENS-001-PRES', 1012.0500, '2025-06-15 10:15:00', 'good', 1012.0618),
('SENS-001-PRES', 1011.9200, '2025-06-15 10:30:00', 'good', 1011.9312);

-- SENS-002-TEMP: Temperature readings (11 readings, 24-33 celsius - greenhouse warmer)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-002-TEMP', 25.6100, '2025-06-15 08:00:00', 'good', 25.6215),
('SENS-002-TEMP', 26.2400, '2025-06-15 08:15:00', 'good', 26.2512),
('SENS-002-TEMP', 27.0800, '2025-06-15 08:30:00', 'good', 27.0923),
('SENS-002-TEMP', 27.9500, '2025-06-15 08:45:00', 'good', 27.9410),
('SENS-002-TEMP', 28.7300, '2025-06-15 09:00:00', 'good', 28.7418),
('SENS-002-TEMP', 29.4100, '2025-06-15 09:15:00', 'good', 29.4234),
('SENS-002-TEMP', 30.1600, '2025-06-15 09:30:00', 'good', 30.1712),
('SENS-002-TEMP', 30.8900, '2025-06-15 09:45:00', 'good', 30.8821),
('SENS-002-TEMP', 31.5400, '2025-06-15 10:00:00', 'good', 31.5510),
('SENS-002-TEMP', 32.2100, '2025-06-15 10:15:00', 'uncertain', 32.2855),
('SENS-002-TEMP', 32.8700, '2025-06-15 10:30:00', 'good', 32.8612);

-- SENS-002-HUM: Humidity readings (11 readings, 60-78% range - greenhouse humid)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-002-HUM', 68.2300, '2025-06-15 08:00:00', 'good', 68.2415),
('SENS-002-HUM', 67.8100, '2025-06-15 08:15:00', 'good', 67.8234),
('SENS-002-HUM', 67.3500, '2025-06-15 08:30:00', 'good', 67.3612),
('SENS-002-HUM', 66.7200, '2025-06-15 08:45:00', 'good', 66.7310),
('SENS-002-HUM', 66.1800, '2025-06-15 09:00:00', 'good', 66.1923),
('SENS-002-HUM', 65.4500, '2025-06-15 09:15:00', 'good', 65.4618),
('SENS-002-HUM', 64.8100, '2025-06-15 09:30:00', 'good', 64.8212),
('SENS-002-HUM', 64.0300, '2025-06-15 09:45:00', 'good', 64.0410),
('SENS-002-HUM', 63.4600, '2025-06-15 10:00:00', 'good', 63.4521),
('SENS-002-HUM', 62.7800, '2025-06-15 10:15:00', 'good', 62.7912),
('SENS-002-HUM', 62.1500, '2025-06-15 10:30:00', 'good', 62.1634);

-- SENS-002-PRES: Pressure readings (11 readings, 1008-1015 hpa range)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-002-PRES', 1011.4200, '2025-06-15 08:00:00', 'good', 1011.4312),
('SENS-002-PRES', 1011.3500, '2025-06-15 08:15:00', 'good', 1011.3621),
('SENS-002-PRES', 1011.2800, '2025-06-15 08:30:00', 'good', 1011.2912),
('SENS-002-PRES', 1011.1500, '2025-06-15 08:45:00', 'good', 1011.1618),
('SENS-002-PRES', 1011.0200, '2025-06-15 09:00:00', 'good', 1011.0310),
('SENS-002-PRES', 1010.8800, '2025-06-15 09:15:00', 'good', 1010.8921),
('SENS-002-PRES', 1010.7100, '2025-06-15 09:30:00', 'good', 1010.7234),
('SENS-002-PRES', 1010.5500, '2025-06-15 09:45:00', 'good', 1010.5612),
('SENS-002-PRES', 1010.3800, '2025-06-15 10:00:00', 'good', 1010.3923),
('SENS-002-PRES', 1010.2100, '2025-06-15 10:15:00', 'good', 1010.2218),
('SENS-002-PRES', 1010.0500, '2025-06-15 10:30:00', 'good', 1010.0612);

-- SENS-003-TEMP: Temperature readings (11 readings, 15-30 celsius - outdoor wider range)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-003-TEMP', 16.4200, '2025-06-15 08:00:00', 'good', 16.4310),
('SENS-003-TEMP', 17.8500, '2025-06-15 08:15:00', 'good', 17.8612),
('SENS-003-TEMP', 19.2100, '2025-06-15 08:30:00', 'good', 19.2234),
('SENS-003-TEMP', 20.6700, '2025-06-15 08:45:00', 'good', 20.6818),
('SENS-003-TEMP', 22.1300, '2025-06-15 09:00:00', 'good', 22.1421),
('SENS-003-TEMP', 23.5800, '2025-06-15 09:15:00', 'good', 23.5912),
('SENS-003-TEMP', 24.9400, '2025-06-15 09:30:00', 'good', 24.9510),
('SENS-003-TEMP', 26.3100, '2025-06-15 09:45:00', 'bad', NULL),
('SENS-003-TEMP', 27.6800, '2025-06-15 10:00:00', 'good', 27.6912),
('SENS-003-TEMP', 28.9500, '2025-06-15 10:15:00', 'good', 28.9621),
('SENS-003-TEMP', 30.1200, '2025-06-15 10:30:00', 'good', 30.1310);

-- SENS-003-HUM: Humidity readings (11 readings, 35-55% range - outdoor drier)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-003-HUM', 48.7200, '2025-06-15 08:00:00', 'good', 48.7310),
('SENS-003-HUM', 47.3500, '2025-06-15 08:15:00', 'good', 47.3612),
('SENS-003-HUM', 46.1800, '2025-06-15 08:30:00', 'good', 46.1921),
('SENS-003-HUM', 44.9100, '2025-06-15 08:45:00', 'good', 44.9234),
('SENS-003-HUM', 43.6400, '2025-06-15 09:00:00', 'good', 43.6510),
('SENS-003-HUM', 42.2800, '2025-06-15 09:15:00', 'good', 42.2912),
('SENS-003-HUM', 41.0500, '2025-06-15 09:30:00', 'good', 41.0618),
('SENS-003-HUM', 39.7200, '2025-06-15 09:45:00', 'bad', NULL),
('SENS-003-HUM', 38.4100, '2025-06-15 10:00:00', 'good', 38.4212),
('SENS-003-HUM', 37.1500, '2025-06-15 10:15:00', 'good', 37.1623),
('SENS-003-HUM', 35.8200, '2025-06-15 10:30:00', 'good', 35.8310);

-- SENS-003-PRES: Pressure readings (11 readings, 1005-1012 hpa range - outdoor)
INSERT INTO dbo.readings (sensor_id, value, timestamp, quality, raw_value) VALUES
('SENS-003-PRES', 1008.5200, '2025-06-15 08:00:00', 'good', 1008.5310),
('SENS-003-PRES', 1008.3800, '2025-06-15 08:15:00', 'good', 1008.3921),
('SENS-003-PRES', 1008.1500, '2025-06-15 08:30:00', 'good', 1008.1618),
('SENS-003-PRES', 1007.9200, '2025-06-15 08:45:00', 'good', 1007.9310),
('SENS-003-PRES', 1007.6800, '2025-06-15 09:00:00', 'good', 1007.6912),
('SENS-003-PRES', 1007.4100, '2025-06-15 09:15:00', 'good', 1007.4234),
('SENS-003-PRES', 1007.1500, '2025-06-15 09:30:00', 'good', 1007.1610),
('SENS-003-PRES', 1006.8800, '2025-06-15 09:45:00', 'good', 1006.8921),
('SENS-003-PRES', 1006.6200, '2025-06-15 10:00:00', 'good', 1006.6310),
('SENS-003-PRES', 1006.3500, '2025-06-15 10:15:00', 'good', 1006.3618),
('SENS-003-PRES', 1006.0800, '2025-06-15 10:30:00', 'good', 1006.0912);

-- ============================================================
-- Seed Data: Alerts (5 threshold violations)
-- ============================================================
INSERT INTO dbo.alerts (device_id, sensor_id, severity, message, triggered_at, acknowledged_at, resolved_at) VALUES
('DEV-001', 'SENS-001-TEMP', 'warning',  'Temperature approaching upper threshold: 28.03°C (max: 35.00°C)', '2025-06-15 10:45:00', '2025-06-15 10:50:00', '2025-06-15 11:15:00'),
('DEV-002', 'SENS-002-TEMP', 'critical', 'Temperature exceeded upper threshold: 32.87°C (max: 32.00°C)',     '2025-06-15 10:30:00', '2025-06-15 10:35:00', NULL),
('DEV-003', 'SENS-003-TEMP', 'warning',  'Bad quality reading detected on temperature sensor',               '2025-06-15 09:45:00', NULL, NULL),
('DEV-003', 'SENS-003-HUM',  'critical', 'Bad quality reading detected on humidity sensor - possible sensor failure', '2025-06-15 09:45:00', '2025-06-15 10:00:00', NULL),
('DEV-003', NULL,             'info',     'Device DEV-003 entered maintenance mode - firmware update pending', '2025-06-14 09:15:00', '2025-06-14 09:20:00', '2025-06-14 10:00:00');

-- ============================================================
-- Seed Data: Aggregates (18 hourly aggregations - 2 hours x 9 sensors)
-- ============================================================
INSERT INTO dbo.aggregates (sensor_id, period_start, period_end, min_value, max_value, avg_value, sample_count, aggregation_type) VALUES
-- Hour 1: 08:00 - 09:00 (4 readings per sensor in this window)
('SENS-001-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 22.3400, 23.7200, 23.0250, 4, 'hourly'),
('SENS-001-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 52.4500, 54.2100, 53.4150, 4, 'hourly'),
('SENS-001-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1012.9200, 1013.2500, 1013.1000, 4, 'hourly'),
('SENS-002-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 25.6100, 27.9500, 26.7200, 4, 'hourly'),
('SENS-002-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 66.7200, 68.2300, 67.5275, 4, 'hourly'),
('SENS-002-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1011.1500, 1011.4200, 1011.3000, 4, 'hourly'),
('SENS-003-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 16.4200, 20.6700, 18.5375, 4, 'hourly'),
('SENS-003-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 44.9100, 48.7200, 46.7900, 4, 'hourly'),
('SENS-003-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1007.9200, 1008.5200, 1008.2425, 4, 'hourly'),
-- Hour 2: 09:00 - 10:00 (4 readings per sensor in this window)
('SENS-001-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 24.0800, 25.8900, 24.9150, 4, 'hourly'),
('SENS-001-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 55.0600, 57.1500, 56.0675, 4, 'hourly'),
('SENS-001-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1012.3800, 1012.8100, 1012.5900, 4, 'hourly'),
('SENS-002-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 28.7300, 30.8900, 29.7975, 4, 'hourly'),
('SENS-002-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 64.0300, 66.1800, 65.1150, 4, 'hourly'),
('SENS-002-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1010.5500, 1011.0200, 1010.7900, 4, 'hourly'),
('SENS-003-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 22.1300, 26.3100, 24.2400, 4, 'hourly'),
('SENS-003-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 39.7200, 43.6400, 41.6725, 4, 'hourly'),
('SENS-003-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1006.8800, 1007.6800, 1007.2800, 4, 'hourly');

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
