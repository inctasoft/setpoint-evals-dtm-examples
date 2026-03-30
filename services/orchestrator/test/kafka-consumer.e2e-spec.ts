import { Kafka, Producer, Admin } from 'kafkajs';
import { KafkaConsumerService } from '@dtm/kafka-consumer';

/**
 * Kafka Consumer Integration Tests
 *
 * These tests verify that the Kafka consumer infrastructure can:
 * - Connect to Kafka broker
 * - Subscribe to topics
 * - Consume messages
 * - Handle messages correctly
 * - Process errors gracefully
 *
 * Prerequisites:
 * - Kafka broker must be running (via docker-compose)
 * - Topics will be created automatically if they don't exist
 *
 * Usage:
 *   KAFKA_BROKER=localhost:9092 npm run test:e2e
 */

const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const TIMEOUT = 30000; // 30 seconds for Kafka operations
const TEST_GROUP_ID = `kafka-consumer-test-${Date.now()}`;

describe('Kafka Consumer (E2E)', () => {
  let kafka: Kafka;
  let producer: Producer;
  let admin: Admin;
  let consumerService: KafkaConsumerService;

  const TEST_TOPICS = {
    topic1: `test.dtm.event.a.${Date.now()}`,
    topic2: `test.dtm.event.b.${Date.now()}`,
  };

  beforeAll(async () => {
    // Initialize Kafka client
    kafka = new Kafka({
      clientId: 'kafka-consumer-e2e-test',
      brokers: KAFKA_BROKER.split(',').map((b) => b.trim()),
    });

    // Create admin client to manage topics
    admin = kafka.admin();
    await admin.connect();

    // Create test topics
    await admin.createTopics({
      topics: [
        {
          topic: TEST_TOPICS.topic1,
          numPartitions: 3,
          replicationFactor: 1,
        },
        {
          topic: TEST_TOPICS.topic2,
          numPartitions: 3,
          replicationFactor: 1,
        },
      ],
    });

    // Wait for topics to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create producer for sending test messages
    producer = kafka.producer();
    await producer.connect();

    // Initialize consumer service
    consumerService = new KafkaConsumerService({
      broker: KAFKA_BROKER,
      groupId: TEST_GROUP_ID,
      clientId: 'test-consumer',
    });
  }, TIMEOUT);

  afterAll(async () => {
    // Cleanup
    if (consumerService) {
      await consumerService.disconnect();
    }
    if (producer) {
      await producer.disconnect();
    }
    if (admin) {
      // Delete test topics
      try {
        await admin.deleteTopics({
          topics: [TEST_TOPICS.topic1, TEST_TOPICS.topic2],
        });
      } catch {
        // Ignore errors during cleanup
      }
      await admin.disconnect();
    }
  }, TIMEOUT);

  describe('Consumer Connection', () => {
    it(
      'should connect to Kafka broker',
      async () => {
        await consumerService.connect();
        expect(consumerService.isConsumerConnected()).toBe(true);
      },
      TIMEOUT,
    );
  });

  describe('Handler Registration', () => {
    it('should register handlers successfully', () => {
      const mockHandler = { handleMessage: jest.fn() };
      consumerService.registerHandler(TEST_TOPICS.topic1, mockHandler as any);
      consumerService.registerHandler(TEST_TOPICS.topic2, mockHandler as any);
      // No error means success
    });
  });

  describe('Topic Subscription', () => {
    it(
      'should subscribe to topics successfully',
      async () => {
        await consumerService.subscribe({
          topic: TEST_TOPICS.topic1,
          fromBeginning: true,
        });
        await consumerService.subscribe({
          topic: TEST_TOPICS.topic2,
          fromBeginning: true,
        });
      },
      TIMEOUT,
    );

    it(
      'should start consuming messages',
      async () => {
        await consumerService.startConsuming();
      },
      TIMEOUT,
    );
  });

  describe('Message Consumption', () => {
    it(
      'should consume and process a message',
      async () => {
        const testMessage = {
          id: 'test-event-e2e-001',
          type: 'test.event',
          payload: { value: 42 },
          timestamp: new Date().toISOString(),
        };

        // Create a handler that we can observe
        const mockHandler = { handleMessage: jest.fn() };
        consumerService.registerHandler(TEST_TOPICS.topic1, mockHandler as any);

        // Send message
        await producer.send({
          topic: TEST_TOPICS.topic1,
          messages: [
            {
              key: testMessage.id,
              value: JSON.stringify(testMessage),
            },
          ],
        });

        // Wait for message to be consumed
        const maxWait = 10000;
        const startTime = Date.now();
        while (!mockHandler.handleMessage.mock.calls.length && Date.now() - startTime < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verify handler was called
        expect(mockHandler.handleMessage).toHaveBeenCalled();
        const payload = mockHandler.handleMessage.mock.calls[0][0];
        expect(payload.topic).toBe(TEST_TOPICS.topic1);

        const messageValue = JSON.parse(payload.message.value?.toString() || '{}');
        expect(messageValue.id).toBe(testMessage.id);
      },
      TIMEOUT,
    );
  });
});
