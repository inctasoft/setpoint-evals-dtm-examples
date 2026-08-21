import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

/**
 * Dead Letter — a step that exhausted its max attempts under the
 * orchestrator-driven redelivery engine.
 *
 * Bus-neutral replacement for a native DLQ (TaskTransportCapabilities.dlq
 * === 'table'): transports without a dead-letter queue concept get the same
 * "poison message quarantine" semantics as a row in this table instead of a
 * message parked on a bus-side queue.
 *
 * Deliberately NOT a foreign-key relation to dtm_steps/dtm_jobs: a dead
 * letter is an audit/quarantine record that must survive job cleanup
 * (OldJobCleanupTask deletes old jobs and cascades to their steps — the
 * dead-letter row must outlive that).
 */
@Entity("dtm_dead_letters")
@Index(["jobId"])
@Index(["stepId"])
export class DeadLetter {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Step that exhausted its attempts (dtm_steps.id at dead-letter time) */
  @Column({ name: "step_id", type: "uuid" })
  stepId!: string;

  /** Job the step belonged to (dtm_jobs.id at dead-letter time) */
  @Column({ name: "job_id", type: "uuid" })
  jobId!: string;

  /** Workflow config name (copied off the job for querying after job deletion) */
  @Column({ name: "workflow_name", type: "varchar", length: 255 })
  workflowName!: string;

  /** Step name (e.g. 'ValidateCustomer') */
  @Column({ name: "step_value", type: "varchar", length: 50 })
  stepValue!: string;

  /** Synthetic dispatch-attempt count at exhaustion (dtm_steps.attempt_count) */
  @Column({ name: "attempt_count", type: "int" })
  attemptCount!: number;

  /** Last error the step reported (if any callback ever arrived) */
  @Column({ name: "last_error", type: "text", nullable: true })
  lastError?: string | null;

  /** Input payload the step was dispatched with (for replay/inspection) */
  @Column({ type: "jsonb", nullable: true })
  input?: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
