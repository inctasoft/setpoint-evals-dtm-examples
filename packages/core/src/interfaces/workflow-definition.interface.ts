/**
 * Workflow Definition Interfaces
 *
 * The core contract that every DTM workflow must implement.
 * The orchestrator reads these definitions to know how to execute workflows.
 *
 * Design principles:
 * 1. String-based identifiers — step names and cascade names are strings, not enums.
 *    Enums are workflow-specific (defined in the workflow project).
 * 2. Declarative, not imperative — the config is pure data. No functions that access
 *    databases, no imports of domain-specific code.
 * 3. Complete self-description — contains everything the DTM core needs: step graph,
 *    cascades, outcome rules, queue names, topics.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Definition (top-level)
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowDefinition {
  /** Unique workflow identifier (e.g., 'order-processing') */
  name: string;

  /** Human-readable description */
  description: string;

  /** Workflow variants (e.g., batch vs fan-out modes) */
  variants: Record<string, WorkflowVariant>;

  /**
   * Step definitions per variant.
   * Key = variant name, Value = array of step definitions.
   * Steps within a variant form a DAG via their `dependencies` field.
   */
  steps: Record<string, StepDefinition[]>;

  /** Cascade FK dependency configuration */
  cascades: CascadeConfig[];

  /** Outcome determination rules (evaluated in priority order, first match wins) */
  outcomeRules: OutcomeRule[];

  /** Cascade criticality rules (which cascades must succeed for job success) */
  cascadeCriticalityRules: CascadeCriticalityRule[];

  /** Notification rules (Kafka messages on job completion) */
  notificationRules?: NotificationRule[];

  /** Logging rules (structured log output on job events) */
  loggingRules?: LoggingRule[];

  /** Feature flag definitions (defaults and client-overridable flags) */
  featureFlags?: FeatureFlagConfig;

  /**
   * When true, step definitions are read from job.payload.stepDefinitions
   * instead of the static `steps` config. This enables workflows where the
   * DAG structure varies per job (e.g., plan-execution where each plan has
   * different chunks with different dependencies).
   *
   * The job submission payload must include:
   * ```typescript
   * payload: {
   *   stepDefinitions: StepDefinition[],  // per-job step DAG
   *   // ... other payload fields
   * }
   * ```
   */
  dynamicSteps?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Variant
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowVariant {
  /** Human-readable description of this variant */
  description: string;

  /** If true, this variant is used when no variant is specified */
  isDefault?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Definition
// ─────────────────────────────────────────────────────────────────────────────

export interface StepDefinition {
  /** Unique step identifier (e.g., 'ValidateCustomer', 'SubmitOrder') */
  step: string;

  /** Human-readable description */
  description: string;

  /** Lambda function name (for SQS → Lambda invocation) */
  functionName: string;

  /** SQS queue name (for dispatching work) */
  queueName: string;

  /** Steps that must complete before this step can start */
  dependencies: string[];

  /** If true, step waits for external ACK after worker completion */
  requiresAcknowledgement?: boolean;

  /** Fan-out configuration (for discovery steps) */
  fanOut?: FanOutConfig;

  /** Whether this step is a dynamically created child step */
  isChildStep?: boolean;

  /** Input field name containing the item ID for child steps */
  itemIdInputField?: string;

  /**
   * Maximum time (ms) this step is allowed to stay in IN_PROGRESS
   * before the maintenance task auto-fails it.
   * Defaults to 30 minutes (1_800_000 ms).
   * For discovery steps, also applies as the WAITING_FOR_CHILDREN timeout.
   */
  timeoutMs?: number;

  /** Optional metadata passed to workers (workflow-specific config) */
  metadata?: Record<string, unknown>;

  /**
   * If true, the orchestrator collects full output data from dependency steps
   * and passes it as `inputData.dependencyData` to this step's worker.
   * If false/undefined, passes lightweight data references instead.
   *
   * Typically true for second-phase steps (Submit, Apply, Publish, etc.)
   * that need the full data produced by their dependency steps.
   */
  collectDependencyOutputs?: boolean;

  /**
   * Feature flag gate: step is SKIPPED when this flag resolves to false.
   * The flag is resolved from workflow defaults merged with per-job overrides.
   */
  featureGate?: string;

  /**
   * Payload enrichment rules: extract fields from step output into job.payload.
   * Runs after step completion. Only enriches if the payload field is not already
   * set (unless `overwrite` is true).
   *
   * Example: A validation step returns `entity_ref` in its output.
   * Adding `{ outputField: 'entity_ref', payloadField: 'entityRef' }` causes
   * the orchestrator to copy that value into `job.payload.entityRef` for
   * downstream deduplication / routing.
   */
  payloadEnrichments?: PayloadEnrichment[];
}

export interface PayloadEnrichment {
  /** Field name in step output to extract */
  outputField: string;
  /** Field name to set in job.payload */
  payloadField: string;
  /** If true, overwrite existing value in payload. Default: false */
  overwrite?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fan-Out Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface FanOutConfig {
  /** Enable fan-out for this step */
  enabled: boolean;

  /** The first child step type in the chain */
  childStepType: string;

  /** Field in discovery output containing discovered item IDs */
  itemIdField: string;

  /** Full chain of child steps for each item (e.g., ['ValidateLineItem', 'SubmitLineItem']) */
  childStepChain: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade Configuration (FK dependency graph)
// ─────────────────────────────────────────────────────────────────────────────

export interface CascadeConfig {
  /** Cascade name identifier (e.g., 'customer', 'order', 'lineItem') */
  cascadeName: string;

  /** Parent cascades that must have ACKs before data can flow */
  dependsOn: string[];

  /**
   * Workflow-owned FK extraction from parent ACK metadata.
   * Called by the orchestrator before publishing a child cascade's data.
   *
   * @param parentAcks   Map of parentCascadeName → that parent's stored ackMetadata
   * @param fkMaps       Map of discoveryStepName → (childItemId → fkValue), for fan-out parents
   * @param sourceRecord The individual source record being published (for per-record FK lookups)
   * @returns Record of FK field names → values to merge into the published payload
   */
  fkExtractor?: (
    parentAcks: Record<string, Record<string, unknown> | undefined>,
    fkMaps: Record<string, Record<string, string>>,
    sourceRecord?: Record<string, unknown>,
  ) => Record<string, string>;

  /**
   * For fan-out parent cascades: extracts the FK reference value from a completed
   * child's ACK metadata. Stored in the FK map (childItemId → value) so that
   * dependent cascades can look up the correct parent FK when publishing.
   *
   * Only needed when other cascades depend on a fan-out parent.
   * If not provided, no FK map entry is created for this cascade's children.
   */
  childFkExtractor?: (
    ackMetadata: Record<string, unknown>,
  ) => string | undefined;

  /**
   * The first-phase step that validates/fetches this cascade's data from the source system.
   * Used by outcome evaluation to detect first-phase failures.
   * Example: 'ValidateCustomer', 'RegisterDevice', 'PlanEnvironment'
   */
  inputStep?: string;

  /** The second-phase step that produces this cascade's output data (for Kafka publishing and ACK) */
  outputStep: string;

  /**
   * Channel for publishing transformed data and receiving ACKs.
   * Defaults to 'kafka' if not specified.
   */
  ackChannel?: "kafka" | "http" | "pubsub" | "amqp";

  /** Kafka topic for publishing transformed data (required when ackChannel = 'kafka' or default) */
  kafkaTopic?: string;

  /** Kafka topic for receiving external ACKs (required when ackChannel = 'kafka' or default) */
  ackTopic?: string;

  /** HTTP endpoint for receiving ACKs (required when ackChannel = 'http') */
  ackEndpoint?: string;

  /** Whether this cascade uses fan-out (discovery → child steps) */
  isFanOutParent?: boolean;

  /** Discovery step for fan-out cascades */
  discoveryStep?: string;

  /**
   * Key name in step output containing the cascade's output data array.
   * Used by the callback service to find data for Kafka publishing.
   * If not specified, defaults to 'outputData'.
   * Example: 'submittedCustomers', 'appliedEnvironments', 'provisionedDevices'
   */
  outputDataKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcome Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context provided to outcome rule predicates.
 * Generic — no domain-specific types. All cascade names are strings.
 */
export interface JobContext {
  /** Job ID */
  jobId: string;

  /** Workflow variant used for this job */
  workflowVariant: string;

  /** Count of successfully processed items by cascade name */
  cascadeCounts: Record<string, number>;

  /** Failed item counts by cascade name */
  failedCascadeCounts: Record<string, number>;

  /** Cascade names where discovery found 0 items */
  emptyCascades: string[];

  /** Cascade names that were attempted */
  attemptedCascades: string[];

  /** Step statuses by step name */
  stepStatuses: Record<string, string>;
}

/**
 * Result of outcome determination.
 */
export interface OutcomeResult {
  /** Final job status */
  jobStatus: "completed" | "partial_success" | "failed";

  /** Human-readable reason for the outcome */
  reason: string;

  /** Warnings to log (non-blocking issues) */
  warnings: string[];

  /** Errors to log (blocking issues) */
  errors: string[];

  /** Additional metadata for debugging */
  metadata: Record<string, unknown>;
}

/**
 * Outcome rule definition.
 * Rules are evaluated in priority order (lowest number = highest priority).
 * First matching rule wins.
 */
export interface OutcomeRule {
  /** Unique rule identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Priority (lower = evaluated first). Recommended: 10, 20, 30, ... */
  priority: number;

  /** Condition predicate — return true if this rule applies */
  condition: (ctx: JobContext) => boolean;

  /** Outcome producer — returns the outcome when this rule matches */
  outcome: (ctx: JobContext) => OutcomeResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cascade Criticality Rules
// ─────────────────────────────────────────────────────────────────────────────

/** Criticality level for a cascade */
export type CascadeCriticality = "required" | "optional" | "conditional";

/**
 * Defines whether a cascade must succeed for the job to be considered successful.
 */
export interface CascadeCriticalityRule {
  /** Cascade name (matches CascadeConfig.cascadeName) */
  cascadeName: string;

  /** Criticality level */
  criticality: CascadeCriticality;

  /**
   * For 'conditional' criticality: predicate to determine if cascade is required.
   * Example: IngestReading is required only if a DiscoverSensors child (Sensor) exists.
   */
  condition?: (ctx: JobContext) => boolean;

  /**
   * If true, 0 items found is a valid outcome (not a failure).
   * Example: A workflow with no orders should still complete successfully.
   */
  allowEmpty: boolean;

  /** Minimum count required for success (when allowEmpty is false). Default: 1 */
  minCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification & Logging Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notification rule — defines when to send Kafka notifications.
 */
export interface NotificationRule {
  /** Unique rule identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Job statuses that trigger this notification */
  triggerOn: string[];

  /** Kafka topic to publish notification to */
  topic: string;

  /** Payload builder (returns the notification message body) */
  buildPayload: (ctx: JobContext) => Record<string, unknown>;
}

/**
 * Logging rule — defines structured log output on job events.
 */
export interface LoggingRule {
  /** Unique rule identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Log level */
  level: "debug" | "info" | "warn" | "error";

  /** Job statuses that trigger this log */
  triggerOn: string[];

  /** Message builder */
  buildMessage: (ctx: JobContext) => string;

  /** Additional structured fields */
  buildFields?: (ctx: JobContext) => Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Flags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feature flag configuration for a workflow.
 *
 * Three-layer resolution order:
 * 1. Workflow defaults (from this config)
 * 2. Environment variable overrides (FEATURE_FLAG_<NAME>=value)
 * 3. Per-request overrides (from job creation payload, gated by clientOverridable)
 */
export interface FeatureFlagConfig {
  /**
   * Default values for all feature flags.
   * Applied when no per-request or env override is provided.
   */
  defaults: Record<string, unknown>;

  /**
   * Which flags the client is allowed to override per-request.
   * Only flags listed here can be set via the request body.
   * Unlisted flags use the resolved value and cannot be changed by clients.
   * If omitted or empty, NO flags are client-overridable (locked by default).
   */
  clientOverridable?: string[];
}
