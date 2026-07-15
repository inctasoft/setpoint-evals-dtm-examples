import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Drop legacy workflow-specific columns from dtm_jobs.
 * These columns (order_ref_id, customer_number, customer_id) were remnants
 * of an earlier schema iteration that stored workflow-specific identifiers
 * directly on the job row. All workflow-specific data should be stored in
 * the JSONB payload column instead — see JobPayload in
 * packages/database/src/entities/job.entity.ts.
 */
export class DropLegacyWorkflowColumns1765443725000
  implements MigrationInterface
{
  name = "DropLegacyWorkflowColumns1765443725000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dtm_jobs_order_ref_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_dtm_jobs_customer_number"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dtm_jobs_customer_id"`);

    // Drop columns
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "order_ref_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "customer_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "customer_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add columns
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" ADD "order_ref_id" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" ADD "customer_number" varchar(255)`,
    );
    await queryRunner.query(`ALTER TABLE "dtm_jobs" ADD "customer_id" uuid`);

    // Re-add indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_order_ref_id" ON "dtm_jobs" ("order_ref_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_customer_number" ON "dtm_jobs" ("customer_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_customer_id" ON "dtm_jobs" ("customer_id")`,
    );
  }
}
