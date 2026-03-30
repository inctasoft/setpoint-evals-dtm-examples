import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add PARTIAL_SUCCESS status to job_status_enum
 *
 * Enables outcome-rule-driven job completion where critical entities
 * succeed but optional entities fail. Instead of binary COMPLETED/FAILED,
 * the orchestrator can now mark jobs as PARTIAL_SUCCESS when workflow
 * outcome rules determine that the job partially succeeded.
 *
 * Example (order-processing):
 * - Customer + Order extracted and transformed successfully (critical)
 * - Payment extraction failed (optional entity)
 * - Shipment succeeded (optional entity)
 * - Outcome rule "partial-success-optional-failed" fires → PARTIAL_SUCCESS
 */
export class AddPartialSuccessJobStatus1765443723000
  implements MigrationInterface
{
  name = "AddPartialSuccessJobStatus1765443723000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE job_status_enum ADD VALUE IF NOT EXISTS 'partial_success'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL doesn't support removing enum values directly.
    // The value will remain but won't be used if the code is reverted.
    console.log(
      "Note: Cannot remove enum value 'partial_success' from job_status_enum in PostgreSQL. " +
        "The value will remain but won't be used if the code is reverted.",
    );
  }
}
