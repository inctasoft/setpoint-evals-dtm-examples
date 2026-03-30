/**
 * ACK Defaults — <YOUR WORKFLOW NAME>
 *
 * Optional per-cascade ACK payload generators for the dev-ack-simulator.
 * Each key is a cascadeName (matching CascadeConfig.cascadeName).
 * The generator function returns a realistic payload for testing.
 *
 * If this file is not provided, the simulator falls back to generic defaults
 * (UUID primary key + timestamp).
 *
 * See reference: workflows/order-processing/dev-tools/ack-defaults.ts
 */

import { v4 as uuidv4 } from 'uuid';

export interface AckDefaultsGenerator {
  (): Record<string, unknown>;
}

export type AckDefaultsProvider = Record<string, AckDefaultsGenerator>;

export const ackDefaults: AckDefaultsProvider = {
  widget: () => ({
    // 'externalId' is the conventional field name workflows use in fkExtractor/childFkExtractor.
    // Replace this with whatever field names your workflow's fkExtractor reads.
    externalId: uuidv4(),
    primaryKey: uuidv4(),
    ext_processed_at: new Date().toISOString(),
    status: 'active',
  }),
};

export default ackDefaults;
