import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
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
import { WebSocketModule } from './websocket';
import { AuthModule } from './auth/auth.module';

// Import workflow definitions for multi-workflow registration
import { orderProcessingWorkflow } from '@dtm-workflows/order-processing';
import { iotSensorPipelineWorkflow } from '@dtm-workflows/iot-sensor-pipeline';
import { infraProvisioningWorkflow } from '@dtm-workflows/infra-provisioning';
import { planExecutionWorkflow } from '@dtm-workflows/plan-execution';

// Import typed configuration modules
import {
  databaseConfig,
  kafkaConfig,
  awsConfig,
  appConfig,
  evalsConfig,
  configValidationSchema,
  configValidationOptions,
  logRuntimeMode,
} from './config';
import { EvalsModule } from './evals/evals.module';

// Log runtime mode at module initialization
logRuntimeMode();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      // .env file should be in orchestrator directory (symlinked to monorepo root)
      // Run: ln -s ../../.env .env (from services/orchestrator/)
      load: [databaseConfig, kafkaConfig, awsConfig, appConfig, evalsConfig],
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
          // Connection pool settings
          extra: {
            max: configService.get<number>('database.poolSize'),
          },
          logging: configService.get<boolean>('database.logging'),
        };
      },
    }),
    WorkflowLoaderModule.forRoot([
      orderProcessingWorkflow,
      iotSensorPipelineWorkflow,
      infraProvisioningWorkflow,
      planExecutionWorkflow,
    ]),
    AwsModule,
    DelegationModule,
    CallbackModule,
    OrchestrationModule,
    KafkaModule,
    // Kafka Handlers (includes consumer)
    KafkaHandlersModule,
    IngestionModule,
    JobsModule,
    HealthModule,
    MaintenanceModule,
    CorrelationModule,
    WebSocketModule,
    AuthModule.forRoot(),
    EvalsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
