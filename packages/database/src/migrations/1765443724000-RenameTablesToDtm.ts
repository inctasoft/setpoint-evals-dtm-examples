import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Rename tables from migration_* to dtm_* naming convention.
 *
 * The DTM orchestrator is a generic platform — not tied to any specific
 * workflow. This migration renames the core tables to reflect that.
 *
 * Tables renamed:
 *   migration_jobs  → dtm_jobs
 *   migration_steps → dtm_steps
 *
 * All indexes are renamed accordingly.
 */
export class RenameTablesToDtm1765443724000 implements MigrationInterface {
  name = "RenameTablesToDtm1765443724000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename tables
    await queryRunner.query(
      `ALTER TABLE "migration_jobs" RENAME TO "dtm_jobs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "migration_steps" RENAME TO "dtm_steps"`,
    );

    // Rename indexes on dtm_jobs (formerly migration_jobs)
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_status" RENAME TO "IDX_dtm_jobs_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_type" RENAME TO "IDX_dtm_jobs_type"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_status_type" RENAME TO "IDX_dtm_jobs_status_type"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_order_ref_id" RENAME TO "IDX_dtm_jobs_order_ref_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_customer_number" RENAME TO "IDX_dtm_jobs_customer_number"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_customer_id" RENAME TO "IDX_dtm_jobs_customer_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_submitted_at" RENAME TO "IDX_dtm_jobs_submitted_at"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_workflow_name" RENAME TO "IDX_dtm_jobs_workflow_name"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_jobs_workflow_name_status" RENAME TO "IDX_dtm_jobs_workflow_name_status"`,
    );

    // Rename indexes on dtm_steps (formerly migration_steps)
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_steps_job_id" RENAME TO "IDX_dtm_steps_job_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_steps_status" RENAME TO "IDX_dtm_steps_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_steps_job_step_value" RENAME TO "IDX_dtm_steps_job_step_value"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_migration_steps_retry_count" RENAME TO "idx_dtm_steps_retry_count"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_migration_steps_last_attempt_at" RENAME TO "idx_dtm_steps_last_attempt_at"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_steps_parent_step_id" RENAME TO "IDX_dtm_steps_parent_step_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_migration_steps_parent_status" RENAME TO "IDX_dtm_steps_parent_status"`,
    );

    console.log(
      "Renamed migration_jobs → dtm_jobs and migration_steps → dtm_steps",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rename tables back
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" RENAME TO "migration_jobs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_steps" RENAME TO "migration_steps"`,
    );

    // Rename indexes back on migration_jobs
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_status" RENAME TO "IDX_migration_jobs_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_type" RENAME TO "IDX_migration_jobs_type"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_status_type" RENAME TO "IDX_migration_jobs_status_type"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_order_ref_id" RENAME TO "IDX_migration_jobs_order_ref_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_customer_number" RENAME TO "IDX_migration_jobs_customer_number"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_customer_id" RENAME TO "IDX_migration_jobs_customer_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_submitted_at" RENAME TO "IDX_migration_jobs_submitted_at"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_workflow_name" RENAME TO "IDX_migration_jobs_workflow_name"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_jobs_workflow_name_status" RENAME TO "IDX_migration_jobs_workflow_name_status"`,
    );

    // Rename indexes back on migration_steps
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_steps_job_id" RENAME TO "IDX_migration_steps_job_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_steps_status" RENAME TO "IDX_migration_steps_status"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_steps_job_step_value" RENAME TO "IDX_migration_steps_job_step_value"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_dtm_steps_retry_count" RENAME TO "idx_migration_steps_retry_count"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "idx_dtm_steps_last_attempt_at" RENAME TO "idx_migration_steps_last_attempt_at"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_steps_parent_step_id" RENAME TO "IDX_migration_steps_parent_step_id"`,
    );
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_dtm_steps_parent_status" RENAME TO "IDX_migration_steps_parent_status"`,
    );

    console.log(
      "Reverted dtm_jobs → migration_jobs and dtm_steps → migration_steps",
    );
  }
}
