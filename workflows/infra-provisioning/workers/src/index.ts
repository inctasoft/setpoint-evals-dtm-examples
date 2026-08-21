/**
 * Lambda Workers - Exports
 *
 * This file exports all handler functions for use by the debug-server mode
 * in the SQS poller. Each handler is exported with a unique name that matches
 * the Lambda function name used in LocalStack.
 */

// Environment handlers
export { handler as planEnvironmentHandler } from "./handlers/plan-environment";
export { handler as applyEnvironmentHandler } from "./handlers/apply-environment";

// Network handlers
export { handler as planNetworkHandler } from "./handlers/plan-network";
export { handler as applyNetworkHandler } from "./handlers/apply-network";

// Compute handlers (fan-out pattern)
export { handler as discoverComputeHandler } from "./handlers/discover-compute";
export { handler as planComputeHandler } from "./handlers/plan-compute";
export { handler as applyComputeHandler } from "./handlers/apply-compute";

// Storage handlers
export { handler as planStorageHandler } from "./handlers/plan-storage";
export { handler as applyStorageHandler } from "./handlers/apply-storage";

// DNS handlers
export { handler as planDnsHandler } from "./handlers/plan-dns";
export { handler as applyDnsHandler } from "./handlers/apply-dns";

// Certificate handlers
export { handler as planCertificateHandler } from "./handlers/plan-certificate";
export { handler as applyCertificateHandler } from "./handlers/apply-certificate";

// Load Balancer handlers
export { handler as planLoadBalancerHandler } from "./handlers/plan-load-balancer";
export { handler as applyLoadBalancerHandler } from "./handlers/apply-load-balancer";

// ─── Handler Map ────────────────────────────────────────────────────────────
// Maps SQS queue names to handler functions for dynamic registration
// Used by the SQS poller's handler registry in debug-server mode

import { handler as planEnvironment } from "./handlers/plan-environment";
import { handler as applyEnvironment } from "./handlers/apply-environment";
import { handler as planNetwork } from "./handlers/plan-network";
import { handler as applyNetwork } from "./handlers/apply-network";
import { handler as discoverCompute } from "./handlers/discover-compute";
import { handler as planCompute } from "./handlers/plan-compute";
import { handler as applyCompute } from "./handlers/apply-compute";
import { handler as planStorage } from "./handlers/plan-storage";
import { handler as applyStorage } from "./handlers/apply-storage";
import { handler as planDns } from "./handlers/plan-dns";
import { handler as applyDns } from "./handlers/apply-dns";
import { handler as planCertificate } from "./handlers/plan-certificate";
import { handler as applyCertificate } from "./handlers/apply-certificate";
import { handler as planLoadBalancer } from "./handlers/plan-load-balancer";
import { handler as applyLoadBalancer } from "./handlers/apply-load-balancer";

/**
 * Queue name -> handler function mapping.
 * Used by the SQS poller handler registry for dynamic multi-workflow support.
 * Queue names must match the queueName fields in workflow.config.ts.
 */
export const handlerMap: Record<string, (event: any, context: any) => Promise<any>> = {
  "infra-plan-environment": planEnvironment,
  "infra-apply-environment": applyEnvironment,
  "infra-plan-network": planNetwork,
  "infra-apply-network": applyNetwork,
  "infra-discover-compute": discoverCompute,
  "infra-plan-compute": planCompute,
  "infra-apply-compute": applyCompute,
  "infra-plan-storage": planStorage,
  "infra-apply-storage": applyStorage,
  "infra-plan-dns": planDns,
  "infra-apply-dns": applyDns,
  "infra-plan-certificate": planCertificate,
  "infra-apply-certificate": applyCertificate,
  "infra-plan-load-balancer": planLoadBalancer,
  "infra-apply-load-balancer": applyLoadBalancer,
};
