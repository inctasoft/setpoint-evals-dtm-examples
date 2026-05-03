import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { KafkaHealthIndicator } from './kafka.health';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private kafkaHealth: KafkaHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe - Check if application is alive',
    description:
      'Simple liveness check. Returns 200 if app is running. Used by Kubernetes to restart unhealthy pods.',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
    schema: {
      example: {
        status: 'ok',
        info: {
          app: {
            status: 'up',
            message: 'DTM Orchestrator is running',
          },
        },
        details: {
          app: {
            status: 'up',
            message: 'DTM Orchestrator is running',
          },
        },
      },
    },
  })
  check() {
    // Simple liveness check - just confirm the app is running
    // No external dependency checks (DB, Kafka, etc.)
    return {
      status: 'ok',
      info: {
        app: {
          status: 'up',
          message: 'DTM Orchestrator is running',
        },
      },
      details: {
        app: {
          status: 'up',
          message: 'DTM Orchestrator is running',
        },
      },
    };
  }

  @Get('kafka')
  @ApiOperation({
    summary: 'Get Kafka topics information (debugging)',
    description:
      'Lists all DTM Kafka topics. ' +
      'Useful for debugging Kafka connectivity and topic configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of project Kafka topics with metadata',
    schema: {
      example: {
        broker: 'kafka:29092',
        topics: ['dtm.jobs.submitted'],
        details: [
          {
            name: 'dtm.jobs.submitted',
            partitions: 2,
            replicationFactor: 1,
            exists: true,
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Kafka unavailable',
  })
  async getKafkaTopics() {
    try {
      const topicsInfo = await this.kafkaHealth.getProjectTopics();
      return {
        broker: process.env.KAFKA_BROKER || 'kafka:29092',
        ...topicsInfo,
      };
    } catch (error) {
      // Return 503 when Kafka is unavailable
      throw new HttpException(
        {
          status: 'unavailable',
          message: error instanceof Error ? error.message : 'Kafka unavailable',
          broker: process.env.KAFKA_BROKER || 'kafka:29092',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe - Check if service can handle traffic',
    description:
      'Checks critical dependencies (database). Returns 503 if database is down. ' +
      'Kafka status is included but non-blocking (graceful degradation). ' +
      'Used by Kubernetes to determine if pod should receive traffic.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is ready to handle traffic',
    schema: {
      example: {
        status: 'ok',
        info: {
          database: { status: 'up' },
          kafka: { status: 'up', broker: 'kafka:29092', topics: { total: 8, project: {} } },
        },
        details: {
          database: { status: 'up' },
          kafka: { status: 'up', broker: 'kafka:29092' },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service not ready - database is down',
  })
  async readiness(): Promise<HealthCheckResult> {
    // Database is critical - if it fails, return 503
    const dbCheck = await this.health.check([() => this.db.pingCheck('database')]);

    // Kafka is optional - check it but don't fail readiness if it's down (graceful degradation)
    let kafkaCheck: HealthIndicatorResult | undefined;
    try {
      kafkaCheck = await this.kafkaHealth.isHealthy('kafka');
    } catch (error) {
      // Kafka is degraded but not critical for readiness - include it in the response
      kafkaCheck = {
        kafka: {
          status: 'down',
          message: error instanceof Error ? error.message : 'Kafka unavailable',
        },
      };
    }

    // Merge kafka check into the result structure
    // HealthCheckResult has: { status, info, error, details }
    // The database indicator is in details.database
    const dbStatus = dbCheck.details?.database?.status;
    const isHealthy = dbCheck.status === 'ok' && dbStatus === 'up';

    const result: HealthCheckResult = {
      ...dbCheck,
      info: {
        ...dbCheck.info,
        ...(kafkaCheck && typeof kafkaCheck === 'object' && 'kafka' in kafkaCheck
          ? { kafka: kafkaCheck.kafka }
          : {}),
      },
      details: {
        ...dbCheck.details,
        ...(kafkaCheck && typeof kafkaCheck === 'object' && 'kafka' in kafkaCheck
          ? { kafka: kafkaCheck.kafka }
          : {}),
      },
    };

    // Return 503 only if database is down (Kafka is non-blocking)
    if (!isHealthy) {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }
}
