/**
 * Queue Discovery — zmq-worker-host
 *
 * One host container serves ONE workflow (WORKFLOW_NAME env, compose-scaled
 * for replicas). This module resolves that workflow's registered config and
 * extracts the queue names its steps declare — the same source of truth the
 * sqs-poller's discoverQueuesFromWorkflows() aggregates across all workflows.
 */

import type { WorkflowDefinition } from "@dtm/core";

import { orderProcessingWorkflow } from "@dtm-workflows/order-processing";
import { iotSensorPipelineWorkflow } from "@dtm-workflows/iot-sensor-pipeline";
import { infraProvisioningWorkflow } from "@dtm-workflows/infra-provisioning";

/**
 * Registry of workflow definitions a host can serve.
 * Add new workflows here as they are created (mirrors the sqs-poller).
 */
const WORKFLOW_CONFIGS: Record<string, WorkflowDefinition> = {
  "order-processing": orderProcessingWorkflow,
  "iot-sensor-pipeline": iotSensorPipelineWorkflow,
  "infra-provisioning": infraProvisioningWorkflow,
};

/**
 * Resolve a workflow definition by name. Throws on an unknown name — a host
 * started for a workflow it cannot serve must fail fast at boot, not idle.
 */
export function getWorkflowConfig(workflowName: string): WorkflowDefinition {
  const config = WORKFLOW_CONFIGS[workflowName];
  if (!config) {
    throw new Error(
      `Unknown WORKFLOW_NAME '${workflowName}'. Registered: ${Object.keys(WORKFLOW_CONFIGS).sort().join(", ")}`,
    );
  }
  return config;
}

/**
 * Extract the unique queue names declared by one workflow's steps
 * (all variants), sorted.
 */
export function discoverQueuesForWorkflow(workflowName: string): string[] {
  const workflow = getWorkflowConfig(workflowName);
  const queueNames = new Set<string>();

  for (const variant of Object.keys(workflow.steps)) {
    for (const step of workflow.steps[variant]) {
      if (step.queueName) {
        queueNames.add(step.queueName);
      }
    }
  }

  const queues = Array.from(queueNames).sort();
  console.log(
    `[Queue Discovery] ${workflowName}: ${queues.length} queue(s) from workflow config`,
  );
  return queues;
}
