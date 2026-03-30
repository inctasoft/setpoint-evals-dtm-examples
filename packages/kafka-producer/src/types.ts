/**
 * Message payload for dtm.jobs.completed topic
 */
export interface JobCompletedMessage {
  eventId: string;
  jobId: string;
  transformedAt: string;
  data?: Record<string, unknown>;
}

/**
 * Message payload for dtm.jobs.failed topic
 */
export interface JobFailedMessage {
  eventId: string;
  jobId: string;
  failedAt: string;
  error: string;
  stage?: string;
  data?: Record<string, unknown>;
}

/**
 * Kafka producer configuration
 */
export interface KafkaProducerConfig {
  broker: string | string[];
  clientId?: string;
  retry?: {
    retries?: number;
    initialRetryTime?: number;
  };
}
