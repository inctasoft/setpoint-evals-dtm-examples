/**
 * Runtime Detection Configuration
 *
 * Detects the runtime environment automatically based on context:
 * - 'eks': Running in Kubernetes (EKS) - uses env vars from ConfigMap/Secrets
 * - 'docker': Running in Docker container - uses Docker service names
 * - 'local': Running locally on host - uses localhost with mapped ports
 *
 * This eliminates the need for multiple .env files and manual switching.
 */

import * as fs from 'fs';

export type RuntimeMode = 'eks' | 'docker' | 'local';

/**
 * Detect the current runtime environment.
 *
 * Detection order:
 * 1. K8S_SERVICE_HOST env var exists → EKS mode
 * 2. /.dockerenv file exists → Docker mode
 * 3. Otherwise → Local mode
 */
export function detectRuntime(): RuntimeMode {
  // Kubernetes sets this env var automatically in all pods
  if (process.env.K8S_SERVICE_HOST) {
    return 'eks';
  }

  // Docker creates this file inside containers
  if (fs.existsSync('/.dockerenv')) {
    return 'docker';
  }

  // Default to local development
  return 'local';
}

/**
 * Get database host based on runtime mode
 * - Local: localhost (uses host-mapped ports)
 * - Docker: Docker service name (internal network)
 * - EKS: Uses env var (RDS endpoint)
 */
export function getDatabaseHost(
  envValue: string | undefined,
  dockerServiceName: string,
  defaultHost = 'localhost',
): string {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'eks':
      // In EKS, always use the env var (should be RDS endpoint)
      return envValue || defaultHost;
    case 'docker':
      // In Docker, use the Docker service name
      return envValue || dockerServiceName;
    case 'local':
      // Locally, always use localhost
      return 'localhost';
  }
}

/**
 * Get database port based on runtime mode
 * - Local: Uses host-mapped port (e.g., 5448)
 * - Docker: Uses internal container port (e.g., 5432)
 * - EKS: Uses env var or default (5432)
 */
export function getDatabasePort(
  envPort: string | undefined,
  envHostPort: string | undefined,
  containerPort: number,
  hostMappedPort: number,
): number {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'eks':
      // In EKS, use env var or standard postgres port
      return parseInt(envPort || String(containerPort), 10);
    case 'docker':
      // In Docker, use container internal port
      return parseInt(envPort || String(containerPort), 10);
    case 'local':
      // Locally, use host-mapped port
      return parseInt(envHostPort || String(hostMappedPort), 10);
  }
}

/**
 * Get service endpoint based on runtime mode
 * - Local: Uses localhost with host-mapped port (ALWAYS, ignores env value)
 * - Docker: Uses Docker service name (or host.docker.internal for host access)
 * - EKS: Uses env var (real AWS endpoint or service URL)
 */
export function getServiceEndpoint(
  envValue: string | undefined,
  dockerEndpoint: string,
  localEndpoint: string,
): string | undefined {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'eks':
      // In EKS, return undefined to use real AWS (or explicit endpoint)
      return envValue;
    case 'docker':
      // In Docker, use Docker service endpoint
      return envValue || dockerEndpoint;
    case 'local':
      // Locally, ALWAYS use localhost endpoint - ignore env value
      return localEndpoint;
  }
}

/**
 * Get Kafka broker address based on runtime mode
 *
 * IMPORTANT: In local mode, we ALWAYS use localhost:9093 regardless of env value
 * because the .env file contains Docker-oriented values (dtm-kafka:29092) that
 * don't work when running outside Docker.
 */
export function getKafkaBroker(envValue: string | undefined): string {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'eks':
      // In EKS, use env var (MSK broker endpoint)
      return envValue || 'localhost:9092';
    case 'docker':
      // In Docker, use Docker Kafka service
      return envValue || 'dtm-kafka:29092';
    case 'local':
      // Locally, ALWAYS use localhost with host-mapped port
      // Ignore env value as it may contain Docker-specific addresses
      return 'localhost:9093';
  }
}

/**
 * Get orchestrator callback URL based on runtime mode
 * This is the URL that Lambda workers use to call back to the orchestrator
 *
 * Uses environment variables for configuration:
 * - PORT / ORCHESTRATOR_PORT: Container internal port (default: 3000)
 * - ORCHESTRATOR_DOCKER_HOST: Docker service name (default: dtm-orchestrator)
 * - ORCHESTRATOR_PORT_HOST: Host-mapped port for local mode (default: 3002)
 *
 * Runtime behavior:
 * - Local mode: Uses localhost:ORCHESTRATOR_PORT_HOST
 * - Docker mode: Uses ORCHESTRATOR_DOCKER_HOST:PORT (same network)
 * - EKS mode: Uses envValue or orchestrator:PORT
 */
export function getOrchestratorCallbackUrl(envValue: string | undefined, port: number): string {
  // Explicit env override takes priority in all modes (e.g., when running SQS poller on host)
  if (envValue) {
    return envValue;
  }

  const runtime = detectRuntime();
  const dockerHost = process.env.ORCHESTRATOR_DOCKER_HOST || 'dtm-orchestrator';

  switch (runtime) {
    case 'eks':
      // In EKS, use internal K8s service URL
      return `http://orchestrator:${port}`;
    case 'docker':
      // In Docker mode, Lambda workers spawned by LocalStack are on the same Docker network.
      // They can reach the orchestrator directly via its Docker service name.
      // Uses container internal port (PORT env var).
      return `http://${dockerHost}:${port}`;
    case 'local': {
      // Locally, use host-mapped port (typically 3002)
      const localPort = parseInt(process.env.ORCHESTRATOR_PORT_HOST || String(port), 10);
      return `http://localhost:${localPort}`;
    }
  }
}

/**
 * Log the detected runtime mode at startup
 */
export function logRuntimeMode(): void {
  const runtime = detectRuntime();
  const modeDescriptions: Record<RuntimeMode, string> = {
    eks: '☸️  EKS Mode - Using Kubernetes ConfigMap/Secrets',
    docker: '🐳 Docker Mode - Using Docker service names',
    local: '💻 Local Mode - Using localhost with mapped ports',
  };
  console.log(`[RuntimeConfig] ${modeDescriptions[runtime]}`);
}
