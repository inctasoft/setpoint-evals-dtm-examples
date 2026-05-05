import { Global, Module, DynamicModule, Logger } from '@nestjs/common';
import { WORKFLOW_DEFINITION } from './workflow-loader.constants';
import { WorkflowConfigService } from './workflow-config.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import { WorkflowManagementController } from './workflow-management.controller';
import { FeatureFlagService } from './feature-flag.service';
import type { WorkflowDefinition } from '@dtm/core';

// Default workflow (used when forRoot() is called without arguments).
// Wrapped in try-catch so the simulator Dockerfile doesn't need this package installed.
let orderProcessingWorkflow: WorkflowDefinition | undefined;
try {
  // Wrapped in try-catch so the simulator Dockerfile doesn't need this package installed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  orderProcessingWorkflow = require('@dtm-workflows/order-processing').orderProcessingWorkflow;
} catch {
  // Not available in simulator mode — workflows are passed explicitly via forRoot()
}

const logger = new Logger('WorkflowLoaderModule');

/**
 * WorkflowLoaderModule
 *
 * Global module that provides multi-workflow support:
 * - WorkflowRegistryService: Central registry holding all workflow configs
 * - WORKFLOW_DEFINITION token: The default workflow (backward compatibility)
 * - WorkflowConfigService: Wraps the default workflow (backward compatibility)
 * - FeatureFlagService: Three-layer feature flag resolution
 *
 * Usage:
 *   WorkflowLoaderModule.forRoot()                          // registers order-processing only (default)
 *   WorkflowLoaderModule.forRoot([wf1, wf2, wf3])          // registers multiple workflows
 *   WorkflowLoaderModule.forRoot([wf1], { default: 'wf1' })  // explicit default
 *
 * Services should inject WorkflowRegistryService for multi-workflow support.
 * Legacy code can still inject WorkflowConfigService (wraps default workflow).
 */
@Global()
@Module({})
export class WorkflowLoaderModule {
  /**
   * Register workflows with the orchestrator.
   *
   * @param workflows - Array of WorkflowDefinition objects to register.
   *   If empty or undefined, only the order-processing workflow is registered.
   * @param options - Optional configuration:
   *   - default: Name of the default workflow (for backward-compatible WORKFLOW_DEFINITION token).
   *     If not specified, uses the first workflow in the array.
   */
  static forRoot(workflows?: WorkflowDefinition[], options?: { default?: string }): DynamicModule {
    // Resolve the list of workflows to register
    if ((!workflows || workflows.length === 0) && !orderProcessingWorkflow) {
      throw new Error(
        'WorkflowLoaderModule.forRoot() called without workflows and @dtm-workflows/order-processing is not installed. ' +
          'In simulator mode, always pass workflows explicitly.',
      );
    }
    const workflowList = workflows && workflows.length > 0 ? workflows : [orderProcessingWorkflow!];

    // Determine the default workflow
    const defaultWorkflowName = options?.default || workflowList[0].name;
    const defaultWorkflow =
      workflowList.find((w) => w.name === defaultWorkflowName) || workflowList[0];

    logger.log(
      `Initializing with ${workflowList.length} workflow(s): [${workflowList.map((w) => w.name).join(', ')}]. ` +
        `Default: '${defaultWorkflow.name}'`,
    );

    return {
      module: WorkflowLoaderModule,
      global: true,
      controllers: [WorkflowManagementController],
      providers: [
        // Multi-workflow registry (registers all workflows)
        {
          provide: WorkflowRegistryService,
          useFactory: () => {
            const registry = new WorkflowRegistryService();
            for (const workflow of workflowList) {
              registry.register(workflow);
            }
            return registry;
          },
        },
        // Backward compatibility: WORKFLOW_DEFINITION token provides the default workflow
        {
          provide: WORKFLOW_DEFINITION,
          useValue: defaultWorkflow,
        },
        // Backward compatibility: WorkflowConfigService wraps the default workflow
        WorkflowConfigService,
        FeatureFlagService,
      ],
      exports: [
        WorkflowRegistryService,
        WORKFLOW_DEFINITION,
        WorkflowConfigService,
        FeatureFlagService,
      ],
    };
  }
}
