/**
 * Application Configuration Module
 *
 * Provides typed configuration for general application settings,
 * feature flags, and development-only options.
 */

import { registerAs } from '@nestjs/config';
import { detectRuntime } from './runtime.config';

/**
 * Application Configuration
 */
export const appConfig = registerAs('app', () => {
  const runtime = detectRuntime();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production' || runtime === 'eks';

  return {
    // Environment
    nodeEnv,
    isProduction,
    runtime,

    // Server
    port: parseInt(process.env.PORT || process.env.ORCHESTRATOR_PORT || '3002', 10),
    host: process.env.HOST || '0.0.0.0',

    // Logging
    logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

    // Feature Flags
    features: {
      /**
       * Enable simulated delays in Lambda workers
       * SECURITY: Must be disabled in production
       */
      enableSimulatedDelays:
        process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS === 'true' && !isProduction,

      /**
       * Enable dev acknowledgement simulator
       * Only for development/testing - simulates external system ACKs
       */
      enableDevAckSimulator: process.env.ENABLE_DEV_ACK_SIMULATOR === 'true' && !isProduction,

      /**
       * Enable job deduplication
       * Recommended to be enabled in production
       */
      enableDeduplication: process.env.ENABLE_DEDUPLICATION === 'true',

      /**
       * Publish events to Kafka
       */
      publishEventsToKafka: process.env.PUBLISH_EVENTS_TO_KAFKA !== 'false',
    },

    // Compose project name (for Docker)
    composeProjectName: process.env.COMPOSE_PROJECT_NAME || 'dtm',
  };
});

/**
 * Application configuration type for TypeScript
 */
export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  runtime: 'eks' | 'docker' | 'local';
  port: number;
  host: string;
  logLevel: string;
  features: {
    enableSimulatedDelays: boolean;
    enableDevAckSimulator: boolean;
    enableDeduplication: boolean;
    publishEventsToKafka: boolean;
  };
  composeProjectName: string;
}

export default appConfig;
