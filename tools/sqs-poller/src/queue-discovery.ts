/**
 * Dynamic Queue Discovery
 *
 * Scans all registered workflow configs and extracts unique SQS queue names.
 * This replaces the hardcoded QUEUES array in poller.ts.
 *
 * Each workflow config (e.g., order-processing, iot-sensor-pipeline, infra-provisioning) defines
 * steps with queueName fields. This module collects all unique queue names
 * across all workflows and variants.
 *
 * How it works:
 * 1. Import known workflow configs (registered at compile time)
 * 2. For each workflow, iterate all variants and steps
 * 3. Collect unique queueName values
 * 4. Return sorted array of queue names
 *
 * Adding a new workflow:
 * 1. Create the workflow config in workflows/<name>/workflow.config.ts
 * 2. Add the import and entry to WORKFLOW_CONFIGS below
 * 3. The poller will automatically discover and poll the new queues
 */

import type { WorkflowDefinition } from "@dtm/core";

// Import all workflow configs
// Each new workflow must be added here when it's created
import { orderProcessingWorkflow } from "@dtm-workflows/order-processing";
import { iotSensorPipelineWorkflow } from "@dtm-workflows/iot-sensor-pipeline";
import { infraProvisioningWorkflow } from "@dtm-workflows/infra-provisioning";

/**
 * Registry of all workflow definitions to scan for queue names.
 * Add new workflow imports here as they are created.
 */
const WORKFLOW_CONFIGS: WorkflowDefinition[] = [
  orderProcessingWorkflow,
  iotSensorPipelineWorkflow,
  infraProvisioningWorkflow,
];

/**
 * Extract all unique queue names from all registered workflow configs.
 * Iterates all variants and steps in each workflow.
 */
export function discoverQueuesFromWorkflows(): string[] {
  const queueNames = new Set<string>();

  for (const workflow of WORKFLOW_CONFIGS) {
    for (const variant of Object.keys(workflow.steps)) {
      for (const step of workflow.steps[variant]) {
        if (step.queueName) {
          queueNames.add(step.queueName);
        }
      }
    }
  }

  const queues = Array.from(queueNames).sort();

  console.log(
    `[Queue Discovery] Discovered ${queues.length} unique queue(s) from ${WORKFLOW_CONFIGS.length} workflow(s):`,
  );
  for (const workflow of WORKFLOW_CONFIGS) {
    const workflowQueues = new Set<string>();
    for (const variant of Object.keys(workflow.steps)) {
      for (const step of workflow.steps[variant]) {
        if (step.queueName) workflowQueues.add(step.queueName);
      }
    }
    console.log(
      `  ${workflow.name}: ${workflowQueues.size} queue(s)`,
    );
  }

  return queues;
}

/**
 * Get all workflow configs registered with the poller.
 * Useful for handler registry to discover which handlers to load.
 */
export function getRegisteredWorkflows(): WorkflowDefinition[] {
  return [...WORKFLOW_CONFIGS];
}
