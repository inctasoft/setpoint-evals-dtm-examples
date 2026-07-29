/**
 * Queue Discovery — zmq-worker-host
 *
 * One host container serves ONE workflow (WORKFLOW_NAME env, compose-scaled
 * for replicas). This module resolves that workflow's registered config and
 * extracts the queue names its steps declare — the same source of truth the
 * sqs-poller's discoverQueuesFromWorkflows() aggregates across all workflows.
 *
 * ISOLATION: each host container bind-mounts ONLY its own workflow's package
 * into /app/node_modules (see docker-compose.zmq.yml). Every workflow
 * resolution here is therefore a LAZY require inside the switch body — a
 * static import (or a static Map of name → import) would force every host to
 * resolve every workflow at load time and crash-loop the container.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: lazy
 * per-case require() is the isolation mechanism documented above. */

import type { WorkflowDefinition } from "@dtm/core";

/** Names a host can serve (error messages only — no module loading). */
const REGISTERED_WORKFLOW_NAMES = [
  "infra-provisioning",
  "iot-sensor-pipeline",
  "order-processing",
];

/**
 * Resolve a workflow definition by name, loading ONLY that workflow's
 * package. Throws on an unknown name — a host started for a workflow it
 * cannot serve must fail fast at boot, not idle.
 */
export function getWorkflowConfig(workflowName: string): WorkflowDefinition {
  switch (workflowName) {
    case "order-processing": {
      const {
        orderProcessingWorkflow,
      } = require("@dtm-workflows/order-processing");
      return orderProcessingWorkflow;
    }
    case "iot-sensor-pipeline": {
      const {
        iotSensorPipelineWorkflow,
      } = require("@dtm-workflows/iot-sensor-pipeline");
      return iotSensorPipelineWorkflow;
    }
    case "infra-provisioning": {
      const {
        infraProvisioningWorkflow,
      } = require("@dtm-workflows/infra-provisioning");
      return infraProvisioningWorkflow;
    }
    default:
      throw new Error(
        `Unknown WORKFLOW_NAME '${workflowName}'. Registered: ${REGISTERED_WORKFLOW_NAMES.join(", ")}`,
      );
  }
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
