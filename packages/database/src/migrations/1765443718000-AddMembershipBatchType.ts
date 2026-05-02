import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMembershipBatchType1765443718000 implements MigrationInterface {
  name = "AddMembershipBatchType1765443718000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "migration_type_enum" ADD VALUE 'membership_batch'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres does not support removing enum values easily
    console.log(
      "⚠️ Cannot remove enum value 'membership_batch' from 'migration_type_enum'",
    );
  }
}
