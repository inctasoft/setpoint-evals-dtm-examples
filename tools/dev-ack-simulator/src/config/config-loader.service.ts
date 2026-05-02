/**
 * Config Loader Service
 *
 * Loads the WorkflowDefinition from a file path (WORKFLOW_CONFIG_PATH env var)
 * and derives AckSubscription[] from the cascades config.
 *
 * This is the key piece that makes the simulator config-driven:
 * instead of hardcoding 6 Kafka topics, we read them from the workflow config.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AckSubscription } from "./ack-subscription.interface";

/** Minimal shape of WorkflowDefinition.cascades we need */
interface CascadeConfig {
  cascadeName: string;
  kafkaTopic?: string;
  ackTopic?: string;
  outputStep: string;
}

/** Minimal shape of WorkflowDefinition we need */
interface WorkflowConfig {
  name: string;
  cascades: CascadeConfig[];
  steps?: Record<
    string,
    Array<{ step: string; requiresAcknowledgement?: boolean }>
  >;
}

@Injectable()
export class ConfigLoaderService {
  private readonly logger = new Logger(ConfigLoaderService.name);
  private workflowConfig: WorkflowConfig | null = null;
  private subscriptions: AckSubscription[] = [];

  constructor(private readonly configService: ConfigService) {}

  /**
   * Load workflow config(s) and derive subscriptions.
   * Called during module initialization.
   *
   * Supports multiple workflows via comma-separated WORKFLOW_CONFIG_PATHS
   * (falls back to single WORKFLOW_CONFIG_PATH for backwards compatibility).
   */
  loadConfig(): void {
    const multiPaths = this.configService.get<string>("WORKFLOW_CONFIG_PATHS");
    const singlePath = this.configService.get<string>("WORKFLOW_CONFIG_PATH");

    const configPaths = multiPaths
      ? multiPaths
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : singlePath
        ? [singlePath]
        : [];

    if (configPaths.length === 0) {
      this.logger.warn(
        "WORKFLOW_CONFIG_PATH(S) not set — simulator will have no subscriptions",
      );
      return;
    }

    const allSubscriptions: AckSubscription[] = [];

    for (const configPath of configPaths) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const module = require(configPath);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const namedExport = Object.values(module as Record<string, any>).find(
          (v) => v && typeof v === "object" && v.name && v.cascades,
        );
        const config: WorkflowConfig = module.default || namedExport || module;

        if (!config?.cascades || !Array.isArray(config.cascades)) {
          this.logger.warn(
            `Workflow config at ${configPath} has no cascades array — skipping`,
          );
          continue;
        }

        // Keep first loaded config as primary (for backwards compat)
        if (!this.workflowConfig) {
          this.workflowConfig = config;
        }

        const subs = this.deriveSubscriptions(config);
        allSubscriptions.push(...subs);

        this.logger.log(
          `Loaded workflow: ${config.name || "unknown"} (${subs.length} subscriptions)`,
        );

        for (const sub of subs) {
          this.logger.debug(
            `  ${sub.cascadeName}: ${sub.listenTopic} -> ${sub.ackTopic} (step: ${sub.outputStep})`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to load workflow config from ${configPath}: ${message}`,
        );
      }
    }

    this.subscriptions = allSubscriptions;
    this.logger.log(
      `Total ACK subscriptions across all workflows: ${this.subscriptions.length}`,
    );
  }

  /**
   * Derive AckSubscription[] from the workflow's cascades config.
   * Only includes cascades that have both kafkaTopic and ackTopic defined.
   */
  private deriveSubscriptions(config: WorkflowConfig): AckSubscription[] {
    const subscriptions: AckSubscription[] = [];

    for (const cascade of config.cascades) {
      if (!cascade.kafkaTopic || !cascade.ackTopic) {
        this.logger.debug(
          `Skipping cascade ${cascade.cascadeName} — no kafkaTopic or ackTopic`,
        );
        continue;
      }

      // Build alternate step names for testOptions lookup
      // e.g., SubmitOrder (singular) might also be referenced as SubmitOrders (plural)
      const alternates = this.findAlternateStepNames(
        config,
        cascade.outputStep,
        cascade.cascadeName,
      );

      subscriptions.push({
        listenTopic: cascade.kafkaTopic,
        ackTopic: cascade.ackTopic,
        outputStep: cascade.outputStep,
        cascadeName: cascade.cascadeName,
        alternateStepNames: alternates.length > 0 ? alternates : undefined,
      });
    }

    return subscriptions;
  }

  /**
   * Find alternate step names from the step definitions.
   * For fan-out cascades, the submit step might be singular (SubmitOrder)
   * while the batch variant uses plural (SubmitOrders).
   */
  private findAlternateStepNames(
    config: WorkflowConfig,
    primaryStep: string,
    cascadeName: string,
  ): string[] {
    if (!config.steps) return [];

    const alternates = new Set<string>();

    for (const variantSteps of Object.values(config.steps)) {
      for (const step of variantSteps) {
        if (
          step.step !== primaryStep &&
          step.requiresAcknowledgement &&
          step.step.toLowerCase().includes(cascadeName.toLowerCase())
        ) {
          alternates.add(step.step);
        }
      }
    }

    return Array.from(alternates);
  }

  /** Get the derived subscriptions */
  getSubscriptions(): AckSubscription[] {
    return this.subscriptions;
  }

  /** Get the loaded workflow config */
  getWorkflowConfig(): WorkflowConfig | null {
    return this.workflowConfig;
  }
}
