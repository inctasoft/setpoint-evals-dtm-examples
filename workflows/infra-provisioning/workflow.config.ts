/**
 * Infrastructure Provisioning — Workflow Definition
 *
 * Single source of truth for the infrastructure provisioning pipeline.
 *
 * The DTM orchestrator reads this definition to know:
 *   - What steps exist and their dependency DAG (steps)
 *   - How entities cascade with FK dependencies (cascades)
 *   - What determines job success/failure (outcomeRules, cascadeCriticalityRules)
 *   - What Kafka topics to publish to and listen on (cascades)
 *
 * Entities:
 *   Environment (root) -> Network -> Compute (fan-out) -> Storage
 *                                                      -> DNS -> Certificate
 *                                                      -> LoadBalancer
 *
 * Visual cascade:
 *   Environment (root)
 *      |  ext_environment_id
 *      v
 *   Network
 *      |  ext_network_id
 *      v
 *   Compute (fan-out by instance count)
 *      |  ext_compute_id           |  ext_network_id + ext_compute_id       |  ext_network_id + ext_compute_id
 *      v                           v                                         v
 *   Storage                      DNS                                      LoadBalancer
 *                                  |  ext_dns_id
 *                                  v
 *                               Certificate
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
  // Environment — Plan & Apply
  PlanEnvironment = 'PlanEnvironment',
  ApplyEnvironment = 'ApplyEnvironment',

  // Network — Plan & Apply
  PlanNetwork = 'PlanNetwork',
  ApplyNetwork = 'ApplyNetwork',

  // Compute — Fan-Out (Discovery -> Plan -> Apply)
  DiscoverCompute = 'DiscoverCompute',
  PlanCompute = 'PlanCompute',
  ApplyCompute = 'ApplyCompute',

  // Storage — Plan & Apply
  PlanStorage = 'PlanStorage',
  ApplyStorage = 'ApplyStorage',

  // DNS — Plan & Apply
  PlanDNS = 'PlanDNS',
  ApplyDNS = 'ApplyDNS',

  // Certificate — Plan & Apply
  PlanCertificate = 'PlanCertificate',
  ApplyCertificate = 'ApplyCertificate',

  // LoadBalancer — Plan & Apply
  PlanLoadBalancer = 'PlanLoadBalancer',
  ApplyLoadBalancer = 'ApplyLoadBalancer',

  // Record — Final step writing to product DB
  RecordProvisionedInfra = 'RecordProvisionedInfra',
}

export type EntityType =
  | 'environment'
  | 'network'
  | 'compute'
  | 'storage'
  | 'dns'
  | 'certificate'
  | 'loadBalancer';

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS — default variant (full provisioning workflow with all entities)
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_STEPS: StepDefinition[] = [
  // ── Phase 1: Plan environment (root entity) ────────────────────────────
  {
    step: Step.PlanEnvironment,
    description: 'Plan target environment configuration (dev/staging/prod)',
    functionName: 'infra-plan-environment',
    queueName: 'infra-plan-environment',
    dependencies: [],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'environments', filterKey: 'environmentId' },
    },
  },

  // ── Phase 2: Apply environment (ACK) ──────────────────────────────────
  {
    step: Step.ApplyEnvironment,
    description: 'Apply environment configuration to cloud provider and await provisioning confirmation',
    functionName: 'infra-apply-environment',
    queueName: 'infra-apply-environment',
    dependencies: [Step.PlanEnvironment],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'environment', transformations: ['fieldMapping', 'validateRegion', 'resolveAccountId'] },
    },
  },

  // ── Phase 3: Plan network ──────────────────────────────────────────────
  {
    step: Step.PlanNetwork,
    description: 'Plan VPC and subnet configuration',
    functionName: 'infra-plan-network',
    queueName: 'infra-plan-network',
    dependencies: [Step.ApplyEnvironment],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'networks', filterKey: 'environmentId' },
    },
  },

  // ── Phase 4: Apply network (ACK) ─────────────────────────────────────
  {
    step: Step.ApplyNetwork,
    description: 'Apply network configuration and await VPC ready confirmation',
    functionName: 'infra-apply-network',
    queueName: 'infra-apply-network',
    dependencies: [Step.PlanNetwork],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'network', transformations: ['fieldMapping', 'cidrValidation', 'subnetAllocation'] },
    },
  },

  // ── Phase 5: Fan-Out — Compute instances ──────────────────────────────
  {
    step: Step.DiscoverCompute,
    description: 'Discover all compute instance IDs for provisioning',
    functionName: 'infra-discover-compute',
    queueName: 'infra-discover-compute',
    dependencies: [Step.ApplyNetwork],
    fanOut: {
      enabled: true,
      childStepType: Step.PlanCompute,
      itemIdField: 'computeInstanceIds',
      childStepChain: [Step.PlanCompute, Step.ApplyCompute],
    },
  },
  {
    step: Step.PlanCompute,
    description: 'Plan one compute instance configuration',
    functionName: 'infra-plan-compute',
    queueName: 'infra-plan-compute',
    dependencies: [],
    isChildStep: true,
    itemIdInputField: 'computeInstanceId',
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'compute_instances', filterKey: 'computeInstanceId' },
    },
  },
  {
    step: Step.ApplyCompute,
    description: 'Apply compute instance to cloud provider and await instance ready confirmation',
    functionName: 'infra-apply-compute',
    queueName: 'infra-apply-compute',
    dependencies: [Step.PlanCompute],
    isChildStep: true,
    requiresAcknowledgement: true,
    itemIdInputField: 'computeInstanceId',
    collectDependencyOutputs: true,
    metadata: {
      timeoutMs: 600000,
      processingConfig: { inputDataType: 'compute', transformations: ['fieldMapping', 'instanceTypeMapping', 'securityGroupAssignment'] },
    },
  },

  // ── Phase 6: Plan storage (depends on compute) ────────────────────────
  {
    step: Step.PlanStorage,
    description: 'Plan storage volume configuration',
    functionName: 'infra-plan-storage',
    queueName: 'infra-plan-storage',
    dependencies: [Step.ApplyCompute],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'storage_volumes', filterKey: 'instanceId' },
    },
  },
  {
    step: Step.ApplyStorage,
    description: 'Apply storage volume and await attachment confirmation',
    functionName: 'infra-apply-storage',
    queueName: 'infra-apply-storage',
    dependencies: [Step.PlanStorage],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'storage', transformations: ['fieldMapping', 'volumeTypeMapping', 'iopsCalculation'] },
    },
  },

  // ── Phase 6: Plan DNS (depends on network + compute) ──────────────────
  {
    step: Step.PlanDNS,
    description: 'Plan DNS record configuration',
    functionName: 'infra-plan-dns',
    queueName: 'infra-plan-dns',
    dependencies: [Step.ApplyNetwork, Step.ApplyCompute],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'dns_records', filterKey: 'dnsRecordId' },
    },
  },
  {
    step: Step.ApplyDNS,
    description: 'Apply DNS records and await propagation confirmation',
    functionName: 'infra-apply-dns',
    queueName: 'infra-apply-dns',
    dependencies: [Step.PlanDNS],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'dns', transformations: ['fieldMapping', 'recordTypeValidation', 'ttlNormalization'] },
    },
  },

  // ── Phase 7: Plan certificate (depends on DNS) ────────────────────────
  {
    step: Step.PlanCertificate,
    description: 'Plan TLS certificate configuration',
    functionName: 'infra-plan-certificate',
    queueName: 'infra-plan-certificate',
    dependencies: [Step.ApplyDNS],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'certificates', filterKey: 'certificateId' },
    },
  },
  {
    step: Step.ApplyCertificate,
    description: 'Request TLS certificate issuance and await validation confirmation',
    functionName: 'infra-apply-certificate',
    queueName: 'infra-apply-certificate',
    dependencies: [Step.PlanCertificate],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'certificate', transformations: ['fieldMapping', 'domainValidation', 'expiryCheck'] },
    },
  },

  // ── Phase 6: Plan load balancer (depends on network + compute) ────────
  {
    step: Step.PlanLoadBalancer,
    description: 'Plan load balancer configuration',
    functionName: 'infra-plan-load-balancer',
    queueName: 'infra-plan-load-balancer',
    dependencies: [Step.ApplyNetwork, Step.ApplyCompute],
    metadata: {
      sourceConfig: { sourceDatabase: 'infra_cmdb', sourceTable: 'load_balancers', filterKey: 'loadBalancerId' },
    },
  },
  {
    step: Step.ApplyLoadBalancer,
    description: 'Apply load balancer and await healthy status confirmation',
    functionName: 'infra-apply-load-balancer',
    queueName: 'infra-apply-load-balancer',
    dependencies: [Step.PlanLoadBalancer],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'loadBalancer', transformations: ['fieldMapping', 'listenerConfig', 'healthCheckSetup'] },
    },
  },

  // ── Final: Record all provisioned infrastructure to product DB ───────────
  {
    step: Step.RecordProvisionedInfra,
    description: 'Record all provisioned infrastructure to product database',
    functionName: 'infra-record-provisioned-infra',
    queueName: 'infra-record-provisioned-infra',
    dependencies: [Step.ApplyEnvironment, Step.ApplyNetwork, Step.ApplyStorage, Step.ApplyDNS, Step.ApplyCertificate, Step.ApplyLoadBalancer],
    requiresAcknowledgement: false,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { outputDatabase: 'infra_provisioning_product_db' },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CONFIGURATION (FK dependency graph)
//
// Visual cascade:
//   Environment (root)
//      |
//   Network
//      |
//   Compute (fan-out by instance count)
//      |                   |                                  |
//   Storage              DNS                              LoadBalancer
//                          |
//                       Certificate
// ═══════════════════════════════════════════════════════════════════════════════

const CASCADES: CascadeConfig[] = [
  {
    cascadeName: 'environment',
    dependsOn: [],
    inputStep: Step.PlanEnvironment,
    outputStep: Step.ApplyEnvironment,
    kafkaTopic: 'infra-provisioning.environment.completed',
    ackTopic: 'infra-provisioning.environment.ack',
    outputDataKey: 'appliedEnvironments',
  },
  {
    cascadeName: 'network',
    dependsOn: ['environment'],
    fkExtractor: ({ environment }) => ({
      ext_environment_id: environment?.externalId as string ?? '',
    }),
    inputStep: Step.PlanNetwork,
    outputStep: Step.ApplyNetwork,
    kafkaTopic: 'infra-provisioning.network.completed',
    ackTopic: 'infra-provisioning.network.ack',
    outputDataKey: 'appliedNetworks',
  },
  {
    cascadeName: 'compute',
    dependsOn: ['network'],
    fkExtractor: ({ network }) => ({
      ext_network_id: network?.externalId as string ?? '',
    }),
    childFkExtractor: (ack) => ack.externalId as string | undefined,
    inputStep: Step.PlanCompute,
    outputStep: Step.ApplyCompute,
    kafkaTopic: 'infra-provisioning.compute.completed',
    ackTopic: 'infra-provisioning.compute.ack',
    outputDataKey: 'appliedCompute',
    isFanOutParent: true,
    discoveryStep: Step.DiscoverCompute,
  },
  {
    cascadeName: 'storage',
    dependsOn: ['compute'],
    fkExtractor: ({ compute }, fkMaps) => {
      const computeFkMap = fkMaps['DiscoverCompute'];
      if (computeFkMap && Object.keys(computeFkMap).length > 0) {
        const firstValue = Object.values(computeFkMap)[0];
        return { ext_compute_id: firstValue ?? '' };
      }
      return { ext_compute_id: compute?.externalId as string ?? '' };
    },
    inputStep: Step.PlanStorage,
    outputStep: Step.ApplyStorage,
    kafkaTopic: 'infra-provisioning.storage.completed',
    ackTopic: 'infra-provisioning.storage.ack',
    outputDataKey: 'appliedStorage',
  },
  {
    cascadeName: 'dns',
    dependsOn: ['network', 'compute'],
    fkExtractor: ({ network, compute }, fkMaps) => {
      const computeFkMap = fkMaps['DiscoverCompute'];
      const computeId = (computeFkMap && Object.keys(computeFkMap).length > 0)
        ? Object.values(computeFkMap)[0] ?? ''
        : compute?.externalId as string ?? '';
      return {
        ext_network_id: network?.externalId as string ?? '',
        ext_compute_id: computeId,
      };
    },
    inputStep: Step.PlanDNS,
    outputStep: Step.ApplyDNS,
    kafkaTopic: 'infra-provisioning.dns.completed',
    ackTopic: 'infra-provisioning.dns.ack',
    outputDataKey: 'appliedDNS',
  },
  {
    cascadeName: 'certificate',
    dependsOn: ['dns'],
    fkExtractor: ({ dns }) => ({
      ext_dns_id: dns?.externalId as string ?? '',
    }),
    inputStep: Step.PlanCertificate,
    outputStep: Step.ApplyCertificate,
    kafkaTopic: 'infra-provisioning.certificate.completed',
    ackTopic: 'infra-provisioning.certificate.ack',
    outputDataKey: 'appliedCertificates',
  },
  {
    cascadeName: 'loadBalancer',
    dependsOn: ['network', 'compute'],
    fkExtractor: ({ network, compute }, fkMaps) => {
      const computeFkMap = fkMaps['DiscoverCompute'];
      const computeId = (computeFkMap && Object.keys(computeFkMap).length > 0)
        ? Object.values(computeFkMap)[0] ?? ''
        : compute?.externalId as string ?? '';
      return {
        ext_network_id: network?.externalId as string ?? '',
        ext_compute_id: computeId,
      };
    },
    inputStep: Step.PlanLoadBalancer,
    outputStep: Step.ApplyLoadBalancer,
    kafkaTopic: 'infra-provisioning.load-balancer.completed',
    ackTopic: 'infra-provisioning.load-balancer.ack',
    outputDataKey: 'appliedLoadBalancers',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CRITICALITY RULES
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICALITY_RULES: CascadeCriticalityRule[] = [
  {
    cascadeName: 'environment',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'network',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'compute',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'storage',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'dns',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'certificate',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'loadBalancer',
    criticality: 'optional',
    allowEmpty: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OUTCOME RULES (evaluated in priority order, first match wins)
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICAL_CASCADES = ['environment', 'network', 'compute'];
const OPTIONAL_CASCADES = ['storage', 'dns', 'certificate', 'loadBalancer'];

const OUTCOME_RULES: OutcomeRule[] = [
  // RULE 1: Critical cascade failed (Environment, Network, or Compute)
  {
    id: 'critical-cascade-failed',
    description: 'Environment, Network, or Compute processing failed completely',
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
        errors: [`Infrastructure provisioning cannot succeed without: ${failedCritical.join(', ')}`],
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
      reason: 'All cascades provisioned successfully',
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
        reason: `Infrastructure provisioning completed with partial failures: ${failedOptional.join(', ')}`,
        warnings: [`Some ${failedOptional.join(', ')} records failed to provision`],
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
      reason: 'Unable to determine provisioning outcome — needs investigation',
      warnings: [],
      errors: ['Provisioning outcome could not be determined from rules'],
      metadata: { context: ctx },
    }),
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW DEFINITION (exported)
// ═══════════════════════════════════════════════════════════════════════════════

export const infraProvisioningWorkflow: WorkflowDefinition = {
  name: 'infra-provisioning',
  description: 'Infrastructure provisioning pipeline with 7 entity types, deep cascade chains, and long ACK timeouts',

  variants: {
    default: { description: 'Full provisioning workflow with all entities and fan-out compute', isDefault: true },
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
      ENABLE_LONG_ACK_TIMEOUT: true,
      ENABLE_CERTIFICATE_PROVISIONING: true,
    },
    clientOverridable: ['ENABLE_DEDUPLICATION', 'ENABLE_LONG_ACK_TIMEOUT', 'ENABLE_CERTIFICATE_PROVISIONING'],
  },
};

export default infraProvisioningWorkflow;
