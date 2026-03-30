import { Injectable, Inject, Logger } from "@nestjs/common";
import { EachMessagePayload } from "kafkajs";
import { KafkaService } from "../kafka/kafka.service";
import {
  ACK_SUBSCRIPTIONS,
  AckSubscription,
} from "../config/ack-subscription.interface";
import {
  ACK_DEFAULTS_PROVIDER,
  AckDefaultsProvider,
} from "../payload/ack-defaults-provider.interface";
import { generateGenericAckDefaults } from "../payload/generic-defaults";

/**
 * Per-step test options (generic format)
 */
interface TestOptionSet {
  simDelay?: number;
  failureAfter?: number;
  failOnAttempts?: number[];
  failForItemIds?: string[];
  ackDelay?: number;
  skipAck?: boolean;
  crashBeforeAck?: boolean;
  ackPayload?: Record<string, unknown>;
}

/**
 * Interface for completed submit/processing messages
 */
interface CompletedTransformMessage {
  jobId: string;
  stepId: string;
  requiresAcknowledgement?: boolean;
  testOptions?: Record<string, TestOptionSet>;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Dev Acknowledgement Simulator
 *
 * DEVELOPMENT ONLY - Automatically sends acknowledgements for completed steps.
 *
 * Config-driven: reads WorkflowDefinition.cascades (via ConfigLoaderModule)
 * to discover which Kafka topics to listen on and which to publish ACKs to.
 * No hardcoded entity names or topics.
 *
 * Workflow-specific ACK payload defaults are loaded from an optional
 * ack-defaults file (via ACK_DEFAULTS_PATH env var). Falls back to
 * generic UUID primary key + timestamp for unknown entities.
 */
@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  /**
   * Lookup maps built from injected AckSubscription[] in constructor.
   * Replaces the former hardcoded topicToStepNames, topicToAckTopic, topicToEntityName maps.
   */
  private readonly topicLookup: Map<string, AckSubscription>;
  private readonly stepNameLookup: Map<string, AckSubscription>;

  constructor(
    private readonly kafkaService: KafkaService,
    @Inject(ACK_SUBSCRIPTIONS)
    private readonly subscriptions: AckSubscription[],
    @Inject(ACK_DEFAULTS_PROVIDER)
    private readonly ackDefaults: AckDefaultsProvider,
  ) {
    // Build lookup maps from config-derived subscriptions
    this.topicLookup = new Map();
    this.stepNameLookup = new Map();

    for (const sub of this.subscriptions) {
      this.topicLookup.set(sub.listenTopic, sub);
      this.stepNameLookup.set(sub.outputStep, sub);

      // Register alternate step names (e.g., SubmitOrders as alias for SubmitOrder)
      if (sub.alternateStepNames) {
        for (const alt of sub.alternateStepNames) {
          this.stepNameLookup.set(alt, sub);
        }
      }
    }

    this.logger.log(
      `Simulator initialized with ${this.subscriptions.length} ACK subscriptions, ` +
        `${Object.keys(this.ackDefaults).length} cascade ack-defaults loaded`,
    );
  }

  /**
   * Look up test options for the step associated with this topic.
   * Uses config-derived step names (primary + alternates).
   */
  private getStepOptions(
    testOptions: Record<string, TestOptionSet> | undefined,
    topic: string,
  ): TestOptionSet | undefined {
    if (!testOptions) return undefined;

    const sub = this.topicLookup.get(topic);
    if (!sub) return undefined;

    // Try primary step name first
    if (testOptions[sub.outputStep]) {
      return testOptions[sub.outputStep];
    }

    // Try alternate step names
    if (sub.alternateStepNames) {
      for (const alt of sub.alternateStepNames) {
        if (testOptions[alt]) {
          return testOptions[alt];
        }
      }
    }

    return undefined;
  }

  /**
   * Main message handler
   */
  async handleMessage(payload: EachMessagePayload): Promise<void> {
    const topic = payload.topic;
    const messageValue = payload.message.value?.toString();

    if (!messageValue) {
      return;
    }

    try {
      const message = JSON.parse(messageValue) as CompletedTransformMessage;

      if (!message.requiresAcknowledgement) {
        this.logger.debug("Step does not require acknowledgement, skipping");
        return;
      }

      const sub = this.topicLookup.get(topic);

      if (!sub) {
        this.logger.debug(`Unknown topic ${topic}, skipping`);
        return;
      }

      // Look up step-specific options from the step-keyed format
      const stepOpts = this.getStepOptions(message.testOptions, topic);

      await this.handleEntityCompleted(
        message,
        stepOpts,
        sub.cascadeName,
        sub.ackTopic,
      );
    } catch (error) {
      this.logger.error(`Failed to process completion message: ${error}`);
    }
  }

  /**
   * Generic handler for any cascade completion.
   * Config-driven — uses cascadeName for logging and ack-defaults lookup.
   */
  private async handleEntityCompleted(
    message: CompletedTransformMessage,
    stepOpts: TestOptionSet | undefined,
    cascadeName: string,
    ackTopic: string,
  ): Promise<void> {
    const { stepId } = message;
    const displayName = this.formatCascadeName(cascadeName);

    // Check if skipAck is enabled
    if (stepOpts?.skipAck) {
      this.logger.warn(
        `[DEV] Skipping ${displayName} acknowledgement for step ${stepId} (skipAck=true)`,
      );
      this.logger.warn(
        `   Step will remain in WAITING_FOR_ACK state for testing stuck ack recovery`,
      );
      return;
    }

    this.logger.log(
      `[DEV] Auto-acknowledging ${displayName} transformation for step ${stepId}`,
    );

    const ackDelay = stepOpts?.ackDelay || 0;

    // Generate defaults for this cascade (workflow-specific or generic fallback)
    const defaults = this.generateDefaults(cascadeName);
    const customPayload = stepOpts?.ackPayload;

    const finalAck = this.buildAckPayload(
      message,
      defaults,
      customPayload,
      ackDelay,
    );

    // Fire-and-forget: schedule the delay + publish without blocking the consumer.
    // This allows the next Kafka message to be processed immediately, preventing
    // ackDelay accumulation that causes timeouts during parallel STE execution.
    const sendAck = async () => {
      if (ackDelay > 0) {
        this.logger.log(`[DEV] Simulating ack delay: ${ackDelay}ms for step ${stepId}`);
        await this.delay(ackDelay);
      }

      await this.kafkaService.publish(ackTopic, finalAck);

      const finalPrimaryKey = finalAck.externalId as string;
      const wasOverridden = customPayload?.externalId !== undefined;

      this.logger.log(
        `[DEV] ${displayName.charAt(0).toUpperCase() + displayName.slice(1)} acknowledgement sent for step ${stepId} ` +
          `(externalId: ${finalPrimaryKey}${wasOverridden ? " [OVERRIDDEN]" : ""}` +
          `${customPayload ? ", with custom payload" : ""})`,
      );
    };

    sendAck().catch((err) =>
      this.logger.error(`[DEV] Failed to send ACK for step ${stepId}: ${err}`),
    );
  }

  /**
   * Generate ACK defaults for the given cascade name.
   * Uses workflow-provided defaults if available, otherwise generic fallback.
   */
  private generateDefaults(cascadeName: string): Record<string, unknown> {
    const generator = this.ackDefaults[cascadeName];
    if (generator) {
      return generator();
    }
    return generateGenericAckDefaults();
  }

  /**
   * Format cascadeName for display in log messages.
   * Converts camelCase to space-separated lowercase.
   * e.g., "paymentHistory" -> "payment history", "customer" -> "customer"
   */
  private formatCascadeName(cascadeName: string): string {
    return cascadeName.replace(/([A-Z])/g, " $1").toLowerCase();
  }

  /**
   * Build final acknowledgement payload
   *
   * Merge order (later overrides earlier):
   * 1. Base fields (jobId, stepId, acknowledgedAt)
   * 2. Original message echo (data sent to external system)
   * 3. Auto-generated defaults (externalId, validation, etc.)
   * 4. Custom payload from testOptions (OVERRIDES everything)
   * 5. Metadata (always present, includes debug info)
   */
  private buildAckPayload(
    message: CompletedTransformMessage,
    defaults: Record<string, unknown>,
    customPayload: Record<string, unknown> | undefined,
    ackDelay: number,
  ): Record<string, unknown> {
    const { jobId, stepId } = message;

    const baseFields = {
      jobId,
      stepId,
      acknowledgedAt: new Date().toISOString(),
      simulator: "dev-ack-simulator",
    };

    // Echo original message (excluding testOptions to avoid bloat)
    const { testOptions: _, ...originalWithoutTestOptions } = message;

    const mergedPayload = {
      ...baseFields,
      ...originalWithoutTestOptions,
      ...defaults,
      ...(customPayload || {}),
    };

    const finalPayload = {
      ...mergedPayload,
      metadata: {
        simulatedAckDelay: ackDelay,
        acknowledgedBy: "dev-simulator",
        customPayloadProvided: !!customPayload,
        npdDefaultsGenerated: Object.keys(defaults),
        customPayloadKeys: customPayload ? Object.keys(customPayload) : [],
      },
    };

    return finalPayload;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
