import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { Kafka, Admin } from 'kafkajs';

@Injectable()
export class KafkaHealthIndicator extends HealthIndicator {
  private kafka: Kafka;
  private admin: Admin;

  // Core DTM topics (published by the orchestrator)
  private readonly PUBLISHING_TOPICS = [
    'dtm.jobs.submitted',
  ];

  // All project topics to check
  private readonly PROJECT_TOPICS = [...this.PUBLISHING_TOPICS];

  constructor() {
    super();

    // Initialize Kafka client
    const kafkaBroker = process.env.KAFKA_BROKER || process.env.KAFKA_BROKERS || 'kafka:29092';

    this.kafka = new Kafka({
      clientId: 'dtm-health-check',
      brokers: kafkaBroker.split(','),
      retry: {
        retries: 3,
        initialRetryTime: 100,
      },
    });

    this.admin = this.kafka.admin();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Connect to admin client
      await this.admin.connect();

      // List all topics
      const allTopics = await this.admin.listTopics();

      // Check which project topics exist
      const existingTopics = this.PROJECT_TOPICS.filter((topic) => allTopics.includes(topic));
      const missingTopics = this.PROJECT_TOPICS.filter((topic) => !allTopics.includes(topic));

      // Get metadata for existing project topics
      const topicsMetadata = await Promise.all(
        existingTopics.map(async (topic) => {
          const metadata = await this.admin.fetchTopicMetadata({
            topics: [topic],
          });
          const topicInfo = metadata.topics[0];
          return {
            name: topic,
            partitions: topicInfo.partitions.length,
            replicationFactor: topicInfo.partitions[0]?.replicas.length || 0,
          };
        }),
      );

      // Disconnect admin
      await this.admin.disconnect();

      // Determine health status
      const isHealthy = missingTopics.length === 0;

      const result = {
        status: isHealthy ? 'up' : 'degraded',
        broker: process.env.KAFKA_BROKER || 'kafka:29092',
        topics: {
          total: allTopics.length,
          project: {
            expected: this.PROJECT_TOPICS.length,
            existing: existingTopics.length,
            missing: missingTopics.length,
          },
        },
        projectTopics: topicsMetadata,
        ...(missingTopics.length > 0 && {
          missingTopics,
        }),
      };

      if (!isHealthy) {
        throw new HealthCheckError('Kafka topics missing', this.getStatus(key, false, result));
      }

      return this.getStatus(key, true, result);
    } catch (error) {
      // Ensure admin is disconnected on error
      try {
        await this.admin.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Kafka health check failed',
        this.getStatus(key, false, {
          status: 'down',
          error: errorMessage,
          broker: process.env.KAFKA_BROKER || 'kafka:29092',
        }),
      );
    }
  }

  // Method to get topic list (for direct endpoint)
  async getProjectTopics(): Promise<{
    topics: string[];
    details: Array<{
      name: string;
      partitions: number;
      replicationFactor: number;
      exists: boolean;
    }>;
  }> {
    try {
      await this.admin.connect();
      const allTopics = await this.admin.listTopics();

      const details = await Promise.all(
        this.PROJECT_TOPICS.map(async (topic) => {
          const exists = allTopics.includes(topic);

          if (!exists) {
            return {
              name: topic,
              partitions: 0,
              replicationFactor: 0,
              exists: false,
            };
          }

          const metadata = await this.admin.fetchTopicMetadata({
            topics: [topic],
          });
          const topicInfo = metadata.topics[0];

          return {
            name: topic,
            partitions: topicInfo.partitions.length,
            replicationFactor: topicInfo.partitions[0]?.replicas.length || 0,
            exists: true,
          };
        }),
      );

      await this.admin.disconnect();

      return {
        topics: this.PROJECT_TOPICS,
        details,
      };
    } catch (error) {
      try {
        await this.admin.disconnect();
      } catch {
        // Ignore
      }
      throw error;
    }
  }
}
