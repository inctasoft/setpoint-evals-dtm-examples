import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveMigrationTypeEnum1765443719000
  implements MigrationInterface
{
  name = "RemoveMigrationTypeEnum1765443719000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the index that depends on the column (TypeORM creates indexes for enums sometimes, or we created one manually)
    // From InitialMigrationSchema: CREATE INDEX "IDX_migration_jobs_type" ON "migration_jobs" ("type")
    // And: CREATE INDEX "IDX_migration_jobs_status_type" ON "migration_jobs" ("status", "type")
    await queryRunner.query(`DROP INDEX "public"."IDX_migration_jobs_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_migration_jobs_status_type"`,
    );

    // 2. Alter the column to VARCHAR
    // We use explicit casting to ensure existing data is preserved as text
    await queryRunner.query(
      `ALTER TABLE "migration_jobs" ALTER COLUMN "type" TYPE VARCHAR(255) USING "type"::VARCHAR`,
    );

    // 3. Drop the enum type
    await queryRunner.query(`DROP TYPE "migration_type_enum"`);

    // 4. Recreate indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_type" ON "migration_jobs" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_status_type" ON "migration_jobs" ("status", "type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This down migration assumes all data in 'type' column fits into the original enum.
    // If dynamic types were added, this will fail.

    // 1. Drop indexes
    await queryRunner.query(`DROP INDEX "public"."IDX_migration_jobs_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_migration_jobs_status_type"`,
    );

    // 2. Recreate enum type
    await queryRunner.query(
      `CREATE TYPE "migration_type_enum" AS ENUM('membership', 'membership_batch', 'deal')`,
    );

    // 3. Alter column back to enum
    await queryRunner.query(
      `ALTER TABLE "migration_jobs" ALTER COLUMN "type" TYPE "migration_type_enum" USING "type"::"migration_type_enum"`,
    );

    // 4. Recreate indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_type" ON "migration_jobs" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_migration_jobs_status_type" ON "migration_jobs" ("status", "type")`,
    );
  }
}
