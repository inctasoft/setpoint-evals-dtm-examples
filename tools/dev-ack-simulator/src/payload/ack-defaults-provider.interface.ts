/**
 * ACK Defaults Provider Interface
 *
 * Defines the contract for workflow-specific ACK payload defaults.
 * Each workflow can optionally provide cascade-specific default generators
 * that produce realistic ACK payloads for testing.
 *
 * If no workflow-specific defaults are provided, the simulator uses
 * a generic fallback (UUID primary key + base fields).
 */

/** Function that generates default ACK payload fields for a cascade */
export type AckDefaultsGenerator = () => Record<string, unknown>;

/**
 * Map of cascadeName -> default payload generator.
 *
 * Keys must match CascadeConfig.cascadeName values from the workflow config.
 * Example keys: "customer", "order", "lineItem", "payment", etc.
 */
export type AckDefaultsProvider = Record<string, AckDefaultsGenerator>;

/** NestJS injection token for AckDefaultsProvider */
export const ACK_DEFAULTS_PROVIDER = Symbol("ACK_DEFAULTS_PROVIDER");
