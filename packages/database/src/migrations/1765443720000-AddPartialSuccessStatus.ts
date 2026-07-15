import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add PARTIAL_SUCCESS status to step_status_enum
 *
 * This status is used for fan-out parent steps where some children succeeded
 * and some failed. It allows dependent steps to proceed with available data,
 * enabling graceful degradation instead of all-or-nothing blocking.
 *
 * Example flow:
 * - DiscoverSensors finds 3 sensors
 * - Sensor #1 succeeds (ACK received)
 * - Sensor #2 fails (error)
 * - Sensor #3 succeeds (ACK received)
 * - DiscoverSensors → PARTIAL_SUCCESS (2 of 3 succeeded)
 * - DiscoverReadings can now proceed, using FK map for successful ones
 * - Reading records linked to #1 and #3 can succeed
 * - Reading records linked to #2 will fail gracefully (no FK available)
 */
export class AddPartialSuccessStatus1765443720000
  implements MigrationInterface
{
  name = "AddPartialSuccessStatus1765443720000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new enum value to the existing step_status_enum
    // PostgreSQL allows adding values to enums without recreating the type
    await queryRunner.query(`
      ALTER TYPE step_status_enum ADD VALUE IF NOT EXISTS 'partial_success'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values directly.
    // To truly revert, we'd need to recreate the enum type, which is complex
    // and not safe for production. Instead, we just leave the value in place.
    //
    // If a full revert is needed in development:
    // 1. Drop all tables using the enum
    // 2. Drop and recreate the enum
    // 3. Recreate tables
    //
    // For now, this is a no-op for safety.
    console.log(
      "Note: Cannot remove enum value 'partial_success' from PostgreSQL. " +
        "The value will remain but won't be used if the code is reverted.",
    );
  }
}
