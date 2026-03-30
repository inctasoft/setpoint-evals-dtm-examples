import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Initial Migration Schema
 *
 * Creates the core migration tracking tables:
 * - migration_jobs: Tracks migration jobs with status, payload, and metadata
 * - migration_steps: Tracks individual steps within each job with retry logic
 *
 * This is a clean-slate migration for the POC, creating only the essential tables
 * needed for the step-based orchestration pattern.
 */
export class InitialMigrationSchema1765443716000 implements MigrationInterface {
  name = "InitialMigrationSchema1765443716000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(
      `CREATE TYPE "job_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "migration_type_enum" AS ENUM('membership', 'deal')`,
    );
    await queryRunner.query(
      `CREATE TYPE "step_status_enum" AS ENUM('pending', 'delegated', 'in_progress', 'in_progress_retrying', 'completed', 'waiting_for_ack', 'failed', 'skipped')`,
    );

    // Create migration_jobs table
    await queryRunner.query(`
      CREATE TABLE "migration_jobs" (
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
      )
    `);

    // Create indexes for migration_jobs
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_status" ON "migration_jobs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_type" ON "migration_jobs" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_status_type" ON "migration_jobs" ("status", "type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_deal_id" ON "migration_jobs" ("deal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_membership_number" ON "migration_jobs" ("membership_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_membership_id" ON "migration_jobs" ("membership_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_submitted_at" ON "migration_jobs" ("submitted_at")`,
    );

    // Create migration_steps table
    await queryRunner.query(`
      CREATE TABLE "migration_steps" (
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
          REFERENCES "migration_jobs"("id") ON DELETE CASCADE
      )
    `);

    // Create indexes for migration_steps
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_steps_job_id" ON "migration_steps" ("job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_steps_status" ON "migration_steps" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_steps_job_step_value" ON "migration_steps" ("job_id", "step_value")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_migration_steps_retry_count" ON "migration_steps" ("retry_count")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_migration_steps_last_attempt_at" ON "migration_steps" ("last_attempt_at")`,
    );

    console.log("✅ Created migration_jobs and migration_steps tables");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables
    await queryRunner.query(`DROP TABLE IF EXISTS "migration_steps" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "migration_jobs" CASCADE`);

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS "step_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "migration_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "job_status_enum"`);

    console.log("✅ Dropped migration_jobs and migration_steps tables");
  }
}
