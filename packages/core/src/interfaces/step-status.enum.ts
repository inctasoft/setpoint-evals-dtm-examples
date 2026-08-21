/**
 * Step Status Enum
 *
 * Defines all possible states for a step in a DTM workflow.
 * This is the canonical status enum used by the orchestrator engine.
 *
 * State machine:
 *   PENDING → DELEGATED → IN_PROGRESS → COMPLETED
 *                       → IN_PROGRESS → WAITING_FOR_ACK → COMPLETED (ACK steps)
 *                       → IN_PROGRESS → WAITING_FOR_CHILDREN → COMPLETED (discovery steps)
 *                       → IN_PROGRESS_RETRYING → IN_PROGRESS (retry loop)
 *                       → FAILED (any non-terminal state)
 *                       → SKIPPED (dependency failed)
 *                       → PARTIAL_SUCCESS (fan-out parent, some children failed)
 *
 * Terminal states: COMPLETED, FAILED, SKIPPED, PARTIAL_SUCCESS
 * Non-terminal states: PENDING, DELEGATED, IN_PROGRESS, IN_PROGRESS_RETRYING,
 *                      WAITING_FOR_ACK, WAITING_FOR_CHILDREN
 */
export enum StepStatus {
  /** Step created but not yet dispatched to a worker */
  PENDING = "pending",

  /** Step dispatched to SQS queue, awaiting worker pickup */
  DELEGATED = "delegated",

  /** Worker is actively processing this step */
  IN_PROGRESS = "in_progress",

  /** Worker failed but SQS will redeliver for retry */
  IN_PROGRESS_RETRYING = "in_progress_retrying",

  /** Worker completed; step is waiting for external Kafka ACK */
  WAITING_FOR_ACK = "waiting_for_ack",

  /** Discovery step waiting for fan-out children to complete */
  WAITING_FOR_CHILDREN = "waiting_for_children",

  /** Step completed successfully */
  COMPLETED = "completed",

  /** Step failed after all retries exhausted */
  FAILED = "failed",

  /** Step skipped because a dependency failed */
  SKIPPED = "skipped",

  /**
   * Fan-out parent step where some children succeeded and some failed.
   * Allows dependent steps to proceed with available data.
   */
  PARTIAL_SUCCESS = "partial_success",
}

/** Terminal states — callbacks are rejected for steps in these states */
export const TERMINAL_STEP_STATUSES: ReadonlySet<StepStatus> = new Set([
  StepStatus.COMPLETED,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
  StepStatus.PARTIAL_SUCCESS,
]);

/** States that accept worker callbacks */
export const ACCEPTING_STEP_STATUSES: ReadonlySet<StepStatus> = new Set([
  StepStatus.PENDING,
  StepStatus.DELEGATED,
  StepStatus.IN_PROGRESS,
  StepStatus.IN_PROGRESS_RETRYING,
  StepStatus.WAITING_FOR_CHILDREN,
]);
