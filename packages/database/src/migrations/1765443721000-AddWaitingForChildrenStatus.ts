import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Add WAITING_FOR_CHILDREN status to step_status_enum
 *
 * This status separates two previously overloaded uses of WAITING_FOR_ACK:
 * - WAITING_FOR_ACK: Output steps waiting for external Kafka acknowledgement
 * - WAITING_FOR_CHILDREN: Discovery steps waiting for fan-out child steps to complete
 *
 * Without this separation, the terminal-state guard (Race #3 fix) would silently
 * reject the WAITING_FOR_ACK → COMPLETED transition when all children finish,
 * because WAITING_FOR_ACK is considered terminal for Lambda callback purposes.
 *
 * WAITING_FOR_CHILDREN is NOT a terminal state — the fan-out service transitions
 * it to COMPLETED/PARTIAL_SUCCESS/FAILED when all children are done.
 */
export class AddWaitingForChildrenStatus1765443721000
  implements MigrationInterface
{
  name = "AddWaitingForChildrenStatus1765443721000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE step_status_enum ADD VALUE IF NOT EXISTS 'waiting_for_children'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: PostgreSQL doesn't support removing enum values directly.
    // See AddPartialSuccessStatus migration for full explanation.
    console.log(
      "Note: Cannot remove enum value 'waiting_for_children' from PostgreSQL. " +
        "The value will remain but won't be used if the code is reverted.",
    );
  }
}
