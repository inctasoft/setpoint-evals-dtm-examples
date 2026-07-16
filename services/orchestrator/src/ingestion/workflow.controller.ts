import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import {
  InitiateWorkflowJobDto,
  InitiateWorkflowJobResponseDto,
} from './dto/initiate-workflow-job.dto';
import { WorkflowJobService } from './workflow-job.service';

/**
 * Generic Workflow Controller
 *
 * Thin HTTP wrapper over {@link WorkflowJobService} — provides a
 * workflow-agnostic endpoint for submitting jobs to any registered workflow.
 * The workflow is identified by name in the URL path, and the request body
 * provides the entity identifier, optional variant, payload, and test
 * options. All the actual logic (validation, dedup, job creation,
 * orchestration start) lives in the service so it can be reused by non-HTTP
 * callers (e.g. the Setpoint Evals "run" endpoint) with zero drift.
 *
 * This endpoint works for ALL registered workflows without any workflow-specific logic.
 */
@ApiTags('workflows')
@Controller('workflows')
export class WorkflowController {
  constructor(private readonly workflowJobService: WorkflowJobService) {}

  /**
   * Initiate a job for any registered workflow
   * POST /api/v1/workflows/:workflowName/jobs
   */
  @Post(':workflowName/jobs')
  @ApiOperation({
    summary: 'Initiate a workflow job (Generic Endpoint)',
    description:
      'Start a new job for any registered workflow. The workflow is identified by name in the URL path.\n\n' +
      '**Supported Workflows:**\n' +
      '- `order-processing` — E-commerce order processing pipeline\n' +
      '- `iot-sensor-pipeline` — IoT data ingestion and processing\n' +
      '- `infra-provisioning` — Infrastructure provisioning with long-running ACKs\n\n' +
      '**Variants:** Each workflow defines variants (different step DAGs). ' +
      'If `variant` is omitted, the workflow default is used.\n\n' +
      '**Example Request:**\n' +
      '```json\n' +
      '{\n' +
      '  "variant": "default",\n' +
      '  "payload": { "customerId": 1, "orderId": 1 },\n' +
      '  "testOptions": {\n' +
      '    "ValidateCustomer": { "simDelay": 300 }\n' +
      '  }\n' +
      '}\n' +
      '```',
  })
  @ApiParam({
    name: 'workflowName',
    required: true,
    description: 'Name of the registered workflow to submit a job for.',
    schema: {
      type: 'string',
      example: 'order-processing',
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Workflow job initiated successfully',
    type: InitiateWorkflowJobResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - validation failed or invalid variant',
  })
  @ApiResponse({
    status: 404,
    description: 'Workflow not found in registry',
  })
  @ApiResponse({
    status: 403,
    description: 'Workflow is disabled (not accepting new jobs)',
  })
  @ApiResponse({
    status: 409,
    description: 'Duplicate job detected',
  })
  async initiateWorkflowJob(
    @Param('workflowName') workflowName: string,
    @Body() dto: InitiateWorkflowJobDto,
  ): Promise<InitiateWorkflowJobResponseDto> {
    return this.workflowJobService.initiateWorkflowJob(workflowName, dto);
  }
}
