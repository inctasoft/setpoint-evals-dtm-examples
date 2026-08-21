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

# 2-4. Load each workflow's source schema+seed from the CANONICAL seed files.
#
# ⚠️  NO INLINED SQL HERE (2026-07-16): this script used to carry a full inlined
# copy of every workflow's schema+seed. That copy silently drifted from
# workflows/*/source-db/init-scripts/01-schema-and-seed.sql — workers read
# dtm-db (this container), the per-workflow source-db containers loaded the
# real files, and the two disagreed until SEs failed with "not found in source
# database". The seed files are now MOUNTED (see docker-compose.yml db service)
# and loaded verbatim, so dtm-db and the per-workflow containers can never
# diverge again. Edit ONLY workflows/<name>/source-db/init-scripts/*.sql.
SEED_DIR="/dtm-workflow-seeds"

load_workflow_seed() {
  local db_user="$1" db_name="$2" seed_file="$3"
  if [ ! -f "$seed_file" ]; then
    echo >&2 "FATAL: workflow seed file not mounted: $seed_file"
    echo >&2 "       (docker-compose.yml db service must mount workflows/*/source-db/init-scripts/01-schema-and-seed.sql into $SEED_DIR/)"
    exit 1
  fi
  echo "Loading $seed_file into $db_name (as $db_user)..."
  psql -v ON_ERROR_STOP=1 --username "$db_user" --dbname "$db_name" -f "$seed_file"
}

load_workflow_seed order_user order_processing_db      "$SEED_DIR/order-processing.sql"
load_workflow_seed iot_user   iot_sensor_pipeline_db   "$SEED_DIR/iot-sensor-pipeline.sql"
load_workflow_seed infra_user infra_provisioning_db    "$SEED_DIR/infra-provisioning.sql"


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
