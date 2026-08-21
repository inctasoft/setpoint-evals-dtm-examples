import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WorkflowConfigService } from './workflow-config.service';
import type { WorkflowDefinition } from '@dtm/core';

/**
 * WorkflowRegistryService
 *
 * Central registry that holds multiple WorkflowConfigService instances,
 * one per registered workflow. Provides lookup by workflow name, by ACK topic,
 * and aggregation methods for queue/topic discovery.
 *
 * Usage:
 *   // Get config for a specific workflow
 *   const config = this.registry.get('order-processing');
 *   const steps = config.getStepDefinitions('default');
 *
 *   // Get config by ACK topic (for acknowledgement handler)
 *   const config = this.registry.getByAckTopic('order-processing.customer.ack');
 *
 *   // Get all queue names across all workflows (for SQS poller)
 *   const queues = this.registry.getAllQueueNames();
 */
@Injectable()
export class WorkflowRegistryService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowRegistryService.name);

  /** Workflow name → WorkflowConfigService */
  private readonly workflows = new Map<string, WorkflowConfigService>();

  /** ACK topic → workflow name (for routing ACK messages) */
  private readonly ackTopicToWorkflow = new Map<string, string>();

  /** Kafka completed topic → workflow name (for routing) */
  private readonly completedTopicToWorkflow = new Map<string, string>();

  /** Disabled workflows (still registered but reject new jobs) */
  private readonly disabledWorkflows = new Set<string>();

  /** All registered variant names → workflow name (collision detection) */
  private readonly variantToWorkflow = new Map<string, string>();

  onModuleInit() {
    this.logger.log(
      `WorkflowRegistryService initialized with ${this.workflows.size} workflow(s): ` +
        `[${Array.from(this.workflows.keys()).join(', ')}]`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Registration
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a workflow definition.
   * Creates a WorkflowConfigService instance and indexes its topics/variants.
   */
  register(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.name)) {
      this.logger.warn(`Workflow '${workflow.name}' is already registered. Replacing.`);
    }

    // Check for variant name collisions across workflows
    for (const variantName of Object.keys(workflow.variants)) {
      const existingOwner = this.variantToWorkflow.get(variantName);
      if (existingOwner && existingOwner !== workflow.name) {
        this.logger.warn(
          `Variant name '${variantName}' is used by both '${existingOwner}' and '${workflow.name}'. ` +
            `This may cause ambiguity in job type resolution. Consider unique variant names.`,
        );
      }
      this.variantToWorkflow.set(variantName, workflow.name);
    }

    // Create a WorkflowConfigService instance for this workflow
    const configService = new WorkflowConfigService(workflow);
    this.workflows.set(workflow.name, configService);

    // Index ACK topics for this workflow
    for (const cascade of workflow.cascades) {
      if (cascade.ackTopic) {
        this.ackTopicToWorkflow.set(cascade.ackTopic, workflow.name);
      }
      if (cascade.kafkaTopic) {
        this.completedTopicToWorkflow.set(cascade.kafkaTopic, workflow.name);
      }
    }

    this.logger.log(
      `Registered workflow '${workflow.name}' with ` +
        `${Object.keys(workflow.variants).length} variant(s), ` +
        `${workflow.cascades.length} cascade(s), ` +
        `${workflow.outcomeRules.length} outcome rule(s)`,
    );
  }

  /**
   * Deregister a workflow by name.
   */
  deregister(name: string): boolean {
    const config = this.workflows.get(name);
    if (!config) {
      return false;
    }

    // Remove topic index entries
    const workflow = config.getWorkflow();
    for (const cascade of workflow.cascades) {
      if (cascade.ackTopic) {
        this.ackTopicToWorkflow.delete(cascade.ackTopic);
      }
      if (cascade.kafkaTopic) {
        this.completedTopicToWorkflow.delete(cascade.kafkaTopic);
      }
    }

    // Remove variant entries
    for (const variantName of Object.keys(workflow.variants)) {
      if (this.variantToWorkflow.get(variantName) === name) {
        this.variantToWorkflow.delete(variantName);
      }
    }

    this.workflows.delete(name);
    this.disabledWorkflows.delete(name);

    this.logger.log(`Deregistered workflow '${name}'`);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lookup
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get WorkflowConfigService by workflow name.
   * @throws Error if workflow not found.
   */
  get(workflowName: string): WorkflowConfigService {
    const config = this.workflows.get(workflowName);
    if (!config) {
      throw new Error(
        `Workflow '${workflowName}' not found. Available: [${Array.from(this.workflows.keys()).join(', ')}]`,
      );
    }
    return config;
  }

  /**
   * Get WorkflowConfigService by workflow name, or undefined if not found.
   */
  getOrUndefined(workflowName: string): WorkflowConfigService | undefined {
    return this.workflows.get(workflowName);
  }

  /**
   * Check if a workflow is registered.
   */
  has(workflowName: string): boolean {
    return this.workflows.has(workflowName);
  }

  /**
   * Get all registered workflows.
   */
  getAll(): Map<string, WorkflowConfigService> {
    return new Map(this.workflows);
  }

  /**
   * Get the number of registered workflows.
   */
  get size(): number {
    return this.workflows.size;
  }

  /**
   * Get WorkflowConfigService and cascade name by ACK topic.
   * Used by the AcknowledgementHandler to resolve which workflow an ACK belongs to.
   */
  getByAckTopic(topic: string): { config: WorkflowConfigService; cascadeName: string } | undefined {
    const workflowName = this.ackTopicToWorkflow.get(topic);
    if (!workflowName) return undefined;

    const config = this.workflows.get(workflowName);
    if (!config) return undefined;

    // Find the cascade name for this ACK topic
    const cascade = config.getCascades().find((c) => c.ackTopic === topic);
    if (!cascade) return undefined;

    return { config, cascadeName: cascade.cascadeName };
  }

  /**
   * Resolve the default variant for a workflow.
   * Returns the variant name that has isDefault: true.
   */
  getDefaultVariant(workflowName: string): string | undefined {
    const config = this.get(workflowName);
    const workflow = config.getWorkflow();
    for (const [variantName, variant] of Object.entries(workflow.variants)) {
      if (variant.isDefault) return variantName;
    }
    return Object.keys(workflow.variants)[0]; // Fallback to first variant
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Enable/Disable
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Disable a workflow (reject new jobs, existing jobs continue).
   */
  disable(workflowName: string): boolean {
    if (!this.workflows.has(workflowName)) return false;
    this.disabledWorkflows.add(workflowName);
    this.logger.log(`Workflow '${workflowName}' disabled (new jobs rejected)`);
    return true;
  }

  /**
   * Enable a previously disabled workflow.
   */
  enable(workflowName: string): boolean {
    if (!this.workflows.has(workflowName)) return false;
    this.disabledWorkflows.delete(workflowName);
    this.logger.log(`Workflow '${workflowName}' enabled`);
    return true;
  }

  /**
   * Check if a workflow is enabled (accepts new jobs).
   */
  isEnabled(workflowName: string): boolean {
    return this.workflows.has(workflowName) && !this.disabledWorkflows.has(workflowName);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Aggregation (cross-workflow queries)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all unique SQS queue names across all registered workflows.
   * Used by the SQS poller to discover which queues to poll.
   */
  getAllQueueNames(): string[] {
    const queueNames = new Set<string>();
    for (const config of this.workflows.values()) {
      for (const name of config.getAllQueueNames()) {
        queueNames.add(name);
      }
    }
    return Array.from(queueNames);
  }

  /**
   * Get all ACK topics across all registered workflows.
   * Used by KafkaHandlersModule to subscribe dynamically.
   */
  getAllAckTopics(): string[] {
    return Array.from(this.ackTopicToWorkflow.keys());
  }

  /**
   * Get all completed topics across all registered workflows.
   */
  getAllCompletedTopics(): string[] {
    return Array.from(this.completedTopicToWorkflow.keys());
  }

  /**
   * Get a summary of all registered workflows for management endpoints.
   */
  getWorkflowSummaries(): Array<{
    name: string;
    description: string;
    enabled: boolean;
    variants: string[];
    cascadeCount: number;
    stepCount: number;
  }> {
    return Array.from(this.workflows.entries()).map(([name, config]) => {
      const workflow = config.getWorkflow();
      const totalSteps = Object.values(workflow.steps).reduce(
        (sum, steps) => sum + steps.length,
        0,
      );
      return {
        name,
        description: workflow.description,
        enabled: !this.disabledWorkflows.has(name),
        variants: Object.keys(workflow.variants),
        cascadeCount: workflow.cascades.length,
        stepCount: totalSteps,
      };
    });
  }
}
