// DTM Core Interfaces — Barrel Export

// Workflow definition contract
export type {
  WorkflowDefinition,
  WorkflowVariant,
  StepDefinition,
  PayloadEnrichment,
  FanOutConfig,
  CascadeConfig,
  JobContext,
  OutcomeResult,
  OutcomeRule,
  CascadeCriticalityRule,
  NotificationRule,
  LoggingRule,
  FeatureFlagConfig,
} from "./workflow-definition.interface";

export type { CascadeCriticality } from "./workflow-definition.interface";

// Step & job status enums
export {
  StepStatus,
  TERMINAL_STEP_STATUSES,
  ACCEPTING_STEP_STATUSES,
} from "./step-status.enum";
export { JobStatus } from "./job-status.enum";

// Callback payloads (orchestrator ↔ worker contract)
export type {
  RetryMetadata,
  BaseCallbackPayload,
  InProgressCallbackPayload,
  SuccessCallbackPayload,
  FailureCallbackPayload,
  CallbackPayload,
  WorkMessage,
} from "./callback-payloads.interface";

// Test options
export type { TestOptionSet } from "./test-options.interface";
