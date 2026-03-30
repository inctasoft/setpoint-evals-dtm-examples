/**
 * Configuration Module Index
 *
 * Re-exports all configuration modules for easy importing.
 *
 * Usage in app.module.ts:
 * ```typescript
 * import { databaseConfig, kafkaConfig, awsConfig, appConfig } from './config';
 *
 * ConfigModule.forRoot({
 *   load: [databaseConfig, kafkaConfig, awsConfig, appConfig],
 *   ...
 * })
 * ```
 *
 * Usage in services:
 * ```typescript
 * import { ConfigService } from '@nestjs/config';
 * import { DatabaseConfig, KafkaConfig } from './config';
 *
 * constructor(private configService: ConfigService) {
 *   const dbHost = this.configService.get<string>('database.host');
 *   const kafkaBroker = this.configService.get<string>('kafka.broker');
 * }
 * ```
 */

// Runtime detection
export type { RuntimeMode } from './runtime.config';
export {
  detectRuntime,
  logRuntimeMode,
  getDatabaseHost,
  getDatabasePort,
  getServiceEndpoint,
  getKafkaBroker,
  getOrchestratorCallbackUrl,
} from './runtime.config';

// Configuration namespaces
export { databaseConfig } from './database.config';
export type { DatabaseConfig } from './database.config';

export { kafkaConfig } from './kafka.config';
export type { KafkaConfig } from './kafka.config';

export { awsConfig } from './aws.config';
export type { AwsConfig } from './aws.config';

export { appConfig } from './app.config';
export type { AppConfig } from './app.config';

// Validation
export { configValidationSchema, configValidationOptions } from './config.validation';
