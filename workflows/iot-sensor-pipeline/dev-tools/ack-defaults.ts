/**
 * IoT Sensor Pipeline — ACK Defaults
 *
 * Entity-specific default payload generators for the dev-ack-simulator.
 * These produce realistic external system ACK payloads for testing.
 *
 * Keys match CascadeConfig.cascadeName values from workflow.config.ts:
 *   device, sensor, reading, alert, aggregate
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
  device: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_device_id: extId,
      status: 'provisioned',
      processed_at: new Date().toISOString(),
    };
  },

  sensor: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_sensor_id: extId,
      status: 'activated',
      processed_at: new Date().toISOString(),
    };
  },

  reading: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_reading_id: extId,
      status: 'published',
      processed_at: new Date().toISOString(),
    };
  },

  alert: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_alert_id: extId,
      status: 'dispatched',
      processed_at: new Date().toISOString(),
    };
  },

  aggregate: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_aggregate_id: extId,
      status: 'published',
      processed_at: new Date().toISOString(),
    };
  },
};

export default ackDefaults;
