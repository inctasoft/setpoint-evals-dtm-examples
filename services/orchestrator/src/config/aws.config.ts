/**
 * AWS Configuration Module
 *
 * Provides typed configuration for AWS services (SQS, Lambda, S3).
 * Automatically detects runtime mode and adjusts endpoints accordingly.
 *
 * In EKS: Uses real AWS endpoints with IAM roles
 * In Docker: Uses LocalStack with Docker service name
 * Locally: Uses LocalStack via localhost
 */

import { registerAs } from '@nestjs/config';
import { detectRuntime, getServiceEndpoint, getOrchestratorCallbackUrl } from './runtime.config';

/**
 * AWS Configuration
 */
export const awsConfig = registerAs('aws', () => {
  const runtime = detectRuntime();

  // In EKS, endpoint should be undefined to use real AWS
  // In Docker/Local, use LocalStack
  const sqsEndpoint = getServiceEndpoint(
    process.env.AWS_SQS_ENDPOINT,
    'http://localstack:4566', // Docker (internal container port)
    'http://localhost:4567', // Local (host-mapped port)
  );

  const lambdaEndpoint = getServiceEndpoint(
    process.env.AWS_LAMBDA_ENDPOINT,
    'http://localstack:4566', // Docker (internal container port)
    'http://localhost:4567', // Local (host-mapped port)
  );

  // Orchestrator callback URL for Lambda workers
  const orchestratorPort = parseInt(process.env.PORT || '3002', 10);
  const callbackUrl = getOrchestratorCallbackUrl(
    process.env.ORCHESTRATOR_CALLBACK_URL,
    orchestratorPort,
  );

  return {
    // AWS Region
    region: process.env.AWS_REGION || 'us-east-1',

    // Credentials - only used for LocalStack
    // In EKS, IAM roles are used instead
    credentials:
      runtime !== 'eks'
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
          }
        : undefined,

    // SQS Configuration
    sqs: {
      endpoint: sqsEndpoint,
      accountId: runtime === 'eks' ? process.env.AWS_ACCOUNT_ID : '000000000000', // LocalStack uses this
    },

    // Lambda Configuration
    lambda: {
      endpoint: lambdaEndpoint,
    },

    // Orchestrator callback URL for Lambda workers
    orchestratorCallbackUrl: callbackUrl,

    // LocalStack-specific settings
    localstack: {
      enabled: runtime !== 'eks',
      debug: process.env.LOCALSTACK_DEBUG === '1',
      persistence: process.env.LOCALSTACK_PERSISTENCE === '1',
    },

    // Queue cleanup settings
    cleanupUnusedQueues: process.env.CLEANUP_UNUSED_QUEUES === 'true',
  };
});

/**
 * AWS configuration type for TypeScript
 */
export interface AwsConfig {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  sqs: {
    endpoint: string | undefined;
    accountId: string | undefined;
  };
  lambda: {
    endpoint: string | undefined;
  };
  orchestratorCallbackUrl: string;
  localstack: {
    enabled: boolean;
    debug: boolean;
    persistence: boolean;
  };
  cleanupUnusedQueues: boolean;
}

export default awsConfig;
