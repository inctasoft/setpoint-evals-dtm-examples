/**
 * App Simulator Module
 *
 * Dynamic workflow loading variant of AppModule for the orchestrator simulator.
 * Instead of hardcoding workflow imports, this module loads workflow configs
 * dynamically from the WORKFLOW_CONFIG_PATHS environment variable.
 *
 * This enables the orchestrator to run as a standalone simulator that accepts
 * any workflow config mounted at runtime — no recompilation needed.
 *
 * Usage:
 *   WORKFLOW_CONFIG_PATHS=/workflows/order-processing/workflow.config.js,/workflows/iot-sensor-pipeline/workflow.config.js
 */
import { MiddlewareConsumer, Module, RequestMethod, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { KafkaModule } from './kafka/kafka.module';
import { KafkaHandlersModule } from './kafka/kafka-handlers.module';
import { AwsModule } from './aws/aws.module';
import { DelegationModule } from './delegation/delegation.module';
import { CallbackModule } from './callback/callback.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { JobsModule } from './jobs/jobs.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { CorrelationModule } from './common/correlation/correlation.module';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { WorkflowLoaderModule } from './workflow-loader';
import type { WorkflowDefinition } from '@dtm/core';

import {
  databaseConfig,
  kafkaConfig,
  awsConfig,
  appConfig,
  configValidationSchema,
  configValidationOptions,
  logRuntimeMode,
} from './config';

const logger = new Logger('SimulatorModule');

// ─── Dynamic Workflow Loading ────────────────────────────────────────────────
// Load workflow configs from WORKFLOW_CONFIG_PATHS env var (comma-separated paths)
// Each path should point to a compiled .js file that exports a WorkflowDefinition.

function loadWorkflowsFromEnv(): WorkflowDefinition[] {
  const configPaths = (process.env.WORKFLOW_CONFIG_PATHS || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (configPaths.length === 0) {
    logger.error(
      'WORKFLOW_CONFIG_PATHS is not set. The simulator requires at least one workflow config path.',
    );
    throw new Error('WORKFLOW_CONFIG_PATHS is required in simulator mode');
  }

  const workflows: WorkflowDefinition[] = [];

  for (const configPath of configPaths) {
    try {
      // Dynamic require by runtime path is intentional — simulator mode resolves
      // workflow configs from WORKFLOW_CONFIG_PATHS at startup, shape unknown
      // until load.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(configPath);

      // Handle various export shapes:
      // - default export: mod.default
      // - named export: first value that looks like a WorkflowDefinition
      // - direct module: mod itself has .name and .steps
      const workflow: WorkflowDefinition =
        mod.default ||
        Object.values(mod).find((v: any) => v && typeof v === 'object' && v.name && v.steps) ||
        mod;

      if (!workflow?.name || !workflow?.steps) {
        logger.warn(`Workflow config at ${configPath} does not have 'name' and 'steps' — skipping`);
        continue;
      }

      workflows.push(workflow);
      logger.log(`Loaded workflow: ${workflow.name} from ${configPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load workflow config from ${configPath}: ${message}`);
    }
  }

  if (workflows.length === 0) {
    throw new Error('No valid workflow configs loaded. Check WORKFLOW_CONFIG_PATHS.');
  }

  logger.log(
    `Simulator loaded ${workflows.length} workflow(s): [${workflows.map((w) => w.name).join(', ')}]`,
  );

  return workflows;
}

// Load workflows at module initialization time
const simulatorWorkflows = loadWorkflowsFromEnv();

logRuntimeMode();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [databaseConfig, kafkaConfig, awsConfig, appConfig],
      validationSchema: configValidationSchema,
      validationOptions: configValidationOptions,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('database.host');
        const port = configService.get<number>('database.port');
        console.log(`[TypeOrmConfig] Connecting to: ${host}:${port}`);
        return {
          type: 'postgres',
          host,
          port,
          username: configService.get<string>('database.username'),
          password: configService.get<string>('database.password'),
          database: configService.get<string>('database.database'),
          autoLoadEntities: true,
          synchronize: false,
          ssl: configService.get<boolean | object>('database.ssl'),
          extra: {
            max: configService.get<number>('database.poolSize'),
          },
          logging: configService.get<boolean>('database.logging'),
        };
      },
    }),
    // Dynamic workflow registration — loaded from WORKFLOW_CONFIG_PATHS
    WorkflowLoaderModule.forRoot(simulatorWorkflows),
    AwsModule,
    DelegationModule,
    CallbackModule,
    OrchestrationModule,
    KafkaModule,
    KafkaHandlersModule,
    IngestionModule,
    JobsModule,
    HealthModule,
    MaintenanceModule,
    CorrelationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppSimulatorModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
