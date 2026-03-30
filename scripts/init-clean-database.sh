#!/bin/bash
# Initialize Clean Database
# Drops all tables and creates ONLY dtm_jobs and dtm_steps
# Use this after clean:all to ensure a clean state

set -e

echo "🗑️  Dropping all tables and recreating clean schema..."

docker exec dtm-db psql -U dtm_user -d dtm -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO dtm_user; GRANT ALL ON SCHEMA public TO public; CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" > /dev/null

echo "✅ Schema reset complete"
echo ""
echo "📁 Creating clean tables..."

docker exec -i dtm-db psql -U dtm_user -d dtm <<'EOF'
BEGIN;

-- Create enum types
CREATE TYPE "job_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE "migration_type_enum" AS ENUM('membership', 'deal');
CREATE TYPE "step_status_enum" AS ENUM('pending', 'delegated', 'in_progress', 'in_progress_retrying', 'completed', 'waiting_for_ack', 'failed', 'skipped');

-- Create dtm_jobs table
CREATE TABLE "dtm_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" migration_type_enum NOT NULL,
  "status" job_status_enum NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,
  "results" jsonb,
  "deal_id" character varying(255),
  "membership_number" character varying(255),
  "membership_id" uuid,
  "submitted_by" character varying(255),
  "submitted_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" timestamp,
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "error" text,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 3
);

-- Create indexes for dtm_jobs
CREATE INDEX "IDX_dtm_jobs_status" ON "dtm_jobs" ("status");
CREATE INDEX "IDX_dtm_jobs_type" ON "dtm_jobs" ("type");
CREATE INDEX "IDX_dtm_jobs_status_type" ON "dtm_jobs" ("status", "type");
CREATE INDEX "IDX_dtm_jobs_deal_id" ON "dtm_jobs" ("deal_id");
CREATE INDEX "IDX_dtm_jobs_membership_number" ON "dtm_jobs" ("membership_number");
CREATE INDEX "IDX_dtm_jobs_membership_id" ON "dtm_jobs" ("membership_id");
CREATE INDEX "IDX_dtm_jobs_submitted_at" ON "dtm_jobs" ("submitted_at");

-- Create dtm_steps table
CREATE TABLE "dtm_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL,
  "step_value" character varying(50) NOT NULL,
  "description" text,
  "status" step_status_enum NOT NULL DEFAULT 'pending',
  "input" jsonb,
  "output" jsonb,
  "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamp,
  "duration_ms" integer,
  "error" text,
  "records_processed" integer NOT NULL DEFAULT 0,
  "records_failed" integer NOT NULL DEFAULT 0,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retry_count" integer NOT NULL DEFAULT 3,
  "execution_history" jsonb DEFAULT '[]'::jsonb,
  "first_attempt_at" timestamp,
  "last_attempt_at" timestamp,
  "lambda_function_name" character varying(255),
  "sqs_message_id" character varying(255),
  "kafka_published_at" timestamp,
  "ack_received_at" timestamp,
  "ack_metadata" jsonb,
  CONSTRAINT "FK_c75ac2f0cbc178fef0b101a1cd5" FOREIGN KEY ("job_id") 
    REFERENCES "dtm_jobs"("id") ON DELETE CASCADE
);

-- Create indexes for dtm_steps
CREATE INDEX "IDX_dtm_steps_job_id" ON "dtm_steps" ("job_id");
CREATE INDEX "IDX_dtm_steps_status" ON "dtm_steps" ("status");
CREATE INDEX "IDX_dtm_steps_job_step_value" ON "dtm_steps" ("job_id", "step_value");
CREATE INDEX "idx_dtm_steps_retry_count" ON "dtm_steps" ("retry_count");
CREATE INDEX "idx_dtm_steps_last_attempt_at" ON "dtm_steps" ("last_attempt_at");

-- Create migrations table (TypeORM migration history)
CREATE TABLE "migrations" (
  "id" SERIAL PRIMARY KEY,
  "timestamp" bigint NOT NULL,
  "name" character varying NOT NULL
);

-- Record ONLY the clean migration
INSERT INTO "migrations" ("timestamp", "name") VALUES (1765443716000, 'InitialMigrationSchema1765443716000');

COMMIT;
EOF

echo "✅ Clean database created successfully!"
echo ""
echo "Tables:"
docker exec dtm-db psql -U dtm_user -d dtm -c "\dt"
echo ""
echo "Migration History:"
docker exec dtm-db psql -U dtm_user -d dtm -c "SELECT timestamp, name FROM migrations;"

