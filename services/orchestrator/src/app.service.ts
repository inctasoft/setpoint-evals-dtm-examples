import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CallbackService } from './callback/callback.service';
import { KafkaService } from './kafka/kafka.service';

export interface HealthCheckResult {
  status: 'UP' | 'DOWN' | 'DEGRADED';
  timestamp: string;
  uptime: number;
  checks: {
    database: {
      status: 'UP' | 'DOWN';
      responseTime?: number;
      error?: string;
    };
    kafka: {
      status: 'UP' | 'DOWN' | 'UNKNOWN';
      responseTime?: number;
      error?: string;
    };
    callback: {
      status: 'UP' | 'DOWN';
      responseTime?: number;
      error?: string;
    };
  };
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly startTime = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly callbackService: CallbackService,
    private readonly kafkaService: KafkaService,
  ) {}

  getHello(): string {
    return 'DTM - Distributed Task Manager - Orchestrator API';
  }

  async getHealth(): Promise<HealthCheckResult> {
    this.logger.debug('Running comprehensive health check');

    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkKafka(),
      this.checkCallbackService(),
    ]);

    const [database, kafka, callback] = checks;

    // Determine overall status
    let overallStatus: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';
    if (database.status === 'DOWN' || callback.status === 'DOWN') {
      overallStatus = 'DOWN';
    } else if (kafka.status === 'DOWN') {
      overallStatus = 'DEGRADED'; // Can operate without Kafka
    }

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      checks: {
        database,
        kafka,
        callback,
      },
    };

    this.logger.debug(`Health check complete: ${overallStatus}`);
    return result;
  }

  private async checkDatabase(): Promise<{
    status: 'UP' | 'DOWN';
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      // Simple query to check database connectivity
      await this.dataSource.query('SELECT 1');
      const responseTime = Date.now() - startTime;

      this.logger.debug(`Database health check: UP (${responseTime}ms)`);
      return {
        status: 'UP',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Database health check failed: ${errorMessage}`);

      return {
        status: 'DOWN',
        responseTime,
        error: errorMessage,
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async checkKafka(): Promise<{
    status: 'UP' | 'DOWN' | 'UNKNOWN';
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      // Use KafkaService to check Kafka health
      const isConnected = this.kafkaService.isConnected();
      const responseTime = Date.now() - startTime;

      if (isConnected) {
        this.logger.debug(`Kafka health check: UP (${responseTime}ms)`);
        return {
          status: 'UP',
          responseTime,
        };
      } else {
        this.logger.warn('Kafka health check: DOWN (not connected)');
        return {
          status: 'DOWN',
          responseTime,
          error: 'Kafka not connected',
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Kafka health check failed: ${errorMessage}`);

      return {
        status: 'DOWN',
        responseTime,
        error: errorMessage,
      };
    }
  }

  private async checkCallbackService(): Promise<{
    status: 'UP' | 'DOWN';
    responseTime?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      // Call the callback service health check (internal)
      // Since it's internal, we just check if the service is instantiated
      // and can execute a simple operation
      await this.callbackService.listRecentJobs(1);
      const responseTime = Date.now() - startTime;

      this.logger.debug(`Callback service health check: UP (${responseTime}ms)`);
      return {
        status: 'UP',
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Callback service health check failed: ${errorMessage}`);

      return {
        status: 'DOWN',
        responseTime,
        error: errorMessage,
      };
    }
  }
}
