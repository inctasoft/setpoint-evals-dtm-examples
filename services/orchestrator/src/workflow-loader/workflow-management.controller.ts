import {
  Controller,
  Get,
  Post,
  Logger,
  Param,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { WorkflowRegistryService } from './workflow-registry.service';

/**
 * Workflow Management Controller
 *
 * Provides administrative endpoints for managing workflow lifecycle:
 * - List all registered workflows with status
 * - Get detailed info about a specific workflow
 * - Enable/disable workflows (controls new job acceptance)
 *
 * These endpoints do NOT modify workflow definitions at runtime.
 * Workflows are loaded from the filesystem at boot time.
 * Enable/disable only controls whether new jobs are accepted.
 */
@ApiTags('workflow-management')
@Controller('workflows')
export class WorkflowManagementController {
  private readonly logger = new Logger(WorkflowManagementController.name);

  constructor(private readonly workflowRegistry: WorkflowRegistryService) {}

  /**
   * List all registered workflows
   * GET /api/v1/workflows
   */
  @Get()
  @ApiOperation({
    summary: 'List all registered workflows',
    description:
      'Returns a summary of all registered workflows including their status, ' +
      'variants, entity count, and step count.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of registered workflows',
    schema: {
      example: {
        workflows: [
          {
            name: 'order-processing',
            description: 'E-commerce order processing pipeline',
            enabled: true,
            variants: ['default', 'quick-order'],
            cascadeCount: 6,
            stepCount: 12,
          },
          {
            name: 'iot-sensor-pipeline',
            description: 'IoT data ingestion and processing',
            enabled: true,
            variants: ['default'],
            cascadeCount: 3,
            stepCount: 6,
          },
        ],
        total: 2,
      },
    },
  })
  listWorkflows() {
    const summaries = this.workflowRegistry.getWorkflowSummaries();
    this.logger.log(`Listing ${summaries.length} registered workflow(s)`);

    return {
      workflows: summaries,
      total: summaries.length,
    };
  }

  /**
   * Get detailed info about a specific workflow
   * GET /api/v1/workflows/:workflowName
   */
  @Get(':workflowName')
  @ApiOperation({
    summary: 'Get workflow details',
    description:
      'Returns detailed information about a specific workflow including its variants, ' +
      'step definitions, cascade configurations, and outcome rules.',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the workflow to inspect',
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow details',
  })
  @ApiResponse({
    status: 404,
    description: 'Workflow not found',
  })
  getWorkflowDetails(@Param('workflowName') workflowName: string) {
    if (!this.workflowRegistry.has(workflowName)) {
      throw new NotFoundException(`Workflow '${workflowName}' not found`);
    }

    const config = this.workflowRegistry.get(workflowName);
    const workflow = config.getWorkflow();
    const enabled = this.workflowRegistry.isEnabled(workflowName);
    const defaultVariant = this.workflowRegistry.getDefaultVariant(workflowName);

    // Build variant details
    const variants = Object.entries(workflow.variants).map(([name, variant]) => ({
      name,
      isDefault: variant.isDefault || false,
      description: variant.description || '',
    }));

    // Build step summary per variant
    const stepsByVariant: Record<
      string,
      Array<{
        step: string;
        description: string;
        dependencies: string[];
        requiresAcknowledgement: boolean;
        isChildStep: boolean;
        isFanOutStep: boolean;
      }>
    > = {};

    for (const variantName of Object.keys(workflow.variants)) {
      const steps = config.getStepDefinitions(variantName);
      stepsByVariant[variantName] = steps.map((s) => ({
        step: s.step,
        description: s.description || '',
        dependencies: s.dependencies || [],
        requiresAcknowledgement: s.requiresAcknowledgement || false,
        isChildStep: s.isChildStep || false,
        isFanOutStep: !!s.fanOut,
      }));
    }

    // Build cascade summary
    const cascades = workflow.cascades.map((c) => ({
      cascadeName: c.cascadeName,
      outputStep: c.outputStep,
      inputStep: c.inputStep,
      kafkaTopic: c.kafkaTopic,
      ackTopic: c.ackTopic || null,
      dependsOn: c.dependsOn || [],
      hasFkExtractor: !!c.fkExtractor,
    }));

    // Build outcome rules summary
    const outcomeRules = workflow.outcomeRules.map((r) => ({
      id: r.id,
      description: r.description,
      priority: r.priority,
    }));

    this.logger.log(`Returning details for workflow '${workflowName}'`);

    return {
      name: workflowName,
      description: workflow.description,
      enabled,
      defaultVariant,
      variants,
      stepsByVariant,
      cascades,
      outcomeRules,
      featureFlags: workflow.featureFlags || {},
    };
  }

  /**
   * Enable a workflow (accept new jobs)
   * POST /api/v1/workflows/:workflowName/enable
   */
  @Post(':workflowName/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enable a workflow',
    description:
      'Enables a previously disabled workflow so it can accept new jobs again. ' +
      'Existing in-flight jobs are not affected by enable/disable.',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the workflow to enable',
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiResponse({ status: 200, description: 'Workflow enabled successfully' })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  enableWorkflow(@Param('workflowName') workflowName: string) {
    if (!this.workflowRegistry.has(workflowName)) {
      throw new NotFoundException(`Workflow '${workflowName}' not found`);
    }

    this.workflowRegistry.enable(workflowName);
    this.logger.log(`Workflow '${workflowName}' enabled`);

    return {
      name: workflowName,
      enabled: true,
      message: `Workflow '${workflowName}' is now enabled and accepting new jobs.`,
    };
  }

  /**
   * Disable a workflow (reject new jobs, existing jobs continue)
   * POST /api/v1/workflows/:workflowName/disable
   */
  @Post(':workflowName/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable a workflow',
    description:
      'Disables a workflow so it stops accepting new jobs. ' +
      'Existing in-flight jobs will continue to be processed normally. ' +
      'This is useful for maintenance or gradual decommissioning.',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the workflow to disable',
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiResponse({ status: 200, description: 'Workflow disabled successfully' })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  disableWorkflow(@Param('workflowName') workflowName: string) {
    if (!this.workflowRegistry.has(workflowName)) {
      throw new NotFoundException(`Workflow '${workflowName}' not found`);
    }

    this.workflowRegistry.disable(workflowName);
    this.logger.log(`Workflow '${workflowName}' disabled`);

    return {
      name: workflowName,
      enabled: false,
      message: `Workflow '${workflowName}' is now disabled. Existing jobs continue, but new jobs are rejected.`,
    };
  }
}
