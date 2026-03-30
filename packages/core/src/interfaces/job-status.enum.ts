/**
 * Job Status Enum
 *
 * Defines all possible states for a DTM job (workflow execution instance).
 */
export enum JobStatus {
  /** Job created but no steps have started */
  PENDING = "pending",

  /** At least one step is in progress */
  PROCESSING = "processing",

  /** All steps completed successfully */
  COMPLETED = "completed",

  /** Job failed — at least one critical step failed */
  FAILED = "failed",

  /** Job cancelled by user or system */
  CANCELLED = "cancelled",
}
