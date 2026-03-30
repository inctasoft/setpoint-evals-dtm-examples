import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add Fan-Out Pattern columns to migration_steps
 *
 * This migration adds support for the Discovery + Fan-Out + Aggregation pattern
 * which allows one-to-many cascade relationships (e.g., 1 Membership → N Orders)
 * to be processed individually rather than as a batch.
 *
 * New columns:
 * - parent_step_id: References the parent discovery step for child steps
 * - child_index: Order of this child within siblings (0-based)
 * - child_entity_id: The specific item ID this child processes (e.g., order_no)
 *   NOTE: Column was later renamed to child_item_id in migration 1765443726000
 * - child_count: Total children count (stored on parent step)
 */
export class AddFanOutColumns1765443717000 implements MigrationInterface {
  name = "AddFanOutColumns1765443717000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add parent_step_id column with self-referencing foreign key
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      ADD COLUMN "parent_step_id" uuid NULL
    `);

    // Add child_index column
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      ADD COLUMN "child_index" integer NULL
    `);

    // Add child_entity_id column (later renamed to child_item_id)
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      ADD COLUMN "child_entity_id" varchar(255) NULL
    `);

    // Add child_count column
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      ADD COLUMN "child_count" integer NULL
    `);

    // Add foreign key constraint for parent_step_id
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      ADD CONSTRAINT "FK_migration_steps_parent" 
      FOREIGN KEY ("parent_step_id") 
      REFERENCES "migration_steps"("id") 
      ON DELETE CASCADE
    `);

    // Add index for efficient parent lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_migration_steps_parent_step_id" 
      ON "migration_steps" ("parent_step_id")
    `);

    // Add composite index for finding children of a parent by status
    await queryRunner.query(`
      CREATE INDEX "IDX_migration_steps_parent_status" 
      ON "migration_steps" ("parent_step_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_migration_steps_parent_status"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_migration_steps_parent_step_id"
    `);

    // Drop foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      DROP CONSTRAINT IF EXISTS "FK_migration_steps_parent"
    `);

    // Drop columns
    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      DROP COLUMN IF EXISTS "child_count"
    `);

    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      DROP COLUMN IF EXISTS "child_entity_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      DROP COLUMN IF EXISTS "child_index"
    `);

    await queryRunner.query(`
      ALTER TABLE "migration_steps" 
      DROP COLUMN IF EXISTS "parent_step_id"
    `);
  }
}
