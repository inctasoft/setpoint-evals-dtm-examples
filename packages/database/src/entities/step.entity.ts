import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  JoinColumn,
  Index,
} from "typeorm";
import type { Job } from "./job.entity";
import { StepStatus } from "@dtm/core";

/**
 * Step status — re-exported from @dtm/core, the single canonical source (10 values;
 * see @dtm/core's step-status.enum.ts for the full state-machine doc comment).
 *
 * This USED TO be an independently hand-declared duplicate of @dtm/core's enum —
 * identical values, but a separate nominal type, which is exactly how the 3-way
 * status-vocabulary drift (dtm-video-v2 capability-spec.md §2d) happened: this file
 * had all 10 values, the WS event-types union had only 7, and nothing forced them to
 * agree. Re-exporting instead of re-declaring makes that drift a compile error instead
 * of a silent mismatch. Do NOT reintroduce a local `enum StepStatus { ... }` here —
 * setpoint-evals/SE-27-dag-overlay-status-parity pins this.
 */
export { StepStatus };

/**
 * Execution attempt record - tracks each retry attempt for a step
 */
export interface ExecutionAttempt {
  attemptNumber: number;
  attemptedAt: string; // ISO timestamp
  status: "success" | "failure";
  error?: string;
  output?: Record<string, unknown>;
  sqsMessageId?: string;
  sqsReceiveCount?: number; // From SQS message attributes
  processingTimeMs?: number;
}

/**
 * Entity for tracking job steps
 *
 * Each step represents a unit of work that can be delegated to a Lambda worker
 * or executed internally by the orchestrator.
 *
 * Note: stepValue stores the enum numeric value (1-7), which serves as both
 * the step identifier and execution order.
 */
@Entity("dtm_steps")
@Index(["job"])
@Index(["status"])
@Index(["job", "stepValue"])
@Index(["parentStepId"]) // For fan-out child lookups
export class Step {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne("Job", "steps", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "job_id" })
  job!: Job;

  @Column({
    name: "step_value",
    type: "varchar",
    length: 50,
  })
  stepValue!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({
    type: "enum",
    enum: StepStatus,
    default: StepStatus.PENDING,
  })
  status!: StepStatus;

  // Input data/parameters for the step
  @Column({ type: "jsonb", nullable: true })
  input?: Record<string, unknown>;

  // Output data from the step (received via HTTP callback from Lambda)
  @Column({ type: "jsonb", nullable: true })
  output?: Record<string, unknown>;

  @CreateDateColumn({ name: "started_at", type: "timestamp" })
  startedAt!: Date;

  @Column({ name: "completed_at", type: "timestamp", nullable: true })
  completedAt?: Date;

  /**
   * Total duration in milliseconds from step creation (startedAt) to completion.
   * Captures end-to-end time including:
   * - SQS queuing/polling delays
   * - All retry attempts
   * - ACK waiting time (if applicable)
   *
   * For per-attempt Lambda execution times, see executionHistory[].processingTimeMs
   */
  @Column({ name: "duration_ms", type: "int", nullable: true })
  durationMs?: number;

  @Column({ type: "text", nullable: true })
  error?: string | null;

  @Column({ name: "records_processed", type: "int", default: 0 })
  recordsProcessed!: number;

  @Column({ name: "records_failed", type: "int", default: 0 })
  recordsFailed!: number;

  // Lambda-specific fields
  @Column({
    name: "lambda_function_name",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  lambdaFunctionName?: string;

  @Column({
    name: "sqs_message_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  sqsMessageId?: string;

  // Retry tracking fields
  @Column({ name: "retry_count", type: "int", default: 0 })
  retryCount!: number;

  @Column({ name: "max_retry_count", type: "int", default: 3 })
  maxRetryCount!: number;

  @Column({ name: "first_attempt_at", type: "timestamp", nullable: true })
  firstAttemptAt?: Date;

  @Column({ name: "last_attempt_at", type: "timestamp", nullable: true })
  lastAttemptAt?: Date;

  // Execution history - all retry attempts with details
  @Column({
    type: "jsonb",
    nullable: true,
    default: "[]",
    name: "execution_history",
  })
  executionHistory?: ExecutionAttempt[];

  // Kafka acknowledgement tracking fields
  @Column({ name: "kafka_published_at", type: "timestamp", nullable: true })
  kafkaPublishedAt?: Date;

  @Column({ name: "ack_received_at", type: "timestamp", nullable: true })
  ackReceivedAt?: Date;

  @Column({ type: "jsonb", nullable: true, name: "ack_metadata" })
  ackMetadata?: Record<string, unknown>;

  // ============================================
  // Fan-Out Pattern: Parent/Child Relationships
  // ============================================

  /**
   * Parent step ID for child steps created by fan-out.
   * NULL for regular steps and discovery/parent steps.
   */
  @Column({ name: "parent_step_id", type: "uuid", nullable: true })
  parentStepId?: string;

  /**
   * Index of this child within the parent's children (0-based).
   * Used for ordering and identification.
   */
  @Column({ name: "child_index", type: "integer", nullable: true })
  childIndex?: number;

  /**
   * The specific item ID this child step processes.
   * E.g., orderId for ValidateLineItem steps.
   */
  @Column({
    name: "child_item_id",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  childItemId?: string;

  /**
   * Total number of children for a discovery/parent step.
   * Stored on the parent step for quick access.
   */
  @Column({ name: "child_count", type: "integer", nullable: true })
  childCount?: number;

  /**
   * Reference to the parent step (for navigating up the hierarchy)
   */
  @ManyToOne("Step", "childSteps", {
    onDelete: "CASCADE",
    nullable: true,
  })
  @JoinColumn({ name: "parent_step_id" })
  parentStep?: Step;

  /**
   * Child steps created by fan-out from this step
   */
  @OneToMany("Step", "parentStep")
  childSteps?: Step[];
}
