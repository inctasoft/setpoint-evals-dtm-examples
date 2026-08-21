import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import type { Step } from "./step.entity";

export enum JobStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  PARTIAL_SUCCESS = "partial_success",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/**
 * Common job type variants.
 * Workflows can use these or provide custom string values via the `JobType | string` union.
 */
export enum JobType {
  DEFAULT = "default",
  BATCH = "batch",
}

/**
 * Job Payload
 *
 * Generic workflow job payload. Workflow-specific fields are stored in the JSONB
 * payload column and accessed via type assertions or the index signature.
 */
export interface JobPayload {
  description?: string;

  // External system integration fields
  externalSystemId?: string; // Identifier for the external system triggering the job
  webhookUrl?: string; // URL to receive completion/failure webhooks

  // Additional filters for batch operations (workflow-specific content)
  filters?: Record<string, unknown>;

  // Configuration options
  config?: {
    batchSize?: number;
    skipValidation?: boolean;
    dryRun?: boolean;
    continueOnError?: boolean;
    notifyOnCompletion?: boolean;
  };

  // Test options: step-type-keyed delays and feature flags
  // Keys are step names (e.g., 'ValidateCustomer', 'SubmitOrder')
  testOptions?: {
    enableDeduplication?: boolean;
    [key: string]: unknown; // Step-specific delays, feature flags, etc.
  };

  // Flexible metadata storage for external API fields
  metadata?: Record<string, unknown>;

  // Workflow-specific fields (accessed by deduplication, controllers, etc.)
  // The JSONB payload column may contain any additional fields defined by the workflow.
  [key: string]: unknown;
  _trigger?: {
    source?: string;
    topic?: string;
    consumerId?: string;
    triggeredAt?: string;
  };
}

/**
 * Job Results Summary
 * Stored in dtm_jobs.results JSONB column
 * Aggregates data from all steps when job completes
 */
export interface JobResults {
  totalRecordsProcessed: number;
  totalRecordsFailed: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsAborted?: number;
  durationMs: number;
  completedAt: Date;
}

@Entity("dtm_jobs")
@Index("IDX_dtm_jobs_status", ["status"])
@Index("IDX_dtm_jobs_type", ["type"])
@Index("IDX_dtm_jobs_submitted_at", ["submittedAt"])
@Index("IDX_dtm_jobs_status_type", ["status", "type"])
export class Job {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    name: "workflow_name",
    type: "varchar",
    length: 255,
  })
  @Index("IDX_dtm_jobs_workflow_name")
  workflowName!: string;

  @Column({
    type: "varchar",
    length: 255,
  })
  type!: JobType | string;

  @Column({
    type: "enum",
    enum: JobStatus,
    default: JobStatus.PENDING,
  })
  status!: JobStatus;

  @Column({ type: "jsonb" })
  payload!: JobPayload;

  @Column({
    name: "submitted_by",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  submittedBy?: string;

  @CreateDateColumn({ name: "submitted_at", type: "timestamp" })
  submittedAt!: Date;

  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt?: Date;

  @Column({ name: "completed_at", type: "timestamp", nullable: true })
  completedAt?: Date;

  @UpdateDateColumn({
    name: "updated_at",
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
  })
  updatedAt!: Date;

  @Column({ type: "text", nullable: true })
  error?: string;

  @Column({ name: "retry_count", type: "int", default: 0 })
  retryCount!: number;

  @Column({ name: "max_retries", type: "int", default: 3 })
  maxRetries!: number;

  @Column({ type: "jsonb", nullable: true })
  results?: JobResults;

  // Relationships
  @OneToMany("Step", "job", {
    cascade: true,
  })
  steps!: Step[];
}
