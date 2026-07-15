#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# DTM — All-in-one PostgreSQL initializer
# Creates all workflow source DBs and product DBs on dtm-db.
# In production each of these would be a separate RDS instance;
# locally we share one container for simplicity.
# ─────────────────────────────────────────────────────────────────────────────

# 1. Create users + databases (in POSTGRES_DB connection)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- ── Order Processing ──────────────────────────────────────────────────────
  CREATE USER order_user WITH PASSWORD 'order_pass';
  CREATE DATABASE order_processing_db OWNER order_user;
  CREATE DATABASE order_processing_product_db OWNER order_user;

  -- ── IoT Sensor Pipeline ───────────────────────────────────────────────────
  CREATE USER iot_user WITH PASSWORD 'iot_pass';
  CREATE DATABASE iot_sensor_pipeline_db OWNER iot_user;
  CREATE DATABASE iot_sensor_pipeline_product_db OWNER iot_user;

  -- ── Infra Provisioning ────────────────────────────────────────────────────
  CREATE USER infra_user WITH PASSWORD 'infra_pass';
  CREATE DATABASE infra_provisioning_db OWNER infra_user;
  CREATE DATABASE infra_provisioning_product_db OWNER infra_user;
EOSQL

# 2. Load order-processing source schema+seed (in order_processing_db)
psql -v ON_ERROR_STOP=1 --username "order_user" --dbname "order_processing_db" <<-EOSQL
-- ============================================================
-- Order Processing Source Database
-- Schema creation, table definitions, and seed data
-- ============================================================

-- Create the ecommerce schema
CREATE SCHEMA IF NOT EXISTS ecommerce;

-- ============================================================
-- Table: ecommerce.customers
-- ============================================================
CREATE TABLE ecommerce.customers (
    customer_id    INTEGER      PRIMARY KEY,
    first_name     VARCHAR(50)  NOT NULL,
    last_name      VARCHAR(50)  NOT NULL,
    email          VARCHAR(100) NOT NULL,
    phone          VARCHAR(20),
    address        TEXT,
    created_at     TIMESTAMP    NOT NULL
);

-- ============================================================
-- Table: ecommerce.products
-- ============================================================
CREATE TABLE ecommerce.products (
    product_id     INTEGER       PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    sku            VARCHAR(50)   NOT NULL,
    price          DECIMAL(10,2) NOT NULL,
    category       VARCHAR(50),
    description    TEXT,
    in_stock       BOOLEAN       NOT NULL DEFAULT TRUE
);

-- ============================================================
-- Table: ecommerce.orders
-- ============================================================
CREATE TABLE ecommerce.orders (
    order_id         INTEGER       PRIMARY KEY,
    customer_id      INTEGER       NOT NULL REFERENCES ecommerce.customers(customer_id),
    order_date       TIMESTAMP     NOT NULL,
    status           VARCHAR(20)   NOT NULL,
    total_amount     DECIMAL(10,2) NOT NULL,
    shipping_address TEXT
);

-- ============================================================
-- Table: ecommerce.order_items
-- ============================================================
CREATE TABLE ecommerce.order_items (
    order_item_id  INTEGER       PRIMARY KEY,
    order_id       INTEGER       NOT NULL REFERENCES ecommerce.orders(order_id),
    product_id     INTEGER       NOT NULL REFERENCES ecommerce.products(product_id),
    quantity       INTEGER       NOT NULL,
    unit_price     DECIMAL(10,2) NOT NULL,
    subtotal       DECIMAL(10,2) NOT NULL
);

-- ============================================================
-- Table: ecommerce.payments
-- ============================================================
CREATE TABLE ecommerce.payments (
    payment_id      INTEGER       PRIMARY KEY,
    order_id        INTEGER       NOT NULL REFERENCES ecommerce.orders(order_id),
    payment_method  VARCHAR(50)   NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    payment_date    TIMESTAMP     NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    transaction_ref VARCHAR(100)
);

-- ============================================================
-- Table: ecommerce.shipments
-- ============================================================
CREATE TABLE ecommerce.shipments (
    shipment_id        INTEGER     PRIMARY KEY,
    order_id           INTEGER     NOT NULL REFERENCES ecommerce.orders(order_id),
    carrier            VARCHAR(50) NOT NULL,
    tracking_number    VARCHAR(100),
    shipped_date       TIMESTAMP,
    estimated_delivery TIMESTAMP,
    status             VARCHAR(20) NOT NULL
);

-- ============================================================
-- Seed Data: Customers (5 records)
-- ============================================================
INSERT INTO ecommerce.customers (customer_id, first_name, last_name, email, phone, address, created_at) VALUES
(1, 'Sarah',   'Mitchell',  'sarah.mitchell@email.com',   '(415) 555-0142', '742 Evergreen Terrace, San Francisco, CA 94102',  '2025-01-15 09:30:00'),
(2, 'James',   'Rodriguez', 'james.rodriguez@email.com',  '(312) 555-0198', '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610',   '2025-02-20 14:15:00'),
(3, 'Emily',   'Chen',      'emily.chen@email.com',       '(206) 555-0173', '889 Pine Street, Suite 12, Seattle, WA 98101',    '2025-03-08 11:45:00'),
(4, 'Michael', 'Thompson',  'michael.thompson@email.com', NULL,             '2501 Peachtree Rd NE, Atlanta, GA 30305',         '2025-04-12 16:20:00'),
(5, 'Olivia',  'Patel',     'olivia.patel@email.com',     '(512) 555-0156', NULL,                                              '2025-05-01 10:00:00');

-- ============================================================
-- Seed Data: Products (10 records)
-- ============================================================
INSERT INTO ecommerce.products (product_id, name, sku, price, category, description, in_stock) VALUES
(1,  'Sony WH-1000XM5 Wireless Headphones',    'SONY-WH1000XM5',   349.99, 'Electronics',     'Industry-leading noise canceling overhead headphones with Auto NC Optimizer',   TRUE),
(2,  'Apple iPad Air 11-inch (M2)',             'APPLE-IPADAIR-M2',  599.00, 'Electronics',     '11-inch Liquid Retina display, M2 chip, 128GB storage',                         TRUE),
(3,  'Patagonia Better Sweater Fleece Jacket',  'PAT-BTSW-FLC-M',   139.00, 'Clothing',        'Fair Trade Certified sewn, 100% recycled polyester fleece',                      TRUE),
(4,  'Yeti Rambler 20 oz Tumbler',              'YETI-RAM-20OZ',      35.00, 'Kitchen',         'Double-wall vacuum insulated, 18/8 stainless steel tumbler with MagSlider Lid', TRUE),
(5,  'Moleskine Classic Notebook Large',         'MLSK-CLSC-LG',      19.95, 'Office Supplies', 'Large ruled notebook, hard cover, 240 pages, 5 x 8.25 inches',                 TRUE),
(6,  'Nike Air Max 270 Running Shoes',           'NIKE-AM270-BLK',   159.99, 'Footwear',        'Max Air unit delivers unrivaled all-day comfort, black colorway',               TRUE),
(7,  'Bose SoundLink Flex Bluetooth Speaker',   'BOSE-SLKFLEX',     149.00, 'Electronics',     'Portable waterproof Bluetooth speaker with deep, clear sound',                  TRUE),
(8,  'Le Creuset Enameled Cast Iron Dutch Oven', 'LECR-DO-5QT',     379.95, 'Kitchen',         '5.5 qt round Dutch oven in Flame, superior heat distribution',                  FALSE),
(9,  'Osprey Daylite Plus Backpack',             'OSP-DAYLTP-BLU',    74.95, 'Outdoor',         '20L daypack with laptop sleeve, panel-loading design, blue colorway',           TRUE),
(10, 'Kindle Paperwhite Signature Edition',      'AMZN-KPW-SIG',    189.99, 'Electronics',     '6.8-inch display, wireless charging, auto-adjusting front light, 32GB',         TRUE);

-- ============================================================
-- Seed Data: Orders (8 records)
-- ============================================================
INSERT INTO ecommerce.orders (order_id, customer_id, order_date, status, total_amount, shipping_address) VALUES
(1, 1, '2025-06-01 10:23:00', 'delivered',  404.94, '742 Evergreen Terrace, San Francisco, CA 94102'),
(2, 2, '2025-06-05 14:45:00', 'delivered',  827.95, '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610'),
(3, 1, '2025-06-12 09:10:00', 'shipped',    149.85, '742 Evergreen Terrace, San Francisco, CA 94102'),
(4, 3, '2025-06-18 16:30:00', 'shipped',    453.79, '889 Pine Street, Suite 12, Seattle, WA 98101'),
(5, 4, '2025-06-25 11:55:00', 'confirmed',  569.84, '2501 Peachtree Rd NE, Atlanta, GA 30305'),
(6, 5, '2025-07-02 08:40:00', 'confirmed',  837.95, '318 Congress Ave, Austin, TX 78701'),
(7, 2, '2025-07-08 13:20:00', 'pending',    159.99, '1200 Lake Shore Dr, Apt 4B, Chicago, IL 60610'),
(8, 3, '2025-07-10 17:05:00', 'pending',    569.94, '889 Pine Street, Suite 12, Seattle, WA 98101');

-- ============================================================
-- Seed Data: Order Items (25 records)
-- ============================================================
INSERT INTO ecommerce.order_items (order_item_id, order_id, product_id, quantity, unit_price, subtotal) VALUES
(1,  1, 1,  1, 349.99, 349.99),
(2,  1, 4,  1,  35.00,  35.00),
(3,  1, 5,  1,  19.95,  19.95),
(4,  2, 2,  1, 599.00, 599.00),
(5,  2, 3,  1, 139.00, 139.00),
(6,  2, 4,  2,  35.00,  70.00),
(7,  2, 5,  1,  19.95,  19.95),
(8,  3, 5,  2,  19.95,  39.90),
(9,  3, 9,  1,  74.95,  74.95),
(10, 3, 4,  1,  35.00,  35.00),
(11, 4, 7,  1, 149.00, 149.00),
(12, 4, 5,  4,  19.95,  79.80),
(13, 4, 4,  1,  35.00,  35.00),
(14, 4, 10, 1, 189.99, 189.99),
(15, 5, 1,  1, 349.99, 349.99),
(16, 5, 4,  3,  35.00, 105.00),
(17, 5, 9,  1,  74.95,  74.95),
(18, 5, 5,  2,  19.95,  39.90),
(19, 6, 2,  1, 599.00, 599.00),
(20, 6, 5,  1,  19.95,  19.95),
(21, 6, 4,  2,  35.00,  70.00),
(22, 6, 7,  1, 149.00, 149.00),
(23, 7, 6,  1, 159.99, 159.99),
(24, 8, 8,  1, 379.95, 379.95),
(25, 8, 10, 1, 189.99, 189.99);

-- ============================================================
-- Seed Data: Payments (8 records)
-- ============================================================
INSERT INTO ecommerce.payments (payment_id, order_id, payment_method, amount, payment_date, status, transaction_ref) VALUES
(1, 1, 'credit_card',   404.94, '2025-06-01 10:25:00', 'completed', 'TXN-CC-20250601-0001'),
(2, 2, 'paypal',        827.95, '2025-06-05 14:48:00', 'completed', 'TXN-PP-20250605-0002'),
(3, 3, 'credit_card',   149.85, '2025-06-12 09:12:00', 'completed', 'TXN-CC-20250612-0003'),
(4, 4, 'bank_transfer', 453.79, '2025-06-18 16:35:00', 'completed', 'TXN-BT-20250618-0004'),
(5, 5, 'credit_card',   569.84, '2025-06-25 11:58:00', 'completed', 'TXN-CC-20250625-0005'),
(6, 6, 'paypal',        837.95, '2025-07-02 08:42:00', 'completed', 'TXN-PP-20250702-0006'),
(7, 7, 'credit_card',   159.99, '2025-07-08 13:22:00', 'pending',   NULL),
(8, 8, 'bank_transfer', 569.94, '2025-07-10 17:08:00', 'pending',   NULL);

-- ============================================================
-- Seed Data: Shipments (6 records)
-- ============================================================
INSERT INTO ecommerce.shipments (shipment_id, order_id, carrier, tracking_number, shipped_date, estimated_delivery, status) VALUES
(1, 1, 'ups',   '1Z999AA10123456784',  '2025-06-02 08:00:00', '2025-06-05 18:00:00', 'delivered'),
(2, 2, 'fedex', '794644790301',        '2025-06-06 10:30:00', '2025-06-09 18:00:00', 'delivered'),
(3, 3, 'usps',  '9400111899223100001', '2025-06-13 07:45:00', '2025-06-17 18:00:00', 'shipped'),
(4, 4, 'ups',   '1Z999AA10123456785',  '2025-06-19 09:15:00', '2025-06-23 18:00:00', 'in_transit'),
(5, 5, 'dhl',   NULL,                   NULL,                   NULL,                   'preparing'),
(6, 6, 'fedex', NULL,                   NULL,                   NULL,                   'preparing');
EOSQL

# 3. Load iot source schema+seed (in iot_sensor_pipeline_db)
psql -v ON_ERROR_STOP=1 --username "iot_user" --dbname "iot_sensor_pipeline_db" <<-EOSQL
-- ============================================================
-- IoT Sensor Pipeline - Source Database Schema and Seed Data
-- ============================================================

CREATE SCHEMA IF NOT EXISTS dbo;

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

CREATE TABLE dbo.readings (
    reading_id      SERIAL          PRIMARY KEY,
    sensor_id       VARCHAR(50)     NOT NULL REFERENCES dbo.sensors(sensor_id),
    value           DECIMAL(10,4)   NOT NULL,
    timestamp       TIMESTAMP       NOT NULL,
    quality         VARCHAR(20)     NOT NULL,
    raw_value       DECIMAL(10,4)   NULL
);

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

CREATE INDEX idx_sensors_device_id ON dbo.sensors(device_id);
CREATE INDEX idx_readings_sensor_id ON dbo.readings(sensor_id);
CREATE INDEX idx_readings_timestamp ON dbo.readings(timestamp);
CREATE INDEX idx_alerts_device_id ON dbo.alerts(device_id);
CREATE INDEX idx_alerts_sensor_id ON dbo.alerts(sensor_id);
CREATE INDEX idx_aggregates_sensor_id ON dbo.aggregates(sensor_id);
CREATE INDEX idx_aggregates_period ON dbo.aggregates(period_start, period_end);

INSERT INTO dbo.devices (device_id, name, type, location, firmware_version, status, registered_at, last_seen_at) VALUES
('DEV-001', 'IoT Gateway Alpha',    'temperature', 'Building A - Floor 1 - Server Room',     'v2.4.1', 'active',      '2025-01-15 08:00:00', '2025-06-15 14:30:00'),
('DEV-002', 'Smart Hub Beta',        'humidity',    'Building B - Floor 3 - Greenhouse',       'v3.1.0', 'active',      '2025-02-20 10:30:00', '2025-06-15 14:28:00'),
('DEV-003', 'Field Controller Gamma','pressure',    'Outdoor Station C - Weather Monitoring',   'v1.8.5', 'maintenance', '2025-03-10 14:00:00', '2025-06-14 09:15:00'),
('DEV-EMPTY', 'Empty Reading Device', 'temperature', 'Test Lab - No Readings', 'v1.0.0', 'active', '2025-04-01 00:00:00', '2025-04-01 00:00:00');

INSERT INTO dbo.sensors (sensor_id, device_id, type, unit, min_threshold, max_threshold, calibrated_at, status) VALUES
('SENS-EMPTY-1', 'DEV-EMPTY', 'temperature', 'celsius', 0.00, 100.00, NULL, 'active'),
('SENS-001-TEMP', 'DEV-001', 'temperature', 'celsius',  15.00, 35.00, '2025-05-01 09:00:00', 'active'),
('SENS-001-HUM',  'DEV-001', 'humidity',    'percent',  30.00, 80.00, '2025-05-01 09:15:00', 'active'),
('SENS-001-PRES', 'DEV-001', 'pressure',    'hpa',     980.00, 1030.00, '2025-05-01 09:30:00', 'active'),
('SENS-002-TEMP', 'DEV-002', 'temperature', 'celsius',  18.00, 32.00, '2025-04-15 11:00:00', 'active'),
('SENS-002-HUM',  'DEV-002', 'humidity',    'percent',  40.00, 90.00, '2025-04-15 11:15:00', 'active'),
('SENS-002-PRES', 'DEV-002', 'pressure',    'hpa',     990.00, 1025.00, '2025-04-15 11:30:00', 'active'),
('SENS-003-TEMP', 'DEV-003', 'temperature', 'celsius',  -10.00, 45.00, '2025-03-20 14:00:00', 'inactive'),
('SENS-003-HUM',  'DEV-003', 'humidity',    'percent',  20.00, 95.00, '2025-03-20 14:15:00', 'error'),
('SENS-003-PRES', 'DEV-003', 'pressure',    'hpa',     970.00, 1040.00, '2025-03-20 14:30:00', 'active');

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
('SENS-001-TEMP', 28.0300, '2025-06-15 10:45:00', 'good', 28.0412),
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
('SENS-001-HUM', 59.4400, '2025-06-15 10:30:00', 'good', 59.4518),
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
('SENS-001-PRES', 1011.9200, '2025-06-15 10:30:00', 'good', 1011.9312),
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
('SENS-002-TEMP', 32.8700, '2025-06-15 10:30:00', 'good', 32.8612),
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
('SENS-002-HUM', 62.1500, '2025-06-15 10:30:00', 'good', 62.1634),
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
('SENS-002-PRES', 1010.0500, '2025-06-15 10:30:00', 'good', 1010.0612),
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
('SENS-003-TEMP', 30.1200, '2025-06-15 10:30:00', 'good', 30.1310),
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
('SENS-003-HUM', 35.8200, '2025-06-15 10:30:00', 'good', 35.8310),
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

INSERT INTO dbo.alerts (device_id, sensor_id, severity, message, triggered_at, acknowledged_at, resolved_at) VALUES
('DEV-001', 'SENS-001-TEMP', 'warning',  'Temperature approaching upper threshold: 28.03°C (max: 35.00°C)', '2025-06-15 10:45:00', '2025-06-15 10:50:00', '2025-06-15 11:15:00'),
('DEV-002', 'SENS-002-TEMP', 'critical', 'Temperature exceeded upper threshold: 32.87°C (max: 32.00°C)',     '2025-06-15 10:30:00', '2025-06-15 10:35:00', NULL),
('DEV-003', 'SENS-003-TEMP', 'warning',  'Bad quality reading detected on temperature sensor',               '2025-06-15 09:45:00', NULL, NULL),
('DEV-003', 'SENS-003-HUM',  'critical', 'Bad quality reading detected on humidity sensor - possible sensor failure', '2025-06-15 09:45:00', '2025-06-15 10:00:00', NULL),
('DEV-003', NULL,             'info',     'Device DEV-003 entered maintenance mode - firmware update pending', '2025-06-14 09:15:00', '2025-06-14 09:20:00', '2025-06-14 10:00:00');

INSERT INTO dbo.aggregates (sensor_id, period_start, period_end, min_value, max_value, avg_value, sample_count, aggregation_type) VALUES
('SENS-001-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 22.3400, 23.7200, 23.0250, 4, 'hourly'),
('SENS-001-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 52.4500, 54.2100, 53.4150, 4, 'hourly'),
('SENS-001-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1012.9200, 1013.2500, 1013.1000, 4, 'hourly'),
('SENS-002-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 25.6100, 27.9500, 26.7200, 4, 'hourly'),
('SENS-002-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 66.7200, 68.2300, 67.5275, 4, 'hourly'),
('SENS-002-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1011.1500, 1011.4200, 1011.3000, 4, 'hourly'),
('SENS-003-TEMP', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 16.4200, 20.6700, 18.5375, 4, 'hourly'),
('SENS-003-HUM',  '2025-06-15 08:00:00', '2025-06-15 09:00:00', 44.9100, 48.7200, 46.7900, 4, 'hourly'),
('SENS-003-PRES', '2025-06-15 08:00:00', '2025-06-15 09:00:00', 1007.9200, 1008.5200, 1008.2425, 4, 'hourly'),
('SENS-001-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 24.0800, 25.8900, 24.9150, 4, 'hourly'),
('SENS-001-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 55.0600, 57.1500, 56.0675, 4, 'hourly'),
('SENS-001-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1012.3800, 1012.8100, 1012.5900, 4, 'hourly'),
('SENS-002-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 28.7300, 30.8900, 29.7975, 4, 'hourly'),
('SENS-002-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 64.0300, 66.1800, 65.1150, 4, 'hourly'),
('SENS-002-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1010.5500, 1011.0200, 1010.7900, 4, 'hourly'),
('SENS-003-TEMP', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 22.1300, 26.3100, 24.2400, 4, 'hourly'),
('SENS-003-HUM',  '2025-06-15 09:00:00', '2025-06-15 10:00:00', 39.7200, 43.6400, 41.6725, 4, 'hourly'),
('SENS-003-PRES', '2025-06-15 09:00:00', '2025-06-15 10:00:00', 1006.8800, 1007.6800, 1007.2800, 4, 'hourly');
EOSQL

# 4. Load infra source schema+seed (in infra_provisioning_db)
psql -v ON_ERROR_STOP=1 --username "infra_user" --dbname "infra_provisioning_db" <<-EOSQL
-- ============================================================
-- Infra Provisioning Source Database
-- Schema creation, table definitions, and seed data
-- ============================================================

CREATE SCHEMA IF NOT EXISTS dbo;

CREATE TABLE dbo.environments (
    environment_id  VARCHAR(50)  PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    type            VARCHAR(20)  NOT NULL,
    region          VARCHAR(50)  NOT NULL,
    account_id      VARCHAR(50)  NOT NULL,
    status          VARCHAR(20)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL
);

CREATE TABLE dbo.networks (
    network_id        VARCHAR(50)  PRIMARY KEY,
    environment_id    VARCHAR(50)  NOT NULL REFERENCES dbo.environments(environment_id),
    name              VARCHAR(100) NOT NULL,
    vpc_cidr          VARCHAR(20)  NOT NULL,
    subnet_cidr       VARCHAR(20)  NOT NULL,
    availability_zone VARCHAR(20)  NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    created_at        TIMESTAMP    NOT NULL
);

CREATE TABLE dbo.compute_instances (
    instance_id   VARCHAR(50)  PRIMARY KEY,
    network_id    VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    name          VARCHAR(100) NOT NULL,
    instance_type VARCHAR(20)  NOT NULL,
    ami_id        VARCHAR(50)  NOT NULL,
    status        VARCHAR(20)  NOT NULL,
    public_ip     VARCHAR(20),
    private_ip    VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL
);

CREATE TABLE dbo.storage_volumes (
    volume_id    VARCHAR(50)  PRIMARY KEY,
    instance_id  VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    name         VARCHAR(100) NOT NULL,
    size_gb      INTEGER      NOT NULL,
    volume_type  VARCHAR(10)  NOT NULL,
    iops         INTEGER,
    status       VARCHAR(20)  NOT NULL,
    attached_at  TIMESTAMP
);

CREATE TABLE dbo.dns_records (
    record_id    VARCHAR(50)  PRIMARY KEY,
    network_id   VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    instance_id  VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    hostname     VARCHAR(200) NOT NULL,
    record_type  VARCHAR(10)  NOT NULL,
    value        VARCHAR(200) NOT NULL,
    ttl          INTEGER      NOT NULL,
    status       VARCHAR(20)  NOT NULL,
    created_at   TIMESTAMP    NOT NULL
);

CREATE TABLE dbo.certificates (
    certificate_id VARCHAR(50)  PRIMARY KEY,
    dns_record_id  VARCHAR(50)  NOT NULL REFERENCES dbo.dns_records(record_id),
    domain         VARCHAR(200) NOT NULL,
    issuer         VARCHAR(100) NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    issued_at      TIMESTAMP,
    expires_at     TIMESTAMP,
    created_at     TIMESTAMP    NOT NULL
);

CREATE TABLE dbo.load_balancers (
    lb_id             VARCHAR(50)  PRIMARY KEY,
    network_id        VARCHAR(50)  NOT NULL REFERENCES dbo.networks(network_id),
    instance_id       VARCHAR(50)  NOT NULL REFERENCES dbo.compute_instances(instance_id),
    name              VARCHAR(100) NOT NULL,
    type              VARCHAR(10)  NOT NULL,
    port              INTEGER      NOT NULL,
    protocol          VARCHAR(10)  NOT NULL,
    health_check_path VARCHAR(200) NOT NULL,
    status            VARCHAR(20)  NOT NULL,
    created_at        TIMESTAMP    NOT NULL
);

INSERT INTO dbo.environments (environment_id, name, type, region, account_id, status, created_at) VALUES
('ENV-DEV',     'Development',  'dev',     'us-east-1', 'aws-acct-111111111111', 'active', '2025-01-10 08:00:00'),
('ENV-STAGING', 'Staging',      'staging', 'us-west-2', 'aws-acct-222222222222', 'active', '2025-01-15 10:00:00');

INSERT INTO dbo.networks (network_id, environment_id, name, vpc_cidr, subnet_cidr, availability_zone, status, created_at) VALUES
('NET-DEV-1', 'ENV-DEV',     'dev-vpc-primary',     '10.0.0.0/16', '10.0.1.0/24', 'us-east-1a', 'active', '2025-01-10 08:30:00'),
('NET-STG-1', 'ENV-STAGING', 'staging-vpc-primary',  '10.1.0.0/16', '10.1.1.0/24', 'us-west-2a', 'active', '2025-01-15 10:30:00'),
('NET-STG-2', 'ENV-STAGING', 'staging-vpc-secondary','10.2.0.0/16', '10.2.1.0/24', 'us-west-2b', 'active', '2025-01-15 11:00:00');

INSERT INTO dbo.compute_instances (instance_id, network_id, name, instance_type, ami_id, status, public_ip, private_ip, created_at) VALUES
('INST-DEV-1', 'NET-DEV-1', 'web-server-dev-1',  't3.medium',  'ami-0abcdef1234567890', 'running', '54.89.123.45',  '10.0.1.10',  '2025-01-10 09:00:00'),
('INST-DEV-2', 'NET-DEV-1', 'api-server-dev-1',  't3.medium',  'ami-0abcdef1234567890', 'running', NULL,            '10.0.1.11',  '2025-01-10 09:15:00'),
('INST-STG-1', 'NET-STG-1', 'web-server-stg-1',  'm5.large',   'ami-0fedcba9876543210', 'running', '52.38.201.100', '10.1.1.10',  '2025-01-15 11:00:00'),
('INST-STG-2', 'NET-STG-1', 'api-server-stg-1',  'm5.large',   'ami-0fedcba9876543210', 'running', NULL,            '10.1.1.11',  '2025-01-15 11:15:00'),
('INST-STG-3', 'NET-STG-2', 'worker-server-stg-1','c5.xlarge',  'ami-0fedcba9876543210', 'running', NULL,            '10.2.1.10',  '2025-01-15 11:30:00'),
('INST-STG-4', 'NET-STG-2', 'cache-server-stg-1', 't3.medium',  'ami-0fedcba9876543210', 'running', NULL,            '10.2.1.11',  '2025-01-15 11:45:00');

INSERT INTO dbo.storage_volumes (volume_id, instance_id, name, size_gb, volume_type, iops, status, attached_at) VALUES
('VOL-DEV-1', 'INST-DEV-1', 'web-server-dev-1-root',     50,  'gp3', NULL,  'in-use', '2025-01-10 09:05:00'),
('VOL-DEV-2', 'INST-DEV-2', 'api-server-dev-1-root',     50,  'gp3', NULL,  'in-use', '2025-01-10 09:20:00'),
('VOL-STG-1', 'INST-STG-1', 'web-server-stg-1-root',     100, 'gp3', NULL,  'in-use', '2025-01-15 11:05:00'),
('VOL-STG-2', 'INST-STG-2', 'api-server-stg-1-data',     200, 'io2', 5000,  'in-use', '2025-01-15 11:20:00'),
('VOL-STG-3', 'INST-STG-3', 'worker-server-stg-1-data',  500, 'io2', 10000, 'in-use', '2025-01-15 11:35:00'),
('VOL-STG-4', 'INST-STG-4', 'cache-server-stg-1-root',   100, 'gp3', NULL,  'in-use', '2025-01-15 11:50:00');

INSERT INTO dbo.dns_records (record_id, network_id, instance_id, hostname, record_type, value, ttl, status, created_at) VALUES
('DNS-DEV-1', 'NET-DEV-1', 'INST-DEV-1', 'web-dev.internal.example.com',     'A',     '10.0.1.10',                        300,  'active', '2025-01-10 09:30:00'),
('DNS-STG-1', 'NET-STG-1', 'INST-STG-1', 'web-stg.staging.example.com',      'A',     '10.1.1.10',                        300,  'active', '2025-01-15 12:00:00'),
('DNS-STG-2', 'NET-STG-1', 'INST-STG-2', 'api-stg.staging.example.com',      'A',     '10.1.1.11',                        300,  'active', '2025-01-15 12:15:00'),
('DNS-STG-3', 'NET-STG-2', 'INST-STG-3', 'worker-stg.staging.example.com',   'CNAME', 'worker-server-stg-1.ec2.internal', 3600, 'active', '2025-01-15 12:30:00');

INSERT INTO dbo.certificates (certificate_id, dns_record_id, domain, issuer, status, issued_at, expires_at, created_at) VALUES
('CERT-DEV-1', 'DNS-DEV-1', 'web-dev.internal.example.com', 'LetsEncrypt', 'issued', '2025-01-10 10:00:00', '2026-01-10 10:00:00', '2025-01-10 09:45:00'),
('CERT-STG-1', 'DNS-STG-1', 'web-stg.staging.example.com', 'Amazon', 'issued', '2025-01-15 13:00:00', '2026-01-15 13:00:00', '2025-01-15 12:45:00'),
('CERT-STG-2', 'DNS-STG-2', 'api-stg.staging.example.com', 'Amazon', 'issued', '2025-01-15 13:15:00', '2026-01-15 13:15:00', '2025-01-15 13:00:00');

INSERT INTO dbo.load_balancers (lb_id, network_id, instance_id, name, type, port, protocol, health_check_path, status, created_at) VALUES
('LB-DEV-1',  'NET-DEV-1', 'INST-DEV-1', 'web-alb-dev-1', 'ALB', 443,  'HTTPS', '/health',     'active', '2025-01-10 10:00:00'),
('LB-STG-1',  'NET-STG-1', 'INST-STG-1', 'web-alb-stg-1', 'ALB', 443,  'HTTPS', '/health',     'active', '2025-01-15 13:30:00'),
('LB-STG-2',  'NET-STG-1', 'INST-STG-2', 'api-alb-stg-1', 'ALB', 8443, 'HTTPS', '/api/health', 'active', '2025-01-15 13:45:00');
EOSQL

# 5. Create product schemas
# order_processing_product_db
psql -v ON_ERROR_STOP=1 --username "order_user" --dbname "order_processing_product_db" <<-EOSQL
CREATE TABLE IF NOT EXISTS processed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL UNIQUE,
  workflow_name VARCHAR(100) NOT NULL,
  started_at TIMESTAMP,
  completed_at TIMESTAMP DEFAULT NOW(),
  customer_count INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  line_item_count INTEGER DEFAULT 0,
  payment_count INTEGER DEFAULT 0,
  shipment_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS processed_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_customer_id INTEGER NOT NULL,
  external_customer_id VARCHAR(255),
  full_name VARCHAR(200),
  email_address VARCHAR(200),
  phone_number VARCHAR(50),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_order_id INTEGER NOT NULL,
  external_order_id VARCHAR(255),
  external_customer_id VARCHAR(255),
  total_amount DECIMAL(10,2),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_line_item_id INTEGER NOT NULL,
  external_line_item_id VARCHAR(255),
  external_order_id VARCHAR(255),
  sku VARCHAR(100),
  quantity INTEGER,
  unit_price DECIMAL(10,2),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_payment_id INTEGER NOT NULL,
  external_payment_id VARCHAR(255),
  external_order_id VARCHAR(255),
  payment_method VARCHAR(50),
  amount DECIMAL(10,2),
  status VARCHAR(50),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_shipment_id INTEGER NOT NULL,
  external_shipment_id VARCHAR(255),
  external_order_id VARCHAR(255),
  carrier VARCHAR(50),
  tracking_number VARCHAR(200),
  status VARCHAR(50),
  processed_at TIMESTAMP DEFAULT NOW()
);
EOSQL

# iot_sensor_pipeline_product_db
psql -v ON_ERROR_STOP=1 --username "iot_user" --dbname "iot_sensor_pipeline_product_db" <<-EOSQL
CREATE TABLE IF NOT EXISTS processed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL UNIQUE,
  workflow_name VARCHAR(100) NOT NULL,
  completed_at TIMESTAMP DEFAULT NOW(),
  device_count INTEGER DEFAULT 0,
  sensor_count INTEGER DEFAULT 0,
  reading_count INTEGER DEFAULT 0,
  alert_count INTEGER DEFAULT 0,
  aggregate_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS registered_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_device_id VARCHAR(255) NOT NULL,
  external_device_id VARCHAR(255),
  device_type VARCHAR(100),
  location VARCHAR(255),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activated_sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_sensor_id VARCHAR(255) NOT NULL,
  external_sensor_id VARCHAR(255),
  external_device_id VARCHAR(255),
  model VARCHAR(100),
  unit VARCHAR(50),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archived_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_reading_id VARCHAR(255) NOT NULL,
  external_reading_id VARCHAR(255),
  external_sensor_id VARCHAR(255),
  value DECIMAL(15,6),
  unit VARCHAR(50),
  reading_timestamp TIMESTAMP,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatched_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_alert_id VARCHAR(255) NOT NULL,
  external_alert_id VARCHAR(255),
  external_device_id VARCHAR(255),
  severity VARCHAR(50),
  message TEXT,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS published_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_aggregate_id VARCHAR(255) NOT NULL,
  external_aggregate_id VARCHAR(255),
  external_sensor_id VARCHAR(255),
  metric VARCHAR(100),
  value DECIMAL(15,6),
  processed_at TIMESTAMP DEFAULT NOW()
);
EOSQL

# infra_provisioning_product_db
psql -v ON_ERROR_STOP=1 --username "infra_user" --dbname "infra_provisioning_product_db" <<-EOSQL
CREATE TABLE IF NOT EXISTS processed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL UNIQUE,
  workflow_name VARCHAR(100) NOT NULL,
  completed_at TIMESTAMP DEFAULT NOW(),
  environment_count INTEGER DEFAULT 0,
  network_count INTEGER DEFAULT 0,
  compute_count INTEGER DEFAULT 0,
  storage_count INTEGER DEFAULT 0,
  dns_count INTEGER DEFAULT 0,
  certificate_count INTEGER DEFAULT 0,
  load_balancer_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provisioned_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_env_id VARCHAR(255),
  external_env_id VARCHAR(255),
  name VARCHAR(200),
  cloud_provider VARCHAR(50),
  region VARCHAR(100),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_network_id VARCHAR(255),
  external_network_id VARCHAR(255),
  external_env_id VARCHAR(255),
  cidr VARCHAR(50),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_compute (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_compute_id VARCHAR(255),
  external_compute_id VARCHAR(255),
  external_network_id VARCHAR(255),
  instance_type VARCHAR(100),
  instance_count INTEGER,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_storage_id VARCHAR(255),
  external_storage_id VARCHAR(255),
  external_compute_id VARCHAR(255),
  storage_type VARCHAR(50),
  size_gb INTEGER,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_dns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_dns_id VARCHAR(255),
  external_dns_id VARCHAR(255),
  external_network_id VARCHAR(255),
  zone VARCHAR(200),
  record_count INTEGER,
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_cert_id VARCHAR(255),
  external_cert_id VARCHAR(255),
  external_dns_id VARCHAR(255),
  domain VARCHAR(255),
  issuer VARCHAR(100),
  processed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioned_load_balancers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL REFERENCES processed_jobs(job_id),
  source_lb_id VARCHAR(255),
  external_lb_id VARCHAR(255),
  external_network_id VARCHAR(255),
  lb_type VARCHAR(50),
  endpoint VARCHAR(255),
  processed_at TIMESTAMP DEFAULT NOW()
);
EOSQL
