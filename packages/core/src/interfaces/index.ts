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

// ZeroMQ tasks envelope (zmq task transport wire contract)
export {
  ZMQ_ENVELOPE_VERSION,
  ZMQ_TASK_TOPIC_PREFIX,
  ZMQ_CONTROL_TOPIC,
  zmqTopicForEnvelope,
  buildZmqTaskEnvelope,
  buildZmqReceivedEnvelope,
  buildZmqHelloEnvelope,
  buildZmqHeartbeatEnvelope,
  encodeZmqEnvelope,
  decodeZmqEnvelope,
} from "./zmq-envelope.interface";
export type {
  ZmqTaskPayload,
  ZmqReceivedPayload,
  ZmqHelloPayload,
  ZmqHeartbeatPayload,
  ZmqTaskEnvelope,
  ZmqReceivedEnvelope,
  ZmqHelloEnvelope,
  ZmqHeartbeatEnvelope,
  ZmqEnvelope,
} from "./zmq-envelope.interface";
