import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds workflow_name column to migration_jobs table.
 * This enables multi-workflow support — each job records which workflow it belongs to.
 * Existing jobs default to 'order-processing'.
 */
export class AddWorkflowNameColumn1765443722000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add workflow_name column with default for existing rows
    await queryRunner.query(`
      ALTER TABLE migration_jobs
      ADD COLUMN IF NOT EXISTS workflow_name VARCHAR(255) NOT NULL DEFAULT 'order-processing';
    `);

    // Add index for workflow-scoped queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_migration_jobs_workflow_name"
      ON migration_jobs (workflow_name);
    `);

    // Add composite index for workflow + status queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_migration_jobs_workflow_name_status"
      ON migration_jobs (workflow_name, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_migration_jobs_workflow_name_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_migration_jobs_workflow_name";`,
    );
    await queryRunner.query(
      `ALTER TABLE migration_jobs DROP COLUMN IF EXISTS workflow_name;`,
    );
  }
}
