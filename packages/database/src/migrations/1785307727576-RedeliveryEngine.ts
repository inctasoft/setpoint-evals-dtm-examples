import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Redelivery Engine (Phase 1 of the bus-agnosticism program)
 *
 * Adds the profile-independent core of the orchestrator-driven redelivery
 * engine:
 *
 *   - dtm_steps.attempt_count    — bus-neutral synthetic attempt counter,
 *     incremented on every (re-)dispatch. Replaces sqsReceiveCount semantics
 *     for transports whose native delivery count never reaches the
 *     orchestrator. Inert under the SQS profile (nothing reads it there).
 *   - dtm_steps.lease_expires_at — delegation lease; the redelivery engine
 *     re-dispatches steps still non-terminal past this timestamp. NULL for
 *     pre-existing rows (the engine's scan only matches non-NULL expired
 *     leases, so existing rows are never touched).
 *   - dtm_dead_letters           — dead letters as a table. When a step
 *     exhausts its max attempts under the engine, a row lands here (and the
 *     step goes FAILED). Deliberately no FK to dtm_steps/dtm_jobs: a dead
 *     letter is an audit/quarantine record that must survive job cleanup.
 */
export class RedeliveryEngine1785307727576 implements MigrationInterface {
  name = "RedeliveryEngine1785307727576";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dtm_steps"
      ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "lease_expires_at" timestamp
    `);

    await queryRunner.query(`
      CREATE TABLE "dtm_dead_letters" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "step_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "workflow_name" character varying(255) NOT NULL,
        "step_value" character varying(50) NOT NULL,
        "attempt_count" integer NOT NULL,
        "last_error" text,
        "input" jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "dtm_dead_letters_pkey" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_dead_letters_job_id" ON "dtm_dead_letters" ("job_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dtm_dead_letters_step_id" ON "dtm_dead_letters" ("step_id")`,
    );

    console.log(
      "✅ Added dtm_steps.attempt_count/lease_expires_at and dtm_dead_letters",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dtm_dead_letters"`);
    await queryRunner.query(`
      ALTER TABLE "dtm_steps"
      DROP COLUMN IF EXISTS "lease_expires_at",
      DROP COLUMN IF EXISTS "attempt_count"
    `);

    console.log("✅ Dropped dtm_dead_letters and dtm_steps redelivery columns");
  }
}
