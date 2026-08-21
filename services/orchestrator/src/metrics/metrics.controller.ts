import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { MetricsService, ThroughputResponse } from './metrics.service';

/**
 * Metrics Controller — backs the monitor's "Throughput" tab.
 */
@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('throughput')
  @ApiOperation({
    summary: 'Steps-completed-per-minute over a trailing window',
    description:
      'Aggregates dtm_steps.completed_at into minute buckets over the trailing windowMinutes ' +
      '(default 30, clamped 1..1440). Optionally scoped to one workflow.',
  })
  @ApiQuery({ name: 'windowMinutes', required: false, schema: { type: 'integer', example: 30 } })
  @ApiQuery({
    name: 'workflow',
    required: false,
    schema: { type: 'string', example: 'order-processing' },
  })
  @ApiResponse({ status: 200, description: 'Throughput buckets' })
  getThroughput(
    @Query('windowMinutes') windowMinutes?: string,
    @Query('workflow') workflow?: string,
  ): Promise<ThroughputResponse> {
    return this.metricsService.getThroughput(windowMinutes, workflow);
  }
}
