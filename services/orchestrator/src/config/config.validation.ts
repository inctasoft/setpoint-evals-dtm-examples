/**
 * Configuration Validation Schema
 *
 * Validates environment variables at application startup using Joi.
 * This ensures all required configuration is present and valid before
 * the application starts, preventing runtime errors.
 *
 * The validation is context-aware:
 * - In EKS: Requires production-specific variables
 * - In Docker/Local: Allows development defaults
 */

import * as Joi from 'joi';

/**
 * Environment variable validation schema
 *
 * This schema is used by NestJS ConfigModule to validate
 * environment variables at startup.
 */
export const configValidationSchema = Joi.object({
  // ============================================
  // Environment & Runtime
  // ============================================
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),

  // ============================================
  // Server Configuration
  // ============================================
  PORT: Joi.number().port().default(3002),
  ORCHESTRATOR_PORT: Joi.number().port().default(3002),
  HOST: Joi.string().default('0.0.0.0'),

  // ============================================
  // Orchestrator Database Configuration
  // ============================================
  DTM_DB_HOST: Joi.string()
    .description('Database host (auto-detected based on runtime)')
    .optional(),
  DTM_DB_PORT: Joi.number()
    .port()
    .description('Database port for container/EKS')
    .default(5432),
  DTM_DB_PORT_HOST: Joi.number()
    .port()
    .description('Database port for local development')
    .default(5448),
  DTM_DB_USER: Joi.string().default('dtm_user'),
  DTM_DB_PASSWORD: Joi.string().description('Database password').default('your_password'),
  DTM_DB_NAME: Joi.string().default('dtm'),

  // ============================================
  // Kafka Configuration
  // ============================================
  KAFKA_BROKER: Joi.string()
    .description('Kafka broker address (auto-detected based on runtime)')
    .optional(),
  KAFKA_CONSUMER_GROUP_ID: Joi.string().default('dtm-service-group'),
  KAFKA_TOPIC_JOB_SUBMITTED: Joi.string().default('dtm.jobs.submitted'),
  PUBLISH_EVENTS_TO_KAFKA: Joi.string().valid('true', 'false').default('true'),

  // ============================================
  // AWS / LocalStack Configuration
  // ============================================
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().description('AWS access key (only for LocalStack)').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string()
    .description('AWS secret key (only for LocalStack)')
    .optional(),
  AWS_SQS_ENDPOINT: Joi.string().uri().description('SQS endpoint (LocalStack)').optional(),
  AWS_LAMBDA_ENDPOINT: Joi.string().uri().description('Lambda endpoint (LocalStack)').optional(),
  AWS_ACCOUNT_ID: Joi.string().description('AWS account ID').optional(),

  // ============================================
  // Orchestrator Callback URL
  // ============================================
  ORCHESTRATOR_CALLBACK_URL: Joi.string()
    .uri()
    .description('URL for Lambda workers to call back to orchestrator')
    .optional(),

  // ============================================
  // Feature Flags
  // ============================================
  ENABLE_REQUESTS_FOR_SIMULATED_DELAYS: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable simulated delays (MUST be false in production)'),

  ENABLE_DEV_ACK_SIMULATOR: Joi.string()
    .valid('true', 'false')
    .default('false')
    .description('Enable dev acknowledgement simulator (MUST be false in production)'),

  ENABLE_DEDUPLICATION: Joi.string()
    .valid('true', 'false')
    .default('true')
    .description('Enable job deduplication'),

  // ============================================
  // Logging
  // ============================================
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('debug'),

  // ============================================
  // Docker Compose
  // ============================================
  COMPOSE_PROJECT_NAME: Joi.string().default('dtm'),

  // ============================================
  // LocalStack Settings
  // ============================================
  LOCALSTACK_DEBUG: Joi.string().valid('0', '1').default('1'),
  LOCALSTACK_PERSISTENCE: Joi.string().valid('0', '1').default('0'),

  // ============================================
  // Queue Management
  // ============================================
  CLEANUP_UNUSED_QUEUES: Joi.string().valid('true', 'false').default('false'),

  // ============================================
  // Database Pool Settings
  // ============================================
  DB_POOL_SIZE: Joi.number().min(1).max(100).default(10),
  DB_LOGGING: Joi.string().valid('true', 'false').default('false'),

  // ============================================
  // Maintenance Task Configuration
  // ============================================
  MAINTENANCE_SCHEDULER_ENABLED: Joi.string().valid('true', 'false').default('true'),
  MAINTENANCE_AUTO_FIX_ENABLED: Joi.string().valid('true', 'false').default('true'),
  MAINTENANCE_ACK_TIMEOUT_MINUTES: Joi.number().min(1).default(30),
  MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES: Joi.number().min(1).default(30),
  MAINTENANCE_IN_PROGRESS_AUTO_FAIL_ENABLED: Joi.string().valid('true', 'false').default('true'),
  MAINTENANCE_WAITING_FOR_CHILDREN_TIMEOUT_MINUTES: Joi.number().min(1).default(15),
  MAINTENANCE_DELEGATED_TIMEOUT_MINUTES: Joi.number().min(1).default(10),
  MAINTENANCE_PENDING_TIMEOUT_MINUTES: Joi.number().min(1).default(5),
  MAINTENANCE_JOB_RETENTION_DAYS: Joi.number().min(1).default(30),
  MAINTENANCE_CLEANUP_BATCH_SIZE: Joi.number().min(1).default(100),
})
  // Custom validation rules
  .custom((value, helpers) => {
    // Production safety checks
    if (value.NODE_ENV === 'production') {
      // Simulated delays must be disabled in production
      if (value.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS === 'true') {
        return helpers.error('custom.productionSimulatedDelays');
      }
      // Dev ACK simulator must be disabled in production
      if (value.ENABLE_DEV_ACK_SIMULATOR === 'true') {
        return helpers.error('custom.productionDevAckSimulator');
      }
    }
    return value;
  })
  .messages({
    'custom.productionSimulatedDelays':
      'ENABLE_REQUESTS_FOR_SIMULATED_DELAYS must be "false" in production',
    'custom.productionDevAckSimulator': 'ENABLE_DEV_ACK_SIMULATOR must be "false" in production',
  });

/**
 * Validation options for ConfigModule
 */
export const configValidationOptions = {
  // Don't abort on first error - collect all errors
  abortEarly: false,
  // Allow unknown environment variables (e.g., system vars)
  allowUnknown: true,
  // Strip unknown variables from the config object
  stripUnknown: false,
};

export default configValidationSchema;
