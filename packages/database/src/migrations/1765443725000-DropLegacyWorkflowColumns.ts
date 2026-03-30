import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Drop legacy workflow-specific columns from dtm_jobs.
 * These columns (deal_id, membership_number, membership_id) were remnants
 * of the old migration-service-core project. All workflow-specific data
 * should be stored in the JSONB payload column instead.
 */
export class DropLegacyWorkflowColumns1765443725000
  implements MigrationInterface
{
  name = "DropLegacyWorkflowColumns1765443725000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_dtm_jobs_deal_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_dtm_jobs_membership_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_dtm_jobs_membership_id"`,
    );

    // Drop columns
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "deal_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "membership_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" DROP COLUMN IF EXISTS "membership_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add columns
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" ADD "deal_id" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" ADD "membership_number" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "dtm_jobs" ADD "membership_id" uuid`,
    );

    // Re-add indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_deal_id" ON "dtm_jobs" ("deal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_membership_number" ON "dtm_jobs" ("membership_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_jobs_membership_id" ON "dtm_jobs" ("membership_id")`,
    );
  }
}
