/**
 * IoT Sensor Pipeline — Workflow Definition
 *
 * Single source of truth for the IoT data ingestion pipeline.
 *
 * The DTM orchestrator reads this definition to know:
 *   - What steps exist and their dependency DAG (steps)
 *   - How entities cascade with FK dependencies (cascades)
 *   - What determines job success/failure (outcomeRules, cascadeCriticalityRules)
 *   - What Kafka topics to publish to and listen on (cascades)
 *
 * Entities:
 *   Device (root) -> Sensor (fan-out) -> Reading (nested fan-out)
 *   Device -> Alert
 *   Sensor -> Aggregate
 *
 * Visual cascade:
 *   Device (root)
 *      |  ext_device_id                |  ext_device_id
 *      v                               v
 *   Sensor (fan-out)                 Alert
 *      |  ext_sensor_id                |  ext_sensor_id
 *      v                               v
 *   Reading (nested fan-out)         Aggregate
 *
 * Demonstrates: Double/nested fan-out, feature flags, conditional steps, empty discovery handling.
 */

import type {
  WorkflowDefinition,
  StepDefinition,
  CascadeConfig,
  OutcomeRule,
  CascadeCriticalityRule,
  JobContext,
} from '@dtm/core';

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW-SPECIFIC ENUMS (type-safe within this workflow project)
// The DTM core only sees strings — these enums are for workflow authors.
// ═══════════════════════════════════════════════════════════════════════════════

export enum Step {
  // Device — Register & Provision
  RegisterDevice = 'RegisterDevice',
  ProvisionDevice = 'ProvisionDevice',

  // Sensor — Discovery & Fan-Out
  DiscoverSensors = 'DiscoverSensors',
  CalibrateSensor = 'CalibrateSensor',
  ActivateSensor = 'ActivateSensor',

  // Reading — Discovery & Nested Fan-Out (child of Sensor fan-out)
  DiscoverReadings = 'DiscoverReadings',
  IngestReading = 'IngestReading',
  PublishReading = 'PublishReading',

  // Alert — Evaluate & Dispatch
  EvaluateAlert = 'EvaluateAlert',
  DispatchAlert = 'DispatchAlert',

  // Aggregate — Compute & Publish
  ComputeAggregate = 'ComputeAggregate',
  PublishAggregate = 'PublishAggregate',

  // Archive — Final step writing to product DB
  ArchiveProcessedPipeline = 'ArchiveProcessedPipeline',
}

export type EntityType =
  | 'device'
  | 'sensor'
  | 'reading'
  | 'alert'
  | 'aggregate';

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS — default variant (full pipeline with double fan-out)
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_STEPS: StepDefinition[] = [
  // ── Phase 1: Register root entity (device) ────────────────────────────────
  {
    step: Step.RegisterDevice,
    description: 'Register IoT device and validate device identity/firmware',
    functionName: 'iot-register-device',
    queueName: 'iot-register-device',
    dependencies: [],
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'devices', filterKey: 'deviceId' },
    },
  },

  // ── Phase 2: Provision device ──────────────────────────────────────────────
  {
    step: Step.ProvisionDevice,
    description: 'Provision device configuration to IoT platform and await platform ACK',
    functionName: 'iot-provision-device',
    queueName: 'iot-provision-device',
    dependencies: [Step.RegisterDevice],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'device', transformations: ['fieldMapping', 'validateDeviceConfig'] },
    },
  },

  // ── Phase 3: Fan-Out — Discover sensors for this device ───────────────────
  {
    step: Step.DiscoverSensors,
    description: 'Discover all sensor IDs attached to this device',
    functionName: 'iot-discover-sensors',
    queueName: 'iot-discover-sensors',
    dependencies: [Step.ProvisionDevice],
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'sensors', filterKey: 'deviceId' },
    },
    fanOut: {
      enabled: true,
      childStepType: Step.CalibrateSensor,
      itemIdField: 'sensorIds',
      childStepChain: [Step.CalibrateSensor, Step.ActivateSensor, Step.DiscoverReadings, Step.ComputeAggregate, Step.PublishAggregate],
    },
  },
  {
    step: Step.CalibrateSensor,
    description: 'Calibrate sensor and validate measurement parameters',
    functionName: 'iot-calibrate-sensor',
    queueName: 'iot-calibrate-sensor',
    dependencies: [],
    isChildStep: true,
    itemIdInputField: 'sensorId',
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'sensors', filterKey: 'sensorId' },
    },
  },
  {
    step: Step.ActivateSensor,
    description: 'Activate sensor on IoT platform and await activation confirmation',
    functionName: 'iot-activate-sensor',
    queueName: 'iot-activate-sensor',
    dependencies: [Step.CalibrateSensor],
    isChildStep: true,
    requiresAcknowledgement: true,
    itemIdInputField: 'sensorId',
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'sensor', transformations: ['fieldMapping', 'calibrationCheck'] },
    },
  },

  // ── Phase 4: Nested Fan-Out — Discover readings for each sensor ───────────
  // NOTE: DiscoverReadings is a CHILD step of DiscoverSensors (part of its childStepChain).
  // It runs once per sensor, receiving sensorId from the fan-out chain input.
  // It is ALSO a fan-out parent itself, creating IngestReading/PublishReading children.
  {
    step: Step.DiscoverReadings,
    description: 'Discover all reading batch IDs for a sensor',
    functionName: 'iot-discover-readings',
    queueName: 'iot-discover-readings',
    dependencies: [Step.ActivateSensor],
    isChildStep: true,
    itemIdInputField: 'sensorId',
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'readings', filterKey: 'sensorId' },
    },
    fanOut: {
      enabled: true,
      childStepType: Step.IngestReading,
      itemIdField: 'readingBatchIds',
      childStepChain: [Step.IngestReading, Step.PublishReading],
    },
  },
  {
    step: Step.IngestReading,
    description: 'Ingest one reading batch from sensor data store',
    functionName: 'iot-ingest-reading',
    queueName: 'iot-ingest-reading',
    dependencies: [],
    isChildStep: true,
    itemIdInputField: 'readingBatchId',
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'readings', filterKey: 'readingBatchId' },
    },
  },
  {
    step: Step.PublishReading,
    description: 'Publish normalized reading to analytics platform and await storage confirmation',
    functionName: 'iot-publish-reading',
    queueName: 'iot-publish-reading',
    dependencies: [Step.IngestReading],
    isChildStep: true,
    requiresAcknowledgement: true,
    itemIdInputField: 'readingBatchId',
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'reading', transformations: ['fieldMapping', 'unitConversion'] },
    },
  },

  // ── Phase 5: Alert — threshold alerts derived from readings ───────────────
  {
    step: Step.EvaluateAlert,
    description: 'Evaluate threshold conditions against readings to detect anomalies',
    functionName: 'iot-evaluate-alert',
    queueName: 'iot-evaluate-alert',
    dependencies: [Step.PublishReading],
    featureGate: 'ENABLE_ALERT_GENERATION',
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'alerts', filterKey: 'sensorId' },
    },
  },
  {
    step: Step.DispatchAlert,
    description: 'Dispatch alert notification and await delivery confirmation',
    functionName: 'iot-dispatch-alert',
    queueName: 'iot-dispatch-alert',
    dependencies: [Step.EvaluateAlert, Step.ProvisionDevice],
    requiresAcknowledgement: true,
    featureGate: 'ENABLE_ALERT_GENERATION',
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'alert', transformations: ['fieldMapping', 'thresholdEvaluation'] },
    },
  },

  // ── Phase 5: Aggregate — hourly aggregation of readings ───────────────────
  {
    step: Step.ComputeAggregate,
    description: 'Compute statistical aggregation over sensor readings',
    functionName: 'iot-compute-aggregate',
    queueName: 'iot-compute-aggregate',
    dependencies: [Step.DiscoverReadings],
    isChildStep: true,
    itemIdInputField: 'sensorId',
    metadata: {
      sourceConfig: { sourceDatabase: 'iot_sensor_pipeline_db', sourceTable: 'aggregates', filterKey: 'sensorId' },
    },
  },
  {
    step: Step.PublishAggregate,
    description: 'Publish aggregated metrics to analytics platform and await confirmation',
    functionName: 'iot-publish-aggregate',
    queueName: 'iot-publish-aggregate',
    dependencies: [Step.ComputeAggregate],
    isChildStep: true,
    requiresAcknowledgement: true,
    itemIdInputField: 'sensorId',
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'aggregate', transformations: ['fieldMapping', 'statisticalComputation'] },
    },
  },

  // ── Final: Archive all processed data to product DB ──────────────────────
  {
    step: Step.ArchiveProcessedPipeline,
    description: 'Archive all processed pipeline data to product database',
    functionName: 'iot-archive-processed-pipeline',
    queueName: 'iot-archive-processed-pipeline',
    dependencies: [Step.ProvisionDevice, Step.DiscoverReadings, Step.DispatchAlert, Step.PublishAggregate],
    requiresAcknowledgement: false,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { outputDatabase: 'iot_sensor_pipeline_product_db' },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CONFIGURATION (FK dependency graph)
//
// Visual cascade:
//   Device (root)
//      |                              |
//   Sensor (fan-out)               Alert
//      |                              |
//   Reading (nested fan-out)       Aggregate
// ═══════════════════════════════════════════════════════════════════════════════

const CASCADES: CascadeConfig[] = [
  {
    cascadeName: 'device',
    dependsOn: [],
    inputStep: Step.RegisterDevice,
    outputStep: Step.ProvisionDevice,
    kafkaTopic: 'iot-sensor-pipeline.device.completed',
    ackTopic: 'iot-sensor-pipeline.device.ack',
    outputDataKey: 'provisionedDevices',
  },
  {
    cascadeName: 'sensor',
    dependsOn: ['device'],
    fkExtractor: ({ device }) => ({
      ext_device_id: device?.externalId as string ?? '',
    }),
    childFkExtractor: (ack) => ack.externalId as string | undefined,
    inputStep: Step.CalibrateSensor,
    outputStep: Step.ActivateSensor,
    kafkaTopic: 'iot-sensor-pipeline.sensor.completed',
    ackTopic: 'iot-sensor-pipeline.sensor.ack',
    outputDataKey: 'activatedSensors',
    isFanOutParent: true,
    discoveryStep: Step.DiscoverSensors,
  },
  {
    cascadeName: 'reading',
    dependsOn: ['sensor'],
    fkExtractor: ({ sensor }, fkMaps) => {
      // sensor is a fan-out parent; use fkMaps if available, fall back to single-ACK externalId
      const sensorFkMap = fkMaps['DiscoverSensors'];
      if (sensorFkMap && Object.keys(sensorFkMap).length > 0) {
        // When multiple sensors exist, the per-record lookup uses the first available FK value
        // (full per-record lookup requires sourceRecord.sensorEntityId — extendable by implementations)
        const firstValue = Object.values(sensorFkMap)[0];
        return { ext_sensor_id: firstValue ?? '' };
      }
      return { ext_sensor_id: sensor?.externalId as string ?? '' };
    },
    childFkExtractor: (ack) => ack.externalId as string | undefined,
    inputStep: Step.IngestReading,
    outputStep: Step.PublishReading,
    kafkaTopic: 'iot-sensor-pipeline.reading.completed',
    ackTopic: 'iot-sensor-pipeline.reading.ack',
    outputDataKey: 'publishedReadings',
    isFanOutParent: true,
    discoveryStep: Step.DiscoverReadings,
  },
  {
    cascadeName: 'alert',
    dependsOn: ['device'],
    fkExtractor: ({ device }) => ({
      ext_device_id: device?.externalId as string ?? '',
    }),
    inputStep: Step.EvaluateAlert,
    outputStep: Step.DispatchAlert,
    kafkaTopic: 'iot-sensor-pipeline.alert.completed',
    ackTopic: 'iot-sensor-pipeline.alert.ack',
    outputDataKey: 'dispatchedAlerts',
  },
  {
    cascadeName: 'aggregate',
    dependsOn: ['sensor'],
    fkExtractor: ({ sensor }, fkMaps) => {
      const sensorFkMap = fkMaps['DiscoverSensors'];
      if (sensorFkMap && Object.keys(sensorFkMap).length > 0) {
        const firstValue = Object.values(sensorFkMap)[0];
        return { ext_sensor_id: firstValue ?? '' };
      }
      return { ext_sensor_id: sensor?.externalId as string ?? '' };
    },
    inputStep: Step.ComputeAggregate,
    outputStep: Step.PublishAggregate,
    kafkaTopic: 'iot-sensor-pipeline.aggregate.completed',
    ackTopic: 'iot-sensor-pipeline.aggregate.ack',
    outputDataKey: 'publishedAggregates',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CRITICALITY RULES
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICALITY_RULES: CascadeCriticalityRule[] = [
  {
    cascadeName: 'device',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'sensor',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'reading',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'alert',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'aggregate',
    criticality: 'optional',
    allowEmpty: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OUTCOME RULES (evaluated in priority order, first match wins)
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICAL_CASCADES = ['device', 'sensor', 'reading'];
const OPTIONAL_CASCADES = ['alert', 'aggregate'];

const OUTCOME_RULES: OutcomeRule[] = [
  // RULE 1: Critical cascade failed (Device, Sensor, or Reading)
  {
    id: 'critical-cascade-failed',
    description: 'Device, Sensor, or Reading processing failed completely',
    priority: 10,
    condition: (ctx: JobContext) =>
      CRITICAL_CASCADES.some((cascade) => {
        const attempted = ctx.attemptedCascades.includes(cascade);
        const succeeded = (ctx.cascadeCounts[cascade] ?? 0) > 0;
        const isEmpty = ctx.emptyCascades.includes(cascade);
        return attempted && !succeeded && !isEmpty;
      }),
    outcome: (ctx: JobContext) => {
      const failedCritical = CRITICAL_CASCADES.filter((cascade) =>
        ctx.attemptedCascades.includes(cascade) &&
        (ctx.cascadeCounts[cascade] ?? 0) === 0 &&
        !ctx.emptyCascades.includes(cascade),
      );
      return {
        jobStatus: 'failed',
        reason: `Critical cascade processing failed: ${failedCritical.join(', ')}`,
        warnings: [],
        errors: [`IoT pipeline cannot succeed without: ${failedCritical.join(', ')}`],
        metadata: { failedCriticalCascades: failedCritical },
      };
    },
  },

  // RULE 2: All cascades processed successfully
  {
    id: 'full-success',
    description: 'All cascades processed successfully (including empty valid cases)',
    priority: 20,
    condition: (ctx: JobContext) =>
      ctx.attemptedCascades.every((cascade) => {
        const succeeded = (ctx.cascadeCounts[cascade] ?? 0) > 0;
        const validEmpty = ctx.emptyCascades.includes(cascade);
        const hasFailures = (ctx.failedCascadeCounts[cascade] ?? 0) > 0;
        return (succeeded || validEmpty) && !hasFailures;
      }),
    outcome: (ctx: JobContext) => ({
      jobStatus: 'completed',
      reason: 'All cascades processed successfully',
      warnings: ctx.emptyCascades.length > 0
        ? [`No data found for: ${ctx.emptyCascades.join(', ')} (valid outcome)`]
        : [],
      errors: [],
      metadata: {
        cascadeCounts: ctx.cascadeCounts,
        emptyCascades: ctx.emptyCascades,
      },
    }),
  },

  // RULE 3: Partial success — critical OK but some optional cascades failed
  {
    id: 'partial-success-optional-failed',
    description: 'Critical cascades succeeded but some optional cascades failed',
    priority: 30,
    condition: (ctx: JobContext) => {
      const criticalOk = CRITICAL_CASCADES.every((cascade) =>
        (ctx.cascadeCounts[cascade] ?? 0) > 0 || ctx.emptyCascades.includes(cascade),
      );
      const hasOptionalFailures = OPTIONAL_CASCADES.some(
        (cascade) => (ctx.failedCascadeCounts[cascade] ?? 0) > 0,
      );
      return criticalOk && hasOptionalFailures;
    },
    outcome: (ctx: JobContext) => {
      const failedOptional = OPTIONAL_CASCADES.filter(
        (cascade) => (ctx.failedCascadeCounts[cascade] ?? 0) > 0,
      );
      return {
        jobStatus: 'partial_success',
        reason: `IoT pipeline completed with partial failures: ${failedOptional.join(', ')}`,
        warnings: [`Some ${failedOptional.join(', ')} records failed to process`],
        errors: [],
        metadata: {
          failedOptionalCascades: failedOptional,
          failedCascadeCounts: ctx.failedCascadeCounts,
        },
      };
    },
  },

  // RULE 4: Fallback
  {
    id: 'fallback-unknown',
    description: 'Unknown state — needs investigation',
    priority: 100,
    condition: () => true,
    outcome: (ctx: JobContext) => ({
      jobStatus: 'failed',
      reason: 'Unable to determine processing outcome — needs investigation',
      warnings: [],
      errors: ['Processing outcome could not be determined from rules'],
      metadata: { context: ctx },
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION (exported)
// ═══════════════════════════════════════════════════════════════════════════════

export const iotSensorPipelineWorkflow: WorkflowDefinition = {
  name: 'iot-sensor-pipeline',
  description: 'IoT data ingestion pipeline with double fan-out, feature flags, and conditional steps',

  variants: {
    default: { description: 'Full pipeline with double fan-out', isDefault: true },
  },

  steps: {
    default: DEFAULT_STEPS,
  },

  cascades: CASCADES,
  outcomeRules: OUTCOME_RULES,
  cascadeCriticalityRules: CRITICALITY_RULES,

  featureFlags: {
    defaults: {
      ENABLE_DEDUPLICATION: true,
      ENABLE_CASCADE_FK_INJECTION: true,
      ENABLE_ALERT_GENERATION: true,
      ENABLE_AGGREGATION: true,
    },
    clientOverridable: ['ENABLE_DEDUPLICATION', 'ENABLE_ALERT_GENERATION', 'ENABLE_AGGREGATION'],
  },
};

export default iotSensorPipelineWorkflow;
