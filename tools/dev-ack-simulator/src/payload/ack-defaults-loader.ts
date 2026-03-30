/**
 * ACK Defaults Loader
 *
 * Loads workflow-provided ack-defaults from a file path at startup.
 * Falls back to an empty provider (generic defaults used for all entities).
 */
import { Logger } from "@nestjs/common";
import type { AckDefaultsProvider } from "./ack-defaults-provider.interface";

const logger = new Logger("AckDefaultsLoader");

/**
 * Load ack-defaults from the given file path.
 * Returns an empty provider if the file doesn't exist or fails to load.
 */
export function loadAckDefaults(filePath?: string): AckDefaultsProvider {
  if (!filePath) {
    logger.log(
      "No ACK_DEFAULTS_PATH configured — using generic defaults for all cascades",
    );
    return {};
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require(filePath);
    const defaults: AckDefaultsProvider =
      module.ackDefaults || module.default || module;

    if (typeof defaults !== "object" || defaults === null) {
      logger.warn(
        `ACK defaults file loaded but export is not an object — using generic defaults for all cascades`,
      );
      return {};
    }

    const cascadeNames = Object.keys(defaults);
    logger.log(
      `Loaded ${cascadeNames.length} cascade ack-defaults from workflow: ${cascadeNames.join(", ")}`,
    );
    return defaults;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // File not found is expected for workflows without custom defaults
    if (message.includes("Cannot find module") || message.includes("ENOENT")) {
      logger.log(
        `No ack-defaults file at ${filePath} — using generic defaults for all cascades`,
      );
    } else {
      logger.warn(`Failed to load ack-defaults from ${filePath}: ${message}`);
    }
    return {};
  }
}
