/**
 * Order Processing — ACK Defaults
 *
 * Entity-specific default payload generators for the dev-ack-simulator.
 * These produce realistic external system ACK payloads for testing.
 *
 * Keys match CascadeConfig.cascadeName values from workflow.config.ts:
 *   customer, order, lineItem, payment, shipment
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
  customer: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_customer_id: extId,
      status: 'active',
      processed_at: new Date().toISOString(),
    };
  },

  order: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_order_id: extId,
      status: 'confirmed',
      processed_at: new Date().toISOString(),
    };
  },

  lineItem: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_line_item_id: extId,
      status: 'fulfilled',
      processed_at: new Date().toISOString(),
    };
  },

  payment: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_payment_id: extId,
      status: 'settled',
      processed_at: new Date().toISOString(),
    };
  },

  shipment: () => {
    const extId = uuidv4();
    return {
      externalId: extId,
      ext_shipment_id: extId,
      status: 'dispatched',
      processed_at: new Date().toISOString(),
    };
  },
};

export default ackDefaults;
