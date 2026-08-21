/**
 * Kafka Configuration Module
 *
 * Provides typed configuration for Kafka broker and consumer settings.
 * Automatically detects runtime mode and adjusts broker address accordingly.
 */

import { registerAs } from '@nestjs/config';
import { getKafkaBroker } from './runtime.config';

/**
 * Kafka Configuration
 */
export const kafkaConfig = registerAs('kafka', () => {
  const broker = getKafkaBroker(process.env.KAFKA_BROKER);
  console.log(`[KafkaConfig] Broker: ${broker} (env: ${process.env.KAFKA_BROKER || 'not set'})`);

  // Base client ID - used for both producer and consumer with suffixes
  const clientId = process.env.KAFKA_CLIENT_ID || 'dtm-orchestrator';

  return {
    // Broker address - automatically adjusted based on runtime
    broker,

    // Client identification
    clientId,
    producerClientId: `${clientId}-producer`,
    consumerClientId: `${clientId}-consumer`,

    // Consumer group configuration
    consumerGroupId: process.env.KAFKA_CONSUMER_GROUP_ID || 'dtm-service-group',

    // Topic configuration
    topics: {
      jobSubmitted: process.env.KAFKA_TOPIC_JOB_SUBMITTED || 'dtm.jobs.submitted',
    },

    // Producer settings
    producer: {
      allowAutoTopicCreation: false,
      transactionTimeout: 30000,
    },

    // Consumer settings
    consumer: {
      sessionTimeout: 30000,
      heartbeatInterval: 10000,
      maxBytesPerPartition: 1048576, // 1MB
      retry: {
        retries: 5,
        initialRetryTime: 300,
        maxRetryTime: 30000,
      },
    },

    // Connection settings
    connection: {
      connectionTimeout: 10000,
      requestTimeout: 30000,
    },

    // Feature flags
    publishEventsToKafka: process.env.PUBLISH_EVENTS_TO_KAFKA !== 'false',
  };
});

/**
 * Kafka configuration type for TypeScript
 */
export interface KafkaConfig {
  broker: string;
  clientId: string;
  producerClientId: string;
  consumerClientId: string;
  consumerGroupId: string;
  topics: {
    jobSubmitted: string;
  };
  producer: {
    allowAutoTopicCreation: boolean;
    transactionTimeout: number;
  };
  consumer: {
    sessionTimeout: number;
    heartbeatInterval: number;
    maxBytesPerPartition: number;
    retry: {
      retries: number;
      initialRetryTime: number;
      maxRetryTime: number;
    };
  };
  connection: {
    connectionTimeout: number;
    requestTimeout: number;
  };
  publishEventsToKafka: boolean;
}

export default kafkaConfig;
