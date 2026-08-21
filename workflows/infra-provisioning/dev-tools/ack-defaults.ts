/**
 * Infrastructure Provisioning — ACK Defaults
 *
 * Entity-specific default payload generators for the dev-ack-simulator.
 * These produce realistic external system ACK payloads for testing.
 *
 * Keys match CascadeConfig.cascadeName values from workflow.config.ts:
 *   environment, network, compute, storage, dns, certificate, loadBalancer
 *
 * The dev-ack-simulator loads this file at startup (via ACK_DEFAULTS_PATH env var)
 * and uses these generators instead of the generic UUID fallback.
 */
import { v4 as uuidv4 } from 'uuid';

export interface AckDefaultsGenerator {
  (): Record<string, unknown>;
}

export type AckDefaultsProvider = Record<string, AckDefaultsGenerator>;

export const ackDefaults: AckDefaultsProvider = {
  environment: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_environment_id: extId,
      status: 'provisioned',
      processed_at: new Date().toISOString(),
    };
  },

  network: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_network_id: extId,
      status: 'provisioned',
      processed_at: new Date().toISOString(),
    };
  },

  compute: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_compute_id: extId,
      status: 'running',
      processed_at: new Date().toISOString(),
    };
  },

  storage: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_storage_id: extId,
      status: 'attached',
      processed_at: new Date().toISOString(),
    };
  },

  dns: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_dns_id: extId,
      status: 'propagated',
      processed_at: new Date().toISOString(),
    };
  },

  certificate: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_certificate_id: extId,
      status: 'issued',
      processed_at: new Date().toISOString(),
    };
  },

  loadBalancer: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_load_balancer_id: extId,
      status: 'active',
      processed_at: new Date().toISOString(),
    };
  },
};

export default ackDefaults;
