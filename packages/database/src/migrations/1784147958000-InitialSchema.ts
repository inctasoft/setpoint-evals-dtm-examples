import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Initial Schema (Phase 2a squash, D1 — operator-ratified 2026-07-15)
 *
 * Single clean migration that creates the ENTIRE current DTM schema —
 * dtm_jobs + dtm_steps, both enums, all indexes and foreign keys — in one
 * step. Replaces the 11-migration chain that used to build this same
 * end-state incrementally (create migration_jobs/migration_steps → add
 * fan-out columns → add/rename enum values → rename tables to dtm_* →
 * drop legacy workflow columns → rename child_entity_id → child_item_id).
 *
 * Why squash: this is an example/POC repo with no external production
 * databases to preserve migration continuity for, so there is no cost to
 * collapsing the chain — only benefit. The old chain's incremental history
 * captured mid-flight naming that was never the intended end-state
 * (`migration_jobs`, `migration_type_enum`, `order_ref_id`/`customer_*`
 * columns dropped in migration #10) and, because Postgres does not rename
 * implicit constraint/index names on `ALTER TABLE ... RENAME`, that dead
 * vocabulary was STILL LEAKING into the live schema today as
 * `migration_jobs_pkey` / `migration_steps_pkey` and the self-referencing
 * FK name `FK_migration_steps_parent` — visible in `\d dtm_jobs` despite
 * the table being named `dtm_jobs` for months. This migration gives those
 * three objects clean `dtm_*`-vocabulary names (`dtm_jobs_pkey`,
 * `dtm_steps_pkey`, `FK_dtm_steps_parent_step_id`); every other name
 * (table, column, index, enum type, enum value, the other FK) is
 * byte-for-byte identical to what the old 11-migration chain produces —
 * verified empirically by running the old chain and this migration each
 * against an empty database and diffing normalized information_schema +
 * pg_catalog dumps (see setpoint-evals/SE-14-schema-single-source/ and the
 * PR body for the diff transcript).
 *
 * Net effect (for readers who don't want to replay history):
 *   - dtm_jobs:  id, workflow_name, type, status (job_status_enum),
 *                payload, results, submitted_by, submitted_at, started_at,
 *                completed_at, updated_at, error, retry_count, max_retries
 *   - dtm_steps: id, job_id (FK -> dtm_jobs), step_value, description,
 *                status (step_status_enum), input, output, started_at,
 *                completed_at, duration_ms, error, records_processed,
 *                records_failed, retry_count, max_retry_count,
 *                execution_history, first_attempt_at, last_attempt_at,
 *                lambda_function_name, sqs_message_id, kafka_published_at,
 *                ack_received_at, ack_metadata, parent_step_id (self FK),
 *                child_index, child_item_id, child_count
 *   - job_status_enum:  pending, processing, completed, failed, cancelled,
 *                        partial_success
 *   - step_status_enum: pending, delegated, in_progress,
 *                        in_progress_retrying, completed, waiting_for_ack,
 *                        failed, skipped, partial_success,
 *                        waiting_for_children
 */
export class InitialSchema1784147958000 implements MigrationInterface {
  name = "InitialSchema1784147958000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum types
    await queryRunner.query(
      `CREATE TYPE "job_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled', 'partial_success')`,
    );
    await queryRunner.query(
      `CREATE TYPE "step_status_enum" AS ENUM('pending', 'delegated', 'in_progress', 'in_progress_retrying', 'completed', 'waiting_for_ack', 'failed', 'skipped', 'partial_success', 'waiting_for_children')`,
    );

    // dtm_jobs
    await queryRunner.query(`
      CREATE TABLE "dtm_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "workflow_name" character varying(255) NOT NULL DEFAULT 'order-processing',
        "type" character varying(255) NOT NULL,
        "status" "job_status_enum" NOT NULL DEFAULT 'pending',
        "payload" jsonb NOT NULL,
        "results" jsonb,
        "submitted_by" character varying(255),
        "submitted_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "started_at" timestamp,
        "completed_at" timestamp,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "error" text,
        "retry_count" integer NOT NULL DEFAULT 0,
        "max_retries" integer NOT NULL DEFAULT 3,
        CONSTRAINT "dtm_jobs_pkey" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_status" ON "dtm_jobs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_type" ON "dtm_jobs" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_status_type" ON "dtm_jobs" ("status", "type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_submitted_at" ON "dtm_jobs" ("submitted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_workflow_name" ON "dtm_jobs" ("workflow_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_workflow_name_status" ON "dtm_jobs" ("workflow_name", "status")`,
    );

    // dtm_steps
    await queryRunner.query(`
      CREATE TABLE "dtm_steps" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL,
        "step_value" character varying(50) NOT NULL,
        "description" text,
        "status" "step_status_enum" NOT NULL DEFAULT 'pending',
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
        "parent_step_id" uuid,
        "child_index" integer,
        "child_item_id" character varying(255),
        "child_count" integer,
        CONSTRAINT "dtm_steps_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "FK_c75ac2f0cbc178fef0b101a1cd5" FOREIGN KEY ("job_id")
          REFERENCES "dtm_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dtm_steps_parent_step_id" FOREIGN KEY ("parent_step_id")
          REFERENCES "dtm_steps"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_steps_job_id" ON "dtm_steps" ("job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_steps_status" ON "dtm_steps" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_steps_job_step_value" ON "dtm_steps" ("job_id", "step_value")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dtm_steps_retry_count" ON "dtm_steps" ("retry_count")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_dtm_steps_last_attempt_at" ON "dtm_steps" ("last_attempt_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_steps_parent_step_id" ON "dtm_steps" ("parent_step_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_steps_parent_status" ON "dtm_steps" ("parent_step_id", "status")`,
    );

    console.log("✅ Created dtm_jobs and dtm_steps (squashed InitialSchema)");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dtm_steps" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dtm_jobs" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "step_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_status_enum"`);

    console.log("✅ Dropped dtm_jobs and dtm_steps");
  }
}
