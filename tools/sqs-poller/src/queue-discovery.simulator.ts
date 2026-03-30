/**
 * Dynamic Queue Discovery (Simulator Mode)
 *
 * Instead of hardcoded workflow imports, discovers queues from workflow configs
 * loaded dynamically via the WORKFLOW_CONFIG_PATHS environment variable.
 *
 * This enables the SQS poller to work with any workflow config mounted at runtime.
 */

interface WorkflowStep {
  queueName?: string;
  step?: string;
}

interface WorkflowConfig {
  name: string;
  steps: Record<string, WorkflowStep[]>;
}

/**
 * Extract all unique queue names from dynamically loaded workflow configs.
 */
export function discoverQueuesFromWorkflows(): string[] {
  const configPaths = (process.env.WORKFLOW_CONFIG_PATHS || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  if (configPaths.length === 0) {
    console.error('[Queue Discovery] WORKFLOW_CONFIG_PATHS is not set');
    return [];
  }

  const queueNames = new Set<string>();
  const loadedWorkflows: { name: string; queueCount: number }[] = [];

  for (const configPath of configPaths) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(configPath);

      // Handle various export shapes
      const workflow: WorkflowConfig =
        mod.default ||
        Object.values(mod).find(
          (v: any) => v && typeof v === 'object' && v.name && v.steps,
        ) ||
        mod;

      if (!workflow?.name || !workflow?.steps) {
        console.warn(`[Queue Discovery] Config at ${configPath} has no name/steps — skipping`);
        continue;
      }

      const workflowQueues = new Set<string>();
      for (const variant of Object.keys(workflow.steps)) {
        for (const step of workflow.steps[variant]) {
          if (step.queueName) {
            queueNames.add(step.queueName);
            workflowQueues.add(step.queueName);
          }
        }
      }

      loadedWorkflows.push({ name: workflow.name, queueCount: workflowQueues.size });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Queue Discovery] Failed to load ${configPath}: ${message}`);
    }
  }

  const queues = Array.from(queueNames).sort();

  console.log(
    `[Queue Discovery] Discovered ${queues.length} unique queue(s) from ${loadedWorkflows.length} workflow(s):`,
  );
  for (const wf of loadedWorkflows) {
    console.log(`  ${wf.name}: ${wf.queueCount} queue(s)`);
  }

  return queues;
}
