import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQuickOrderType1765443718000 implements MigrationInterface {
  name = "AddQuickOrderType1765443718000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "migration_type_enum" ADD VALUE 'quick-order'`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async down(): Promise<void> {
    // Postgres does not support removing enum values easily
    console.log(
      "⚠️ Cannot remove enum value 'quick-order' from 'migration_type_enum'",
    );
  }
}
