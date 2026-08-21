import { Injectable, Logger } from '@nestjs/common';
import { StepRepository, StepStatus, Step as DbStep, JobRepository } from '@dtm/database';
import { EventBus } from '../event-bus/event-bus.interface';
import { WorkflowConfigService, WorkflowRegistryService, FkMap } from '../workflow-loader';

/**
 * Generic output data event interface.
 * The output data key is dynamic based on cascade config.
 */
interface TransformedEvent {
  jobId: string;
  stepId: string;
  tableName: string;
  recordCount: number;
  transformedAt: Date;
  eventTimestamp: Date;
  requiresAcknowledgement: boolean;
  testOptions?: Record<string, unknown>;
  [outputDataKey: string]: unknown;
}

/**
 * Cascade Publish Service
 *
 * Manages cascade publishing of data based on FK dependencies.
 *
 * Responsibilities:
 * 1. Check if a cascade can be published (all parent dependencies have externalId)
 * 2. Inject FK values from parent cascades into child cascade output
 * 3. Publish to Kafka and update step status to WAITING_FOR_ACK
 *
 * Called after each ACK is received to check if any dependent cascades
 * can now be published (their parent's externalId is now available).
 */
@Injectable()
export class CascadePublishService {
  private readonly logger = new Logger(CascadePublishService.name);

  constructor(
    private readonly stepRepository: StepRepository,
    private readonly jobRepository: JobRepository,
    private readonly eventBus: EventBus,
    private readonly workflowConfig: WorkflowConfigService,
    private readonly workflowRegistry: WorkflowRegistryService,
  ) {}

  /**
   * Resolve the correct WorkflowConfigService for a job.
   */
  private getWorkflowConfig(job: { workflowName?: string }): WorkflowConfigService {
    if (job.workflowName && this.workflowRegistry.has(job.workflowName)) {
      return this.workflowRegistry.get(job.workflowName);
    }
    return this.workflowConfig;
  }

  /**
   * Check if a specific cascade's dependencies are met for publishing
   *
   * Enhanced to handle the case where parent cascades don't exist (discovery found 0 items).
   * In this case, the dependency is vacuously satisfied.
   *
   * @param cascadeName - The cascade to check
   * @param steps - All steps for the job
   * @returns true if all parent cascades have ACKs OR are empty (discovery completed with 0 items)
   */
  areCascadeDependenciesMet(
    cascadeName: string,
    steps: DbStep[],
    wfConfig?: WorkflowConfigService,
  ): boolean {
    const cfg = wfConfig || this.workflowConfig;
    const ackMap = cfg.buildAckMetadataMap(steps);
    // Pass steps to check for empty parent cascades (discovery with childCount: 0)
    const stepsWithOutput = steps.map((s) => ({
      stepValue: s.stepValue,
      status: s.status,
      output: s.output,
    }));
    return cfg.areCascadeDependenciesMet(cascadeName, ackMap, stepsWithOutput);
  }

  /**
   * Inject FK values into each record using the workflow-owned fkExtractor.
   *
   * Builds parent ACK map and FK maps once, then calls fkExtractor per record.
   * If no fkExtractor is defined for this cascade, returns records unchanged.
   */
  injectFkValues(
    cascadeName: string,
    steps: DbStep[],
    records: Array<Record<string, unknown>>,
    wfConfig?: WorkflowConfigService,
  ): Array<Record<string, unknown>> {
    const cfg = wfConfig || this.workflowConfig;
    const cascade = cfg.getCascade(cascadeName);
    if (!cascade?.fkExtractor) return records;

    const ackMap = cfg.buildAckMetadataMap(steps);
    const fkMaps = this.buildFkMapsFromSteps(cascadeName, steps, cfg);

    return records.map((record) => ({
      ...record,
      ...cfg.getFkInjections(cascadeName, ackMap, fkMaps, record),
    }));
  }

  /**
   * Build FK maps from fan-out discovery step outputs for a given cascade.
   * Maps discoveryStepName → (childItemId → fkValue).
   * Called by injectFkValues to provide FK map data to fkExtractor.
   */
  private buildFkMapsFromSteps(
    cascadeName: string,
    steps: DbStep[],
    wfConfig?: WorkflowConfigService,
  ): Record<string, FkMap> {
    const cfg = wfConfig || this.workflowConfig;
    const cascade = cfg.getCascade(cascadeName);
    if (!cascade) return {};

    const fkMaps: Record<string, FkMap> = {};

    for (const parentType of cascade.dependsOn) {
      const parentCascade = cfg.getCascade(parentType);
      if (!parentCascade?.isFanOutParent || !parentCascade.discoveryStep) continue;

      const discoveryStep = steps.find(
        (s) =>
          s.stepValue === parentCascade.discoveryStep &&
          (s.status === StepStatus.COMPLETED || s.status === StepStatus.PARTIAL_SUCCESS),
      );

      if (discoveryStep?.output) {
        const output = discoveryStep.output as Record<string, unknown>;
        const fkMap = output.successfulEntityFkMap as FkMap | undefined;
        if (fkMap && Object.keys(fkMap).length > 0) {
          fkMaps[parentCascade.discoveryStep] = fkMap;
          this.logger.debug(
            `FK map for ${parentCascade.discoveryStep}: ${Object.keys(fkMap).length} entries`,
          );
        }
      }
    }

    return fkMaps;
  }

  /**
   * Check and execute pending publish steps after an ACK is received
   *
   * Flow:
   * 1. Scan all steps for this job
   * 2. Find COMPLETED output steps where kafkaPublishedAt is null
   * 3. For each, check if entity dependencies are now met
   * 4. If met: Inject FK values, publish to Kafka, update status to WAITING_FOR_ACK
   *
   * @param jobId - The job to check for pending publishes
   * @returns Object with counts and details of published steps
   */
  async checkAndExecutePendingPublishSteps(jobId: string): Promise<{
    checkedSteps: number;
    publishedSteps: number;
    details: Array<{
      stepId: string;
      stepValue: string;
      cascadeName: string;
      fkInjections: Record<string, string>;
    }>;
  }> {
    this.logger.log(`🔄 Checking for pending publish steps in job ${jobId}`);

    // 0. Resolve per-job workflow config
    const job = await this.jobRepository.findById(jobId, false);
    const wfConfig = job ? this.getWorkflowConfig(job) : this.workflowConfig;

    // 1. Get all steps for this job
    const steps = await this.stepRepository.findByJobId(jobId);
    if (!steps || steps.length === 0) {
      this.logger.debug(`No steps found for job ${jobId}`);
      return { checkedSteps: 0, publishedSteps: 0, details: [] };
    }

    // 2. Find COMPLETED output steps where kafkaPublishedAt is null
    // These are steps that completed but couldn't publish due to missing parent ACKs
    const pendingPublishSteps = steps.filter((step) => {
      if (step.status !== StepStatus.COMPLETED) return false;
      if (!wfConfig.isOutputStep(step.stepValue)) return false;
      if (step.kafkaPublishedAt) return false; // Already published
      if (!step.output) return false; // No data to publish
      return true;
    });

    this.logger.debug(`Found ${pendingPublishSteps.length} COMPLETED output steps pending publish`);

    if (pendingPublishSteps.length === 0) {
      return { checkedSteps: steps.length, publishedSteps: 0, details: [] };
    }

    // 3. Check each pending step for dependency satisfaction
    const publishedDetails: Array<{
      stepId: string;
      stepValue: string;
      cascadeName: string;
      fkInjections: Record<string, string>;
    }> = [];

    for (const step of pendingPublishSteps) {
      const cascadeName = wfConfig.getCascadeNameFromStep(step.stepValue);
      if (!cascadeName) {
        this.logger.warn(`Unknown cascade for step ${step.stepValue}`);
        continue;
      }

      // Check if dependencies are met
      if (!this.areCascadeDependenciesMet(cascadeName, steps, wfConfig)) {
        this.logger.debug(`Cascade ${cascadeName} dependencies not yet met for step ${step.id}`);
        continue;
      }

      // Dependencies are met! Inject FK values per-record using workflow-owned fkExtractor
      const outputDataKey = this.getOutputDataKey(cascadeName, wfConfig);
      const transformedData = (step.output?.[outputDataKey] || []) as Array<
        Record<string, unknown>
      >;

      // Inject FK values using the workflow-owned fkExtractor
      const injectedData = this.injectFkValues(cascadeName, steps, transformedData, wfConfig);

      // Collect sample injections for logging
      const sampleInjections =
        injectedData.length > 0
          ? Object.entries(injectedData[0])
              .filter(([key]) => key.startsWith('ext_'))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
          : {};

      this.logger.log(
        `✅ Cascade ${cascadeName} dependencies met for step ${step.id}! Sample FK injections: ${JSON.stringify(sampleInjections)}`,
      );

      // Inject FKs and publish
      try {
        await this.publishStepWithFkInjectionAndData(
          jobId,
          step,
          cascadeName,
          injectedData,
          sampleInjections,
          [],
          [],
          wfConfig,
        );
        publishedDetails.push({
          stepId: step.id,
          stepValue: step.stepValue,
          cascadeName,
          fkInjections: sampleInjections,
        });
      } catch (error) {
        this.logger.error(
          `Failed to publish step ${step.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (publishedDetails.length > 0) {
      this.logger.log(
        `🎉 Published ${publishedDetails.length} step(s) after cascade check: ${publishedDetails.map((d) => d.stepValue).join(', ')}`,
      );
    }

    return {
      checkedSteps: steps.length,
      publishedSteps: publishedDetails.length,
      details: publishedDetails,
    };
  }

  /**
   * Publish a single step's data with FK injection (legacy - uniform injection)
   */
  private async publishStepWithFkInjection(
    jobId: string,
    step: DbStep,
    cascadeName: string,
    fkInjections: Record<string, string>,
    wfConfig?: WorkflowConfigService,
  ): Promise<void> {
    if (!step.output) {
      throw new Error(`Step ${step.id} has no output data`);
    }

    const cfg = wfConfig || this.workflowConfig;
    const cascadeDep = cfg.getCascade(cascadeName);
    const eventTopic = cfg.getCascadeEventTopic(cascadeName);
    if (!cascadeDep || !eventTopic) {
      throw new Error(`No cascade dependency config for ${cascadeName}`);
    }

    // Get transformed data array from output
    const outputDataKey = this.getOutputDataKey(cascadeName, cfg);
    const transformedData = step.output[outputDataKey] as Array<Record<string, unknown>>;

    if (!transformedData || transformedData.length === 0) {
      this.logger.warn(`Step ${step.id} has no ${outputDataKey} in output`);
      return;
    }

    // Inject FK values into each record
    const injectedData = transformedData.map((record) => ({
      ...record,
      ...fkInjections,
    }));

    // Build event
    const event = this.buildTransformedEvent(jobId, step, cascadeName, injectedData, cfg);

    // Publish to Kafka
    this.logger.log(
      `📤 Publishing ${cascadeName} data to ${eventTopic} with FK injections (${injectedData.length} records)`,
    );

    const published = await this.eventBus.publish(eventTopic, event, jobId);

    if (published) {
      // Update step status to WAITING_FOR_ACK and set kafkaPublishedAt
      await this.stepRepository.updateStatus(step.id, StepStatus.WAITING_FOR_ACK);

      // Also update kafkaPublishedAt - need to access the repo directly
      const updatedStep = await this.stepRepository.findById(step.id);
      if (updatedStep) {
        updatedStep.kafkaPublishedAt = new Date();
        // Store the FK-injected output
        updatedStep.output = {
          ...step.output,
          [outputDataKey]: injectedData,
          _fkInjections: fkInjections, // Store for debugging/auditing
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        await (this.stepRepository as any)['repo'].save(updatedStep);
      }

      this.logger.log(
        `✅ ${cascadeName} data published to ${eventTopic} - waiting for acknowledgement`,
      );
    } else {
      this.logger.warn(`⚠️ ${cascadeName} data not published (Kafka not configured)`);
    }
  }

  /**
   * Publish a single step's data with pre-injected FK values.
   */
  private async publishStepWithFkInjectionAndData(
    jobId: string,
    step: DbStep,
    cascadeName: string,
    injectedData: Array<Record<string, unknown>>,
    sampleInjections: Record<string, unknown>,
    _fkInjectionWarnings: unknown[] = [],
    _warningsByRecord: unknown[] = [],
    wfConfig?: WorkflowConfigService,
  ): Promise<void> {
    const cfg = wfConfig || this.workflowConfig;
    const cascadeDep = cfg.getCascade(cascadeName);
    const eventTopic = cfg.getCascadeEventTopic(cascadeName);
    if (!cascadeDep || !eventTopic) {
      throw new Error(`No cascade dependency config for ${cascadeName}`);
    }

    if (!injectedData || injectedData.length === 0) {
      this.logger.warn(`Step ${step.id} has no injected data`);
      return;
    }

    // Build event
    const event = this.buildTransformedEvent(jobId, step, cascadeName, injectedData, cfg);

    // Publish to Kafka
    this.logger.log(
      `📤 Publishing ${cascadeName} data to ${eventTopic} with FK injections (${injectedData.length} records)`,
    );

    const published = await this.eventBus.publish(eventTopic, event, jobId);

    if (published) {
      // Update step status to WAITING_FOR_ACK and set kafkaPublishedAt
      await this.stepRepository.updateStatus(step.id, StepStatus.WAITING_FOR_ACK);

      // Also update kafkaPublishedAt - need to access the repo directly
      const outputDataKey = this.getOutputDataKey(cascadeName, cfg);
      const updatedStep = await this.stepRepository.findById(step.id);
      if (updatedStep) {
        updatedStep.kafkaPublishedAt = new Date();
        // Store the FK-injected output
        updatedStep.output = {
          ...step.output,
          [outputDataKey]: injectedData,
          _fkInjections: sampleInjections, // Store sample for debugging/auditing
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        await (this.stepRepository as any)['repo'].save(updatedStep);
      }

      this.logger.log(
        `✅ ${cascadeName} data published to ${eventTopic} - waiting for acknowledgement`,
      );
    } else {
      this.logger.warn(`⚠️ ${cascadeName} data not published (Kafka not configured)`);
    }
  }

  /**
   * Get the key name for output data in step output.
   * Uses cascade config's outputDataKey, falling back to 'outputData'.
   */
  private getOutputDataKey(cascadeName: string, wfConfig?: WorkflowConfigService): string {
    const cfg = wfConfig || this.workflowConfig;
    const cascade = cfg.getCascade(cascadeName);
    return cascade?.outputDataKey || 'outputData';
  }

  /**
   * Build a transformed event for publishing to Kafka.
   * Generic — uses cascade config's outputDataKey for the data field name.
   *
   * IMPORTANT: testOptions must be preserved from step.input so that
   * dev-ack-simulator can read custom ack payloads (submitCustomerAckPayload, etc.)
   */
  private buildTransformedEvent(
    jobId: string,
    step: DbStep,
    cascadeName: string,
    transformedData: Array<Record<string, unknown>>,
    wfConfig?: WorkflowConfigService,
  ): TransformedEvent {
    // Extract testOptions from step input for dev-ack-simulator
    const testOptions = (step.input as Record<string, unknown>)?.testOptions as
      | Record<string, unknown>
      | undefined;

    const outputDataKey = this.getOutputDataKey(cascadeName, wfConfig);

    return {
      jobId,
      stepId: step.id,
      tableName: cascadeName,
      recordCount: transformedData.length,
      transformedAt: step.completedAt || new Date(),
      eventTimestamp: new Date(),
      requiresAcknowledgement: true,
      ...(testOptions && { testOptions }),
      [outputDataKey]: transformedData,
    };
  }

  /**
   * Check if a cascade has dependent cascades that might need publishing after ACK
   * This is a quick check before doing the full cascade scan
   */
  hasDependentCascades(parentCascadeName: string, wfConfig?: WorkflowConfigService): boolean {
    const cfg = wfConfig || this.workflowConfig;
    return cfg.hasDependentCascades(parentCascadeName);
  }

  /**
   * Re-publish a step's transformed-data event WITHOUT changing its state
   * (Phase 3, used by the EventRepublishScanTask). For a WAITING_FOR_ACK step
   * whose publish (or whose ACK) was dropped by a drop-realistic bus: the
   * FK-injected output stored at publish time is reused verbatim, the event
   * is rebuilt and re-published, and kafka_published_at is re-stamped so the
   * scan's lease measures time since the LATEST publish attempt.
   *
   * Returns true when the bus accepted the re-publish; false when there is
   * nothing honest to re-publish (unknown cascade/topic, no stored data) —
   * callers count that as skipped, never as an error.
   */
  async republishStepEvent(step: DbStep): Promise<boolean> {
    const jobId = step.job?.id;
    if (!jobId) {
      this.logger.error(`Cannot re-publish step ${step.id}: job relation not loaded`);
      return false;
    }

    const cfg = this.getWorkflowConfig(step.job);
    const cascadeName = cfg.getCascadeNameFromStep(step.stepValue);
    if (!cascadeName) {
      this.logger.warn(
        `Step ${step.id} (${step.stepValue}) has no cascade — nothing to re-publish`,
      );
      return false;
    }

    const eventTopic = cfg.getCascadeEventTopic(cascadeName);
    if (!eventTopic) {
      this.logger.warn(`Cascade ${cascadeName} names no event topic — nothing to re-publish`);
      return false;
    }

    const outputDataKey = this.getOutputDataKey(cascadeName, cfg);
    const data = (step.output?.[outputDataKey] || []) as Array<Record<string, unknown>>;
    if (data.length === 0) {
      this.logger.warn(
        `Step ${step.id} has no stored ${outputDataKey} to re-publish (publish never produced output?)`,
      );
      return false;
    }

    const event = this.buildTransformedEvent(jobId, step, cascadeName, data, cfg);

    this.logger.log(
      `🔁 Re-publishing ${cascadeName} data to ${eventTopic} for step ${step.id} (${data.length} records; dropped-publish recovery)`,
    );

    const published = await this.eventBus.publish(eventTopic, event, jobId);
    if (published) {
      // Re-stamp the publish marker (conditional on the status the scan
      // observed — a real ACK landing concurrently wins; the scan then
      // leaves the step alone next round).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      await (this.stepRepository as any)['repo']
        .createQueryBuilder()
        .update()
        .set({ kafkaPublishedAt: new Date() })
        .where('id = :id AND status = :status', { id: step.id, status: StepStatus.WAITING_FOR_ACK })
        .execute();
    }
    return published;
  }
}
