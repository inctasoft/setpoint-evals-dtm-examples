import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRepository, Job } from '@dtm/database';

/**
 * Unified Deduplication Service
 *
 * Provides consistent deduplication logic for both:
 * - Kafka-triggered jobs (automatic)
 * - API-triggered jobs (manual)
 *
 * Configuration (via typed config namespace):
 * - app.features.enableDeduplication → Enable/disable deduplication
 */
@Injectable()
export class DeduplicationService {
  private readonly logger = new Logger(DeduplicationService.name);

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check if deduplication is enabled via typed config namespace
   */
  isEnabled(): boolean {
    return this.configService.get<boolean>('app.features.enableDeduplication') || false;
  }

  /**
   * Check if a job already exists for the given request
   * Returns the existing job if found, null otherwise
   *
   * @param identifier - Unique identifier for the job request (consumerId, deduplicationKey, payload hash, etc.)
   * @param source - Source of the request ('kafka-consumer-created', 'kafka-consumer-updated', 'api', etc.)
   * @param additionalContext - Optional additional context for more specific matching (e.g., workflowName, eventType)
   * @param enableDeduplication - Optional per-request override (takes priority over global config)
   */
  async findExistingJob(
    identifier: string,
    source: string,
    additionalContext?: Record<string, unknown>,
    enableDeduplication?: boolean,
  ): Promise<Job | null> {
    // Determine if deduplication should be applied
    // Priority: per-request flag > global config
    const shouldDeduplicate =
      enableDeduplication !== undefined ? enableDeduplication : this.isEnabled();

    // If deduplication is disabled, always return null (no duplicate found)
    if (!shouldDeduplicate) {
      this.logger.debug(
        `Deduplication disabled for ${identifier} (source: ${enableDeduplication !== undefined ? 'per-request flag' : 'global config'})`,
      );
      return null;
    }

    this.logger.debug(
      `Deduplication enabled for ${identifier} (source: ${enableDeduplication !== undefined ? 'per-request flag' : 'global config'})`,
    );

    this.logger.debug(
      `Checking for existing job: identifier=${identifier}, source=${source}, context=${JSON.stringify(additionalContext)}`,
    );

    // Define start of today (00:00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Query for recent jobs
    const recentJobs = await this.jobRepository.findRecentJobs(100);

    // Filter for jobs created today matching our criteria
    const existingJob = recentJobs.find((job) => {
      // Check if job was submitted today
      if (job.submittedAt < today) {
        return false;
      }

      // Check submitted by matches source pattern
      if (!job.submittedBy || !job.submittedBy.includes(source)) {
        return false;
      }

      // For Kafka-triggered jobs, check _trigger metadata
      if (source.startsWith('kafka-consumer-')) {
        const trigger = job.payload?._trigger;
        if (!trigger) {
          return false;
        }

        // Match consumer ID
        if (trigger.consumerId !== identifier) {
          return false;
        }

        // If eventType provided in context, match it
        if (additionalContext?.eventType) {
          const triggerEventType = trigger.topic?.includes('created')
            ? 'created'
            : trigger.topic?.includes('updated')
              ? 'updated'
              : null;
          if (triggerEventType !== additionalContext.eventType) {
            return false;
          }
        }

        return true;
      }

      // For API-triggered jobs, check payload fields
      if (source === 'api') {
        const payload = job.payload;
        if (!payload) {
          return false;
        }

        // Match by deduplicationKey in payload, or fall back to full identifier comparison
        const payloadKey = payload.deduplicationKey?.toString();
        const matchesKey = payloadKey
          ? payloadKey === identifier
          : JSON.stringify(payload) === identifier;

        if (!matchesKey) {
          return false;
        }

        // If additional context fields provided, match them against payload
        if (additionalContext) {
          for (const [key, value] of Object.entries(additionalContext)) {
            if (key === 'eventType') continue; // eventType is handled in Kafka matching above
            if (value !== undefined && payload[key] !== value) {
              return false;
            }
          }
        }

        return true;
      }

      return false;
    });

    if (existingJob) {
      this.logger.log(
        `Found existing job for ${identifier} (source: ${source}) - Job ID: ${existingJob.id}, Status: ${existingJob.status}`,
      );
      return existingJob;
    }

    this.logger.debug(`No existing job found for ${identifier} (source: ${source})`);
    return null;
  }

  /**
   * Check for duplicate and log appropriate message
   * Returns true if duplicate found, false otherwise
   */
  async isDuplicate(
    identifier: string,
    source: string,
    additionalContext?: Record<string, unknown>,
    enableDeduplication?: boolean,
  ): Promise<boolean> {
    const existingJob = await this.findExistingJob(
      identifier,
      source,
      additionalContext,
      enableDeduplication,
    );
    return existingJob !== null;
  }
}
