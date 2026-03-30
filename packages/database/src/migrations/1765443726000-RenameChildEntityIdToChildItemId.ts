import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Rename child_entity_id → child_item_id on dtm_steps.
 *
 * Part of the DTM glossary cleanup: "entity" is not a core DTM concept.
 * Fan-out child steps process "items", not "entities".
 */
export class RenameChildEntityIdToChildItemId1765443726000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dtm_steps"
        RENAME COLUMN "child_entity_id" TO "child_item_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dtm_steps"
        RENAME COLUMN "child_item_id" TO "child_entity_id"
    `);
  }
}
