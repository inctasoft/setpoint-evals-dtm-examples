/**
 * Order Processing — Workflow Definition
 *
 * Single source of truth for the e-commerce order processing pipeline.
 *
 * The DTM orchestrator reads this definition to know:
 *   - What steps exist and their dependency DAG (steps)
 *   - How entities cascade with FK dependencies (cascades)
 *   - What determines job success/failure (outcomeRules, cascadeCriticalityRules)
 *   - What Kafka topics to publish to and listen on (cascades)
 *
 * Entities:
 *   Customer (root) -> Order -> LineItem (fan-out), Payment, Shipment
 *   Product (root, validate-only)
 *
 * Visual cascade:
 *   Customer (root)
 *      |  ext_customer_id
 *      v
 *   Order
 *      |  ext_order_id           |  ext_order_id         |  ext_order_id
 *      v                         v                        v
 *   LineItem (fan-out)        Payment                  Shipment
 *
 *   Product (root, validate-only — no submit/cascade)
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
  // Root entities — Validate
  ValidateCustomer = 'ValidateCustomer',
  ValidateProduct = 'ValidateProduct',

  // Customer — Submit
  SubmitCustomer = 'SubmitCustomer',

  // Order — Validate & Submit
  ValidateOrder = 'ValidateOrder',
  SubmitOrder = 'SubmitOrder',

  // LineItem — Fan-Out
  DiscoverLineItems = 'DiscoverLineItems',
  ValidateLineItem = 'ValidateLineItem',
  SubmitLineItem = 'SubmitLineItem',

  // Payment — Validate & Submit
  ValidatePayment = 'ValidatePayment',
  SubmitPayment = 'SubmitPayment',

  // Shipment — Validate & Submit
  ValidateShipment = 'ValidateShipment',
  SubmitShipment = 'SubmitShipment',

  // Archive — Final step writing to product DB
  ArchiveProcessedOrder = 'ArchiveProcessedOrder',
}

export type EntityType =
  | 'customer'
  | 'product'
  | 'order'
  | 'lineItem'
  | 'payment'
  | 'shipment';

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS — default variant (full fan-out workflow with all entities)
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_STEPS: StepDefinition[] = [
  // ── Phase 1: Validate root entities (parallel) ─────────────────────────────
  {
    step: Step.ValidateCustomer,
    description: 'Validate customer exists and fetch account profile',
    functionName: 'order-validate-customer',
    queueName: 'order-validate-customer',
    dependencies: [],
    payloadEnrichments: [
      { outputField: 'customerId', payloadField: 'customerId' },
    ],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'customers', filterKey: 'customerId' },
    },
  },
  {
    step: Step.ValidateProduct,
    description: 'Validate product exists and fetch catalog data',
    functionName: 'order-validate-product',
    queueName: 'order-validate-product',
    dependencies: [],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'products', filterKey: 'productId' },
    },
  },

  // ── Phase 2: Submit customer ───────────────────────────────────────────
  {
    step: Step.SubmitCustomer,
    description: 'Submit customer record to CRM/ERP and await registration confirmation',
    functionName: 'order-submit-customer',
    queueName: 'order-submit-customer',
    dependencies: [Step.ValidateCustomer],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'customer', transformations: ['fieldMapping', 'normalizeAddress', 'validateEmail'] },
    },
  },

  // ── Phase 3: Validate order (depends on customer validation) ───────────
  {
    step: Step.ValidateOrder,
    description: 'Validate order exists and fetch order details',
    functionName: 'order-validate-order',
    queueName: 'order-validate-order',
    dependencies: [Step.ValidateCustomer],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'orders', filterKey: 'orderId' },
    },
  },

  // ── Phase 4: Submit order (depends on validate + customer submit) ────
  {
    step: Step.SubmitOrder,
    description: 'Submit order record to OMS and await order confirmation',
    functionName: 'order-submit-order',
    queueName: 'order-submit-order',
    dependencies: [Step.ValidateOrder, Step.SubmitCustomer],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'order', transformations: ['fieldMapping', 'calculateTotals', 'currencyConversion'] },
    },
  },

  // ── Phase 5: Fan-Out — LineItems ─────────────────────────────────────────
  {
    step: Step.DiscoverLineItems,
    description: 'Discover all line item IDs for an order',
    functionName: 'order-discover-line-items',
    queueName: 'order-discover-line-items',
    dependencies: [Step.ValidateOrder],
    fanOut: {
      enabled: true,
      childStepType: Step.ValidateLineItem,
      itemIdField: 'orderItemIds',
      childStepChain: [Step.ValidateLineItem, Step.SubmitLineItem],
    },
  },
  {
    step: Step.ValidateLineItem,
    description: 'Validate ONE line item from source system (child step)',
    functionName: 'order-validate-line-item',
    queueName: 'order-validate-line-item',
    dependencies: [],
    isChildStep: true,
    itemIdInputField: 'orderItemId',
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'order_items', filterKey: 'orderItemId' },
    },
  },
  {
    step: Step.SubmitLineItem,
    description: 'Submit ONE line item to fulfillment system (child step)',
    functionName: 'order-submit-line-item',
    queueName: 'order-submit-line-item',
    dependencies: [Step.ValidateLineItem],
    isChildStep: true,
    requiresAcknowledgement: true,
    itemIdInputField: 'orderItemId',
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'lineItem', transformations: ['fieldMapping', 'priceCalculation', 'inventoryCheck'] },
    },
  },

  // ── Phase 5: Validate payment & shipment (parallel, depend on order) ───────
  {
    step: Step.ValidatePayment,
    description: 'Validate payment exists and fetch transaction details',
    functionName: 'order-validate-payment',
    queueName: 'order-validate-payment',
    dependencies: [Step.ValidateOrder],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'payments', filterKey: 'paymentId' },
    },
  },
  {
    step: Step.SubmitPayment,
    description: 'Submit payment record to payment gateway and await settlement confirmation',
    functionName: 'order-submit-payment',
    queueName: 'order-submit-payment',
    dependencies: [Step.ValidatePayment, Step.SubmitOrder],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'payment', transformations: ['fieldMapping', 'paymentGatewayMapping', 'fraudCheck'] },
    },
  },
  {
    step: Step.ValidateShipment,
    description: 'Validate shipment exists and fetch logistics details',
    functionName: 'order-validate-shipment',
    queueName: 'order-validate-shipment',
    dependencies: [Step.ValidateOrder],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'shipments', filterKey: 'shipmentId' },
    },
  },
  {
    step: Step.SubmitShipment,
    description: 'Submit shipment record to logistics provider and await dispatch confirmation',
    functionName: 'order-submit-shipment',
    queueName: 'order-submit-shipment',
    dependencies: [Step.ValidateShipment, Step.SubmitOrder],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'shipment', transformations: ['fieldMapping', 'carrierMapping', 'trackingGeneration'] },
    },
  },

  // ── Final: Archive all processed data to product DB ──────────────────────
  {
    step: Step.ArchiveProcessedOrder,
    description: 'Archive all processed order data to product database',
    functionName: 'order-archive-processed-order',
    queueName: 'order-archive-processed-order',
    dependencies: [Step.SubmitCustomer, Step.SubmitOrder, Step.DiscoverLineItems, Step.SubmitPayment, Step.SubmitShipment],
    requiresAcknowledgement: false,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { outputDatabase: 'order_processing_product_db' },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// STEPS — quick-order variant (simplified fast-path, no fan-out)
// ═══════════════════════════════════════════════════════════════════════════════

const QUICK_ORDER_STEPS: StepDefinition[] = [
  {
    step: Step.ValidateCustomer,
    description: 'Validate customer exists and fetch account profile',
    functionName: 'order-validate-customer',
    queueName: 'order-validate-customer',
    dependencies: [],
    payloadEnrichments: [
      { outputField: 'customerId', payloadField: 'customerId' },
    ],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'customers', filterKey: 'customerId' },
    },
  },
  {
    step: Step.SubmitCustomer,
    description: 'Submit customer record to CRM/ERP and await registration confirmation',
    functionName: 'order-submit-customer',
    queueName: 'order-submit-customer',
    dependencies: [Step.ValidateCustomer],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'customer', transformations: ['fieldMapping', 'normalizeAddress', 'validateEmail'] },
    },
  },
  {
    step: Step.ValidateOrder,
    description: 'Validate order exists and fetch order details',
    functionName: 'order-validate-order',
    queueName: 'order-validate-order',
    dependencies: [Step.ValidateCustomer],
    metadata: {
      sourceConfig: { sourceDatabase: 'ecommerce', sourceTable: 'orders', filterKey: 'orderId' },
    },
  },
  {
    step: Step.SubmitOrder,
    description: 'Submit order record to OMS and await order confirmation',
    functionName: 'order-submit-order',
    queueName: 'order-submit-order',
    dependencies: [Step.ValidateOrder, Step.SubmitCustomer],
    requiresAcknowledgement: true,
    collectDependencyOutputs: true,
    metadata: {
      processingConfig: { inputDataType: 'order', transformations: ['fieldMapping', 'calculateTotals', 'currencyConversion'] },
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CONFIGURATION (FK dependency graph)
//
// Visual cascade:
//   Customer (root)
//      |
//   Order
//      |                       |                       |
//   LineItem (fan-out)      Payment                 Shipment
//
//   Product (root, validate-only — no cascade entry)
// ═══════════════════════════════════════════════════════════════════════════════

const CASCADES: CascadeConfig[] = [
  {
    cascadeName: 'customer',
    dependsOn: [],
    inputStep: Step.ValidateCustomer,
    outputStep: Step.SubmitCustomer,
    kafkaTopic: 'order-processing.customer.completed',
    ackTopic: 'order-processing.customer.ack',
    outputDataKey: 'submittedCustomers',
  },
  {
    cascadeName: 'order',
    dependsOn: ['customer'],
    fkExtractor: ({ customer }) => ({
      ext_customer_id: customer?.externalId as string ?? '',
    }),
    inputStep: Step.ValidateOrder,
    outputStep: Step.SubmitOrder,
    kafkaTopic: 'order-processing.order.completed',
    ackTopic: 'order-processing.order.ack',
    outputDataKey: 'submittedOrders',
  },
  {
    cascadeName: 'lineItem',
    dependsOn: ['order'],
    fkExtractor: ({ order }) => ({
      ext_order_id: order?.externalId as string ?? '',
    }),
    childFkExtractor: (ack) => ack.externalId as string | undefined,
    inputStep: Step.ValidateLineItem,
    outputStep: Step.SubmitLineItem,
    kafkaTopic: 'order-processing.line-item.completed',
    ackTopic: 'order-processing.line-item.ack',
    outputDataKey: 'submittedLineItems',
    isFanOutParent: true,
    discoveryStep: Step.DiscoverLineItems,
  },
  {
    cascadeName: 'payment',
    dependsOn: ['order'],
    fkExtractor: ({ order }) => ({
      ext_order_id: order?.externalId as string ?? '',
    }),
    inputStep: Step.ValidatePayment,
    outputStep: Step.SubmitPayment,
    kafkaTopic: 'order-processing.payment.completed',
    ackTopic: 'order-processing.payment.ack',
    outputDataKey: 'submittedPayments',
  },
  {
    cascadeName: 'shipment',
    dependsOn: ['order'],
    fkExtractor: ({ order }) => ({
      ext_order_id: order?.externalId as string ?? '',
    }),
    inputStep: Step.ValidateShipment,
    outputStep: Step.SubmitShipment,
    kafkaTopic: 'order-processing.shipment.completed',
    ackTopic: 'order-processing.shipment.ack',
    outputDataKey: 'submittedShipments',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CASCADE CRITICALITY RULES
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICALITY_RULES: CascadeCriticalityRule[] = [
  {
    cascadeName: 'customer',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'order',
    criticality: 'required',
    allowEmpty: false,
    minCount: 1,
  },
  {
    cascadeName: 'lineItem',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'payment',
    criticality: 'optional',
    allowEmpty: true,
  },
  {
    cascadeName: 'shipment',
    criticality: 'optional',
    allowEmpty: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OUTCOME RULES (evaluated in priority order, first match wins)
// ═══════════════════════════════════════════════════════════════════════════════

const CRITICAL_CASCADES = ['customer', 'order'];
const OPTIONAL_CASCADES = ['lineItem', 'payment', 'shipment'];

const OUTCOME_RULES: OutcomeRule[] = [
  // RULE 1: Critical cascade failed (Customer or Order)
  {
    id: 'critical-cascade-failed',
    description: 'Customer or Order processing failed completely',
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
        errors: [`Order processing cannot succeed without: ${failedCritical.join(', ')}`],
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
        reason: `Order processing completed with partial failures: ${failedOptional.join(', ')}`,
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

export const orderProcessingWorkflow: WorkflowDefinition = {
  name: 'order-processing',
  description: 'E-commerce order processing pipeline with 6 entity types and FK cascade',

  variants: {
    default: { description: 'Full fan-out workflow with all entities', isDefault: true },
    'quick-order': { description: 'Simplified fast-path — no fan-out, no line items, just customer and order validation and submission' },
  },

  steps: {
    default: DEFAULT_STEPS,
    'quick-order': QUICK_ORDER_STEPS,
  },

  cascades: CASCADES,
  outcomeRules: OUTCOME_RULES,
  cascadeCriticalityRules: CRITICALITY_RULES,

  featureFlags: {
    defaults: {
      ENABLE_DEDUPLICATION: true,
      ENABLE_CASCADE_FK_INJECTION: true,
      ENABLE_SHIPMENT_TRACKING: true,
    },
    clientOverridable: ['ENABLE_DEDUPLICATION', 'ENABLE_SHIPMENT_TRACKING'],
  },
};

export default orderProcessingWorkflow;
