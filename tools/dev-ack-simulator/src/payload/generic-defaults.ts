/**
 * Generic ACK Defaults
 *
 * Fallback payload generator used when a workflow does not provide
 * entity-specific ack-defaults. Produces a minimal ACK payload with
 * a UUID primary key and timestamp — sufficient for any workflow.
 */
import { v4 as uuidv4 } from "uuid";

export function generateGenericAckDefaults(): Record<string, unknown> {
  const id = uuidv4();
  return {
    externalId: id,
    primaryKey: id,
    ext_processed_at: new Date().toISOString(),
  };
}
