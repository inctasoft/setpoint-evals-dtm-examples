import { Kafka, Consumer } from 'kafkajs';
import {
  KafkaProducerService,
  JobCompletedMessage,
  JobFailedMessage,
} from '@dtm/kafka-producer';

/**
 * Kafka Publishing Integration Tests
 *
 * These tests verify that messages can be published to the Dockerized Kafka broker
 * and consumed successfully. They run against a RUNNING Kafka service.
 *
 * Prerequisites:
 * - Kafka broker must be running (via docker-compose)
 * - Topics 'dtm.jobs.completed' and 'dtm.jobs.failed' must exist
 *
 * Usage:
 *   # Against running service (default: localhost:9092)
 *   KAFKA_BROKER=localhost:9092 npm run test:integration
 */

const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const TIMEOUT = 30000; // 30 seconds for Kafka operations

describe('Kafka Publishing (Integration)', () => {
  let producer: KafkaProducerService;
  let consumer: Consumer;
  let kafka: Kafka;
  let consumedMessages: Array<{ topic: string; message: unknown }> = [];

  beforeAll(async () => {
    // Initialize Kafka client for consumer
    kafka = new Kafka({
      clientId: 'kafka-integration-test',
      brokers: KAFKA_BROKER.split(',').map((b) => b.trim()),
    });

    // Create consumer to verify messages were published
    consumer = kafka.consumer({ groupId: 'test-consumer-group' });
    await consumer.connect();

    // Subscribe to both topics
    await consumer.subscribe({
      topics: ['dtm.jobs.completed', 'dtm.jobs.failed'],
      fromBeginning: false, // Only consume new messages
    });

    // Start consuming messages
    await consumer.run({
      // eslint-disable-next-line @typescript-eslint/require-await
      eachMessage: async ({ topic, message }) => {
        if (message.value) {
          consumedMessages.push({
            topic,
            message: JSON.parse(message.value.toString()),
          });
        }
      },
    });

    // Initialize producer
    producer = new KafkaProducerService({
      broker: KAFKA_BROKER,
      clientId: 'test-producer',
    });

    await producer.connect();
  }, TIMEOUT);

  afterAll(async () => {
    // Cleanup
    if (producer && producer.isProducerConnected()) {
      await producer.disconnect();
    }
    if (consumer) {
      await consumer.disconnect();
    }
    consumedMessages = [];
  }, TIMEOUT);

  beforeEach(() => {
    // Clear consumed messages before each test
    consumedMessages = [];
  });

  describe('Producer Connection', () => {
    it(
      'should connect to Kafka broker',
      () => {
        expect(producer.isProducerConnected()).toBe(true);
      },
      TIMEOUT,
    );

    it(
      'should return correct topic names',
      () => {
        const topics = producer.getTopics();
        expect(topics.transformed).toBe('dtm.jobs.completed');
        expect(topics.failed).toBe('dtm.jobs.failed');
      },
      TIMEOUT,
    );
  });

  describe('Publish to dtm.jobs.completed topic', () => {
    it(
      'should publish a transformed message successfully',
      async () => {
        const message: JobCompletedMessage = {
          eventId: 'test-event-123',
          jobId: 'job-456',
          transformedAt: new Date().toISOString(),
          data: {
            status: 'transformed',
            recordCount: 10,
          },
        };

        await producer.publishTransformed(message);

        // Wait for message to be consumed (with timeout)
        const maxWait = 10000; // 10 seconds
        const startTime = Date.now();
        while (consumedMessages.length === 0 && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verify message was consumed
        expect(consumedMessages.length).toBeGreaterThan(0);
        const consumed = consumedMessages.find((m) => m.topic === 'dtm.jobs.completed');
        expect(consumed).toBeDefined();
        expect(consumed?.message).toMatchObject({
          eventId: message.eventId,
          jobId: message.jobId,
        });
      },
      TIMEOUT,
    );

    it(
      'should publish multiple transformed messages',
      async () => {
        const messages: JobCompletedMessage[] = [
          {
            eventId: 'test-event-multi-1',
            jobId: 'job-1',
            transformedAt: new Date().toISOString(),
          },
          {
            eventId: 'test-event-multi-2',
            jobId: 'job-2',
            transformedAt: new Date().toISOString(),
          },
        ];

        for (const message of messages) {
          await producer.publishTransformed(message);
        }

        // Wait for messages to be consumed
        const maxWait = 10000;
        const startTime = Date.now();
        while (
          consumedMessages.filter((m) => m.topic === 'dtm.jobs.completed').length <
            messages.length &&
          Date.now() - startTime < maxWait
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verify all messages were consumed
        const transformedMessages = consumedMessages.filter(
          (m) => m.topic === 'dtm.jobs.completed',
        );
        expect(transformedMessages.length).toBeGreaterThanOrEqual(messages.length);

        messages.forEach((message) => {
          const consumed = transformedMessages.find(
            (m) => (m.message as JobCompletedMessage).eventId === message.eventId,
          );
          expect(consumed).toBeDefined();
        });
      },
      TIMEOUT,
    );
  });

  describe('Publish to dtm.jobs.failed topic', () => {
    it(
      'should publish a failed message successfully',
      async () => {
        const message: JobFailedMessage = {
          eventId: 'test-event-failed-123',
          jobId: 'job-456',
          failedAt: new Date().toISOString(),
          error: 'Test error message',
          stage: 'transform',
          data: {
            attempt: 1,
          },
        };

        await producer.publishFailed(message);

        // Wait for message to be consumed
        const maxWait = 10000;
        const startTime = Date.now();
        while (consumedMessages.length === 0 && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verify message was consumed
        expect(consumedMessages.length).toBeGreaterThan(0);
        const consumed = consumedMessages.find((m) => m.topic === 'dtm.jobs.failed');
        expect(consumed).toBeDefined();
        expect(consumed?.message).toMatchObject({
          eventId: message.eventId,
          jobId: message.jobId,
          error: message.error,
          stage: message.stage,
        });
      },
      TIMEOUT,
    );

    it(
      'should publish failed message with minimal required fields',
      async () => {
        const message: JobFailedMessage = {
          eventId: 'test-event-failed-minimal',
          jobId: 'job-min',
          failedAt: new Date().toISOString(),
          error: 'Minimal error',
        };

        await producer.publishFailed(message);

        // Wait for message to be consumed
        const maxWait = 10000;
        const startTime = Date.now();
        while (
          consumedMessages.filter((m) => m.topic === 'dtm.jobs.failed').length === 0 &&
          Date.now() - startTime < maxWait
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verify message was consumed
        const failedMessages = consumedMessages.filter((m) => m.topic === 'dtm.jobs.failed');
        expect(failedMessages.length).toBeGreaterThan(0);
        const consumed = failedMessages.find(
          (m) => (m.message as JobFailedMessage).eventId === message.eventId,
        );
        expect(consumed).toBeDefined();
      },
      TIMEOUT,
    );
  });

  describe('Error Handling', () => {
    it(
      'should throw error when publishing without connection',
      async () => {
        const disconnectedProducer = new KafkaProducerService({
          broker: KAFKA_BROKER,
          clientId: 'disconnected-producer',
        });

        const message: JobCompletedMessage = {
          eventId: 'test-error',
          jobId: 'job-error',
          transformedAt: new Date().toISOString(),
        };

        await expect(disconnectedProducer.publishTransformed(message)).rejects.toThrow(
          'Producer is not connected',
        );
      },
      TIMEOUT,
    );

    it(
      'should handle invalid broker gracefully',
      async () => {
        // Suppress expected error logs for this test (we're intentionally testing failure)
        const originalConsoleError = console.error;
        const originalConsoleWarn = console.warn;
        console.error = jest.fn();
        console.warn = jest.fn();

        try {
          const invalidProducer = new KafkaProducerService({
            broker: 'invalid-broker:9092',
            clientId: 'invalid-producer',
            retry: {
              retries: 1, // Minimum for idempotent producer (can't be 0)
              initialRetryTime: 50, // Fast failure
            },
          });

          // Test that connection fails
          await expect(invalidProducer.connect()).rejects.toThrow();

          // IMPORTANT: Cleanup to prevent open handles
          try {
            await invalidProducer.disconnect();
          } catch {
            // Ignore disconnect errors - producer may not be in a state to disconnect
          }
        } finally {
          // Restore console
          console.error = originalConsoleError;
          console.warn = originalConsoleWarn;
        }
      },
      TIMEOUT,
    );
  });

  describe('Message Format Validation', () => {
    it(
      'should publish and consume valid JSON messages',
      async () => {
        const message: JobCompletedMessage = {
          eventId: 'test-json-123',
          jobId: 'job-json',
          transformedAt: new Date().toISOString(),
          data: {
            nested: {
              object: {
                with: 'values',
                numbers: [1, 2, 3],
              },
            },
          },
        };

        await producer.publishTransformed(message);

        // Wait for message
        const maxWait = 10000;
        const startTime = Date.now();
        while (consumedMessages.length === 0 && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const consumed = consumedMessages.find((m) => m.topic === 'dtm.jobs.completed');
        expect(consumed).toBeDefined();
        const consumedMessage = consumed?.message as JobCompletedMessage;
        expect(consumedMessage.data).toBeDefined();
        expect(consumedMessage.data?.nested).toBeDefined();
        // Type assertion for nested object structure
        const nested = consumedMessage.data?.nested as
          | {
              object?: {
                with: string;
                numbers: number[];
              };
            }
          | undefined;
        const nestedObject = nested?.object;
        expect(nestedObject?.with).toBe('values');
        expect(nestedObject?.numbers).toEqual([1, 2, 3]);
      },
      TIMEOUT,
    );
  });
});
