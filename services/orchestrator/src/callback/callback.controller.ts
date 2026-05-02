import { Controller, Post, Get, Body, Param, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CallbackService } from './callback.service';
import { StepProgressDto, StepProgressResponseDto } from './dto/step-progress.dto';

/**
 * Callback Controller
 * Handles HTTP callbacks from Lambda workers
 */
@ApiTags('callback')
@Controller('callback')
export class CallbackController {
  private readonly logger = new Logger(CallbackController.name);

  constructor(private readonly callbackService: CallbackService) {}

  /**
   * Endpoint for Lambda workers to report step progress
   * Lambda sends POST requests to this endpoint with step status updates
   *
   * POST /api/callback/step-progress
   */
  @Post('step-progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report step progress from Lambda worker',
    description:
      'Lambda workers call this endpoint to report progress on workflow steps. ' +
      'The orchestrator updates the step and job status accordingly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Progress recorded successfully',
    type: StepProgressResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Job or step not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async handleStepProgress(@Body() dto: StepProgressDto): Promise<StepProgressResponseDto> {
    this.logger.log(
      `Received step progress callback: Job ${dto.jobId}, Step ${dto.stepId}, Status ${dto.status}`,
    );

    return this.callbackService.handleStepProgress(dto);
  }

  /**
   * Get job status with all steps
   * Useful for monitoring and debugging
   *
   * GET /api/callback/job/:jobId/status
   */
  @Get('job/:jobId/status')
  @ApiOperation({
    summary: 'Get job status with step details',
    description: 'Retrieve the current status of a workflow job and all its steps.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Job ID (UUID)',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Job status retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Job not found',
  })
  async getJobStatus(@Param('jobId') jobId: string) {
    this.logger.log(`Fetching status for job ${jobId}`);
    return this.callbackService.getJobStatus(jobId);
  }

  /**
   * List recent jobs
   * Returns a list of recent jobs with basic info
   *
   * GET /api/callback/jobs?limit=10
   */
  @Get('jobs')
  @ApiOperation({
    summary: 'List recent jobs',
    description:
      'Retrieve a list of recent jobs with their current status. Useful for monitoring dashboards.',
  })
  @ApiResponse({
    status: 200,
    description: 'Jobs list retrieved successfully',
  })
  async listJobs() {
    this.logger.log('Fetching recent jobs list');
    return this.callbackService.listRecentJobs(10);
  }

  /**
   * HTTP acknowledgement endpoint for steps in WAITING_FOR_ACK status.
   * Alternative to Kafka-based ACK — used by dynamic workflows (plan-execution)
   * where there are no cascade topics.
   *
   * POST /api/callback/acknowledge
   */
  @Post('acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acknowledge a step via HTTP',
    description:
      'Approve or reject a step that is in WAITING_FOR_ACK status. ' +
      'Used by dynamic workflows without Kafka cascade topics.',
  })
  @ApiResponse({ status: 200, description: 'Acknowledgement processed' })
  @ApiResponse({ status: 404, description: 'Step not found or not in WAITING_FOR_ACK' })
  async acknowledgeStep(
    @Body()
    body: {
      jobId: string;
      stepId: string;
      action: 'approve' | 'reject';
      metadata?: Record<string, unknown>;
    },
  ) {
    this.logger.log(`HTTP ACK: Job ${body.jobId}, Step ${body.stepId}, Action ${body.action}`);
    return this.callbackService.handleHttpAcknowledgement(body);
  }

  /**
   * Health check endpoint for callbacks
   * Can be used by Lambda to verify orchestrator is reachable
   *
   * GET /api/callback/health
   */
  @Get('health')
  @ApiOperation({
    summary: 'Health check for callback endpoint',
    description: 'Verify that the callback endpoint is reachable and operational.',
  })
  @ApiResponse({
    status: 200,
    description: 'Callback service is healthy',
  })
  healthCheck() {
    return {
      status: 'UP',
      service: 'callback',
      message: 'Callback service is operational',
      timestamp: new Date().toISOString(),
    };
  }
}
