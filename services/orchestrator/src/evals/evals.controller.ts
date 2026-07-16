import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EvalsDiscoveryService } from './evals-discovery.service';
import { EvalsRunService } from './evals-run.service';
import type { EvalSummary } from './evals.types';

/**
 * Setpoint Evals discovery + run API — backs the monitor's "Scenarios" screen.
 * Discovery is filesystem-live (no bundled manifest, ever); run re-issues the
 * SERVER-parsed README Payload via the generic workflow job API — no
 * client-supplied fields pass through (see EvalsRunService).
 */
@ApiTags('evals')
@Controller('evals')
export class EvalsController {
  constructor(
    private readonly discovery: EvalsDiscoveryService,
    private readonly runService: EvalsRunService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Discover all Setpoint Evals across all four suites',
    description:
      'Scans setpoint-evals/SE-* (core) and workflows/*/setpoint-evals/SE-* (order-processing, ' +
      'iot-sensor-pipeline, infra-provisioning) live from the filesystem. Never bundled/cached to a manifest file.',
  })
  @ApiResponse({ status: 200, description: 'All discovered evals' })
  list(): EvalSummary[] {
    return this.discovery.listEvals();
  }

  @Get(':suite/:id')
  @ApiOperation({ summary: 'Get one eval with its full README' })
  @ApiParam({ name: 'suite', example: 'order-processing' })
  @ApiParam({ name: 'id', example: 'SE-01-happy-path' })
  @ApiResponse({ status: 200, description: 'The eval' })
  @ApiResponse({ status: 404, description: 'Eval not found' })
  getOne(@Param('suite') suite: string, @Param('id') id: string): EvalSummary {
    const evalItem = this.discovery.getEval(suite, id);
    if (!evalItem) {
      throw new NotFoundException(`Eval '${suite}/${id}' not found`);
    }
    return evalItem;
  }

  @Post(':suite/:id/run')
  @ApiOperation({
    summary: 'Re-issue the eval’s server-parsed README Payload as a real job',
    description:
      'Dev-only (ENABLE_EVAL_RUN_API=false to disable). POSTs the README’s own committed ' +
      '"## Payload" JSON block to the generic workflow job API — takes NO request body; nothing ' +
      'client-supplied passes through.',
  })
  @ApiParam({ name: 'suite', example: 'order-processing' })
  @ApiParam({ name: 'id', example: 'SE-01-happy-path' })
  @ApiResponse({ status: 201, description: 'Job created' })
  @ApiResponse({ status: 403, description: 'Run API disabled' })
  @ApiResponse({ status: 404, description: 'Eval not found' })
  @ApiResponse({ status: 422, description: 'Eval has no runnable / malformed Payload' })
  run(@Param('suite') suite: string, @Param('id') id: string): Promise<{ jobId: string }> {
    return this.runService.run(suite, id);
  }
}
