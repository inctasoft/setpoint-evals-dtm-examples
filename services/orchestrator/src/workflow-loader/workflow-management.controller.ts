import {
  Controller,
  Get,
  Post,
  Logger,
  Param,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { StepRepository } from '@dtm/database';
import { WorkflowRegistryService } from './workflow-registry.service';
import { FeatureFlagService } from './feature-flag.service';

/** Cross-job step history — server-side cap regardless of what the caller requests
 * (dtm-video-v2 capability-spec.md §2e-5: no supporting index leading with step_value,
 * fine at demo scale, don't pre-optimize, but don't let a caller ask for an unbounded
 * scan either). */
const STEP_HISTORY_DEFAULT_LIMIT = 20;
const STEP_HISTORY_MAX_LIMIT = 50;

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

  constructor(
    private readonly workflowRegistry: WorkflowRegistryService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly stepRepo: StepRepository,
  ) {}

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
   * Get resolved feature flags for a workflow (Monitor "Flags" tab)
   * GET /api/v1/workflows/:workflowName/flags
   *
   * Layer 1+2 only (workflow defaults + env overrides) — layer 3 (per-request
   * client overrides) is deliberately NOT exercised here since there is no
   * request to override; this endpoint reports the flags any NEW job on this
   * workflow would resolve to right now.
   */
  @Get(':workflowName/flags')
  @ApiOperation({
    summary: 'Get resolved feature flags for a workflow',
    description:
      "Returns the workflow's feature flags after three-layer resolution (config defaults, " +
      'then env var overrides — no per-request overrides apply here, there is no request).',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the workflow to inspect',
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiResponse({ status: 200, description: 'Resolved feature flags' })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  getWorkflowFlags(@Param('workflowName') workflowName: string) {
    if (!this.workflowRegistry.has(workflowName)) {
      throw new NotFoundException(`Workflow '${workflowName}' not found`);
    }

    const config = this.workflowRegistry.get(workflowName);
    const workflow = config.getWorkflow();
    const flags = this.featureFlagService.resolveFlags(workflow);
    const clientOverridable = workflow.featureFlags?.clientOverridable ?? [];

    return {
      workflow: workflowName,
      flags,
      clientOverridable,
      requestOverridesEnabled: process.env.ENABLE_REQUEST_FEATURE_FLAGS === 'true',
    };
  }

  /**
   * Cross-job history for one step within one workflow (Monitor drill-down drawer's
   * "recent runs of this step" sparkline/table)
   * GET /api/v1/workflows/:workflowName/steps/:stepName/history?limit=N
   *
   * dtm-video-v2 capability-spec.md §3.2b. Only "primary" (non-fan-out-child) rows —
   * see StepRepository.findCrossJobHistory / findPrimaryByJobIdAndStepValue for why.
   * A registered workflow with zero matching rows returns 200 + [], never 404 — only
   * an UNREGISTERED workflow name 404s (same convention as the sibling endpoints on
   * this controller).
   */
  @Get(':workflowName/steps/:stepName/history')
  @ApiOperation({
    summary: 'Get cross-job history for a step',
    description:
      'Recent runs of one step across jobs on this workflow, most-recent-first — ' +
      "powers the DAG drill-down drawer's cross-job strip. A registered workflow " +
      'with no matching runs returns an empty array, not a 404.',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the workflow',
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiParam({
    name: 'stepName',
    required: true,
    description: 'Step name (dtm_steps.step_value)',
    schema: { type: 'string', example: 'ValidateCustomer' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Max rows to return (default ${STEP_HISTORY_DEFAULT_LIMIT}, capped at ${STEP_HISTORY_MAX_LIMIT})`,
    schema: { type: 'integer', example: 20 },
  })
  @ApiResponse({ status: 200, description: 'Cross-job step history (most-recent-first)' })
  @ApiResponse({ status: 404, description: 'Workflow not registered' })
  async getStepHistory(
    @Param('workflowName') workflowName: string,
    @Param('stepName') stepName: string,
    @Query('limit') limitParam?: string,
  ) {
    if (!this.workflowRegistry.has(workflowName)) {
      throw new NotFoundException(`Workflow '${workflowName}' not found`);
    }

    let limit = STEP_HISTORY_DEFAULT_LIMIT;
    if (limitParam !== undefined) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
    }
    limit = Math.min(limit, STEP_HISTORY_MAX_LIMIT);

    const rows = await this.stepRepo.findCrossJobHistory(workflowName, stepName, limit);

    this.logger.log(
      `Cross-job history for ${workflowName}/${stepName}: ${rows.length} row(s) (limit=${limit})`,
    );

    return rows.map((step) => ({
      jobId: step.job.id,
      jobStatus: step.job.status,
      stepStatus: step.status,
      durationMs: step.durationMs ?? null,
      retryCount: step.retryCount,
      attempts: step.executionHistory ?? [],
      error: step.error ?? null,
      completedAt: step.completedAt ?? null,
    }));
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
