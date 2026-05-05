import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { WorkflowConfigService } from '../workflow-loader';
import { detectRuntime } from '../config/runtime.config';

/**
 * Get the container's Docker bridge network IP.
 * This IP is accessible from both Docker containers (on the same network)
 * and from the host machine (via the Docker bridge interface).
 * Used as callback URL host so both Lambda containers and host-side pollers
 * can send callbacks to the orchestrator.
 */
function getDockerBridgeIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal && /^172\./.test(addr.address)) {
          return addr.address;
        }
      }
    }
  }
  return null;
}

/**
 * SQS Configuration Service
 * Maps workflow types to their corresponding SQS queue URLs
 *
 * Configuration (via typed config namespaces):
 * - aws.region              → AWS region
 * - aws.credentials.*       → AWS credentials (for LocalStack)
 * - aws.sqs.endpoint        → SQS endpoint (LocalStack or undefined for real AWS)
 * - aws.sqs.accountId       → AWS account ID
 * - aws.orchestratorCallbackUrl → Callback URL for Lambda workers
 */
@Injectable()
export class SqsConfig {
  constructor(
    private readonly configService: ConfigService,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  /**
   * Get AWS region for SQS
   */
  getRegion(): string {
    return this.configService.get<string>('aws.region') || 'us-east-1';
  }

  /**
   * Get AWS access key ID (for local development with LocalStack)
   * In production (EKS), IAM roles are used instead
   */
  getAccessKeyId(): string | undefined {
    return this.configService.get<string>('aws.credentials.accessKeyId');
  }

  /**
   * Get AWS secret access key (for local development with LocalStack)
   * In production (EKS), IAM roles are used instead
   */
  getSecretAccessKey(): string | undefined {
    return this.configService.get<string>('aws.credentials.secretAccessKey');
  }

  /**
   * Get SQS endpoint URL (for LocalStack testing)
   * Returns undefined for production to use real AWS
   */
  getEndpoint(): string | undefined {
    return this.configService.get<string>('aws.sqs.endpoint');
  }

  /**
   * Get orchestrator callback URL for Lambda workers
   *
   * This is runtime-aware and uses environment variables:
   * - Local mode: Uses localhost:PORT (for poller running on host)
   * - Docker mode: Uses ORCHESTRATOR_DOCKER_HOST:PORT (Lambda containers on same Docker network)
   * - EKS mode: Uses ORCHESTRATOR_CALLBACK_URL or K8s service URL
   *
   * Environment variables:
   * - PORT / ORCHESTRATOR_PORT: The port the orchestrator listens on (default: 3000 in Docker, 3002 locally)
   * - ORCHESTRATOR_DOCKER_HOST: Docker service name (default: dtm-orchestrator)
   * - ORCHESTRATOR_CALLBACK_URL: Full callback URL override (used in EKS)
   */
  getCallbackUrl(): string {
    const runtime = detectRuntime();

    // Explicit env override: only for local/EKS — Docker mode always uses Docker DNS
    // (ORCHESTRATOR_CALLBACK_URL=localhost:X is set in .env for local dev but breaks Docker Lambda containers)
    const envOverride = process.env.ORCHESTRATOR_CALLBACK_URL;
    if (envOverride && runtime !== 'docker') {
      return envOverride;
    }
    const port = parseInt(process.env.PORT || process.env.ORCHESTRATOR_PORT || '3000', 10);
    // ORCHESTRATOR_CALLBACK_HOST env var allows explicit override.
    // Otherwise auto-detect Docker bridge IP (accessible from both Docker containers and host).
    const dockerHost =
      process.env.ORCHESTRATOR_CALLBACK_HOST ||
      getDockerBridgeIp() ||
      process.env.ORCHESTRATOR_DOCKER_HOST ||
      'dtm-orchestrator';

    switch (runtime) {
      case 'local': {
        // In local/debug mode, the poller runs on the host and calls localhost
        // Use host-mapped port (typically 3002)
        const localPort = parseInt(
          process.env.ORCHESTRATOR_PORT_HOST || process.env.PORT || '3002',
          10,
        );
        return `http://localhost:${localPort}`;
      }

      case 'docker':
        // In Docker mode, use the container's Docker bridge IP which is accessible from
        // both Lambda containers (on the same Docker network) and host-side pollers.
        return `http://${dockerHost}:${port}`;

      case 'eks': {
        // In EKS, use the configured callback URL (K8s service)
        const configValue = this.configService.get<string>('aws.orchestratorCallbackUrl');
        return configValue || `http://orchestrator:${port}`;
      }
    }
  }

  /**
   * Get SQS queue URL for a specific queue name
   * Used to build URLs for step-specific queues
   */
  getQueueUrlByName(queueName: string): string {
    const endpoint = this.getEndpoint();

    if (endpoint) {
      // LocalStack format
      const accountId = this.configService.get<string>('aws.sqs.accountId') || '000000000000';
      return `${endpoint}/${accountId}/${queueName}`;
    } else {
      // Production AWS format
      const region = this.getRegion();
      const accountId = this.configService.get<string>('aws.sqs.accountId') || '123456789012';
      return `https://sqs.${region}.amazonaws.com/${accountId}/${queueName}`;
    }
  }

  /**
   * Get all configured queue URLs (for health checks)
   * Returns all step-specific queue URLs across all workflow types
   */
  getAllQueueUrls(): string[] {
    const queueNames = this.workflowConfig.getAllQueueNames();
    return queueNames.map((queueName) => this.getQueueUrlByName(queueName));
  }

  /**
   * Check if using LocalStack (development mode)
   */
  isLocalStack(): boolean {
    return this.configService.get<boolean>('aws.localstack.enabled') || false;
  }
}
