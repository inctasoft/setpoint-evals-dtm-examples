import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { ApiInfoDto } from './app.dto';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Get API information',
    description: 'Returns basic API information and welcome message',
  })
  @ApiResponse({
    status: 200,
    description: 'API information',
    type: ApiInfoDto,
  })
  getInfo(): ApiInfoDto {
    return {
      message: 'Welcome to DTM Orchestrator API',
      version: '1.0',
      documentation: '/api-docs',
      dashboard: 'http://localhost:5173',
    };
  }

  // Health endpoints moved to HealthController (using NestJS Terminus)
  // See src/health/health.controller.ts for all health check endpoints:
  // - GET /api/v1/health - Overall health status
  // - GET /api/v1/health/ready - Readiness probe
  // - GET /api/v1/health/kafka - Kafka topics information
}
