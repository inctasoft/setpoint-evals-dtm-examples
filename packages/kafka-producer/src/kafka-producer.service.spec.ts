import { KafkaProducerService } from './kafka-producer.service';
import { Kafka, Producer } from 'kafkajs';
import { JobCompletedMessage, JobFailedMessage } from './types';

// Mock kafkajs
jest.mock('kafkajs');

describe('KafkaProducerService', () => {
  let service: KafkaProducerService;
  let mockProducer: jest.Mocked<Producer>;
  let mockKafka: jest.Mocked<Kafka>;

  beforeEach(() => {
    // Setup mock producer
    mockProducer = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue([{ topicName: 'test', partition: 0, errorCode: 0 }]),
    } as any;

    // Setup mock Kafka instance
    mockKafka = {
      producer: jest.fn().mockReturnValue(mockProducer),
    } as any;

    // Mock Kafka constructor
    (Kafka as jest.MockedClass<typeof Kafka>).mockImplementation(() => mockKafka);

    // Spy on console.error
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Constructor & Configuration', () => {
    it('should initialize with single broker string', () => {
      // Act
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        clientId: 'test-client',
      });

      // Assert
      expect(Kafka).toHaveBeenCalledWith({
        clientId: 'test-client',
        brokers: ['kafka:9092'],
        retry: { retries: 3, initialRetryTime: 100 },
      });
    });

    it('should initialize with multiple brokers (comma-separated)', () => {
      // Act
      service = new KafkaProducerService({
        broker: 'kafka1:9092, kafka2:9092, kafka3:9092',
        clientId: 'test-client',
      });

      // Assert
      expect(Kafka).toHaveBeenCalledWith({
        clientId: 'test-client',
        brokers: ['kafka1:9092', 'kafka2:9092', 'kafka3:9092'],
        retry: { retries: 3, initialRetryTime: 100 },
      });
    });

    it('should initialize with broker array', () => {
      // Act
      service = new KafkaProducerService({
        broker: ['kafka1:9092', 'kafka2:9092'],
        clientId: 'test-client',
      });

      // Assert
      expect(Kafka).toHaveBeenCalledWith({
        clientId: 'test-client',
        brokers: ['kafka1:9092', 'kafka2:9092'],
        retry: { retries: 3, initialRetryTime: 100 },
      });
    });

    it('should use default clientId if not provided', () => {
      // Act
      service = new KafkaProducerService({
        broker: 'kafka:9092',
      });

      // Assert
      expect(Kafka).toHaveBeenCalledWith({
        clientId: 'dtm-producer',
        brokers: ['kafka:9092'],
        retry: { retries: 3, initialRetryTime: 100 },
      });
    });

    it('should use custom retry configuration if provided', () => {
      // Act
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        retry: { retries: 5, initialRetryTime: 500 },
      });

      // Assert
      expect(Kafka).toHaveBeenCalledWith({
        clientId: 'dtm-producer',
        brokers: ['kafka:9092'],
        retry: { retries: 5, initialRetryTime: 500 },
      });
    });

    it('should configure producer with idempotent settings', () => {
      // Act
      service = new KafkaProducerService({
        broker: 'kafka:9092',
      });

      // Assert
      expect(mockKafka.producer).toHaveBeenCalledWith({
        allowAutoTopicCreation: false,
        idempotent: true,
        maxInFlightRequests: 1,
        transactionTimeout: 30000,
      });
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        clientId: 'test-client',
      });
    });

    it('should connect to Kafka broker', async () => {
      // Act
      await service.connect();

      // Assert
      expect(mockProducer.connect).toHaveBeenCalledTimes(1);
      expect(service.isProducerConnected()).toBe(true);
    });

    it('should not connect twice if already connected', async () => {
      // Act
      await service.connect();
      await service.connect(); // Second call

      // Assert
      expect(mockProducer.connect).toHaveBeenCalledTimes(1);
      expect(service.isProducerConnected()).toBe(true);
    });

    it('should throw error if connection fails', async () => {
      // Arrange
      mockProducer.connect.mockRejectedValue(new Error('Connection refused'));

      // Act & Assert
      await expect(service.connect()).rejects.toThrow('Failed to connect Kafka producer: Connection refused');
      expect(service.isProducerConnected()).toBe(false);
    });

    it('should disconnect from Kafka broker', async () => {
      // Arrange
      await service.connect();

      // Act
      await service.disconnect();

      // Assert
      expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
      expect(service.isProducerConnected()).toBe(false);
    });

    it('should not disconnect if not connected', async () => {
      // Act
      await service.disconnect();

      // Assert
      expect(mockProducer.disconnect).not.toHaveBeenCalled();
      expect(service.isProducerConnected()).toBe(false);
    });

    it('should handle disconnect errors gracefully', async () => {
      // Arrange
      await service.connect();
      mockProducer.disconnect.mockRejectedValue(new Error('Disconnect error'));

      // Act
      await service.disconnect();

      // Assert - Error logged but connection state remains true (error path)
      expect(console.error).toHaveBeenCalledWith('Error disconnecting Kafka producer: Disconnect error');
      expect(service.isProducerConnected()).toBe(true); // Still connected after error
    });
  });

  describe('publishTransformed', () => {
    beforeEach(async () => {
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        clientId: 'test-client',
      });
      await service.connect();
    });

    it('should publish transformed message to correct topic', async () => {
      // Arrange
      const message: JobCompletedMessage = {
        eventId: 'event-123',
        jobId: 'job-456',
        transformedAt: '2025-12-10T22:00:00Z',
      };

      // Act
      await service.publishTransformed(message);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'dtm.jobs.completed',
        messages: [
          {
            key: 'event-123',
            value: JSON.stringify(message),
            partition: undefined,
          },
        ],
      });
    });

    it('should publish transformed message with partition', async () => {
      // Arrange
      const message: JobCompletedMessage = {
        eventId: 'event-789',
        jobId: 'job-abc',
        transformedAt: '2025-12-10T22:00:00Z',
      };

      // Act
      await service.publishTransformed(message, 2);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'dtm.jobs.completed',
        messages: [
          {
            key: 'event-789',
            value: JSON.stringify(message),
            partition: 2,
          },
        ],
      });
    });

    it('should throw error if not connected', async () => {
      // Arrange
      await service.disconnect();
      const message: JobCompletedMessage = {
        eventId: 'event-123',
        jobId: 'job-456',

        transformedAt: '2025-12-10T22:00:00Z',
      };

      // Act & Assert
      await expect(service.publishTransformed(message)).rejects.toThrow(
        'Producer is not connected. Call connect() first.',
      );
    });

    it('should throw error if send fails', async () => {
      // Arrange
      mockProducer.send.mockRejectedValue(new Error('Broker unavailable'));
      const message: JobCompletedMessage = {
        eventId: 'event-123',
        jobId: 'job-456',

        transformedAt: '2025-12-10T22:00:00Z',
      };

      // Act & Assert
      await expect(service.publishTransformed(message)).rejects.toThrow(
        'Failed to publish to dtm.jobs.completed: Broker unavailable',
      );
    });
  });

  describe('publishFailed', () => {
    beforeEach(async () => {
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        clientId: 'test-client',
      });
      await service.connect();
    });

    it('should publish failed message to correct topic', async () => {
      // Arrange
      const message: JobFailedMessage = {
        eventId: 'event-error-123',
        jobId: 'job-error-456',

        error: 'Database connection failed',
        failedAt: '2025-12-10T22:00:00Z',
      };

      // Act
      await service.publishFailed(message);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'dtm.jobs.failed',
        messages: [
          {
            key: 'event-error-123',
            value: JSON.stringify(message),
            partition: undefined,
          },
        ],
      });
    });

    it('should publish failed message with partition', async () => {
      // Arrange
      const message: JobFailedMessage = {
        eventId: 'event-error-789',
        jobId: 'job-error-abc',

        error: 'Validation failed',
        failedAt: '2025-12-10T22:00:00Z',
      };

      // Act
      await service.publishFailed(message, 1);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'dtm.jobs.failed',
        messages: [
          {
            key: 'event-error-789',
            value: JSON.stringify(message),
            partition: 1,
          },
        ],
      });
    });

    it('should throw error if not connected', async () => {
      // Arrange
      await service.disconnect();
      const message: JobFailedMessage = {
        eventId: 'event-error-123',
        jobId: 'job-error-456',

        error: 'Error message',
        failedAt: '2025-12-10T22:00:00Z',
      };

      // Act & Assert
      await expect(service.publishFailed(message)).rejects.toThrow(
        'Producer is not connected. Call connect() first.',
      );
    });

    it('should throw error if send fails', async () => {
      // Arrange
      mockProducer.send.mockRejectedValue(new Error('Network error'));
      const message: JobFailedMessage = {
        eventId: 'event-error-123',
        jobId: 'job-error-456',

        error: 'Error message',
        failedAt: '2025-12-10T22:00:00Z',
      };

      // Act & Assert
      await expect(service.publishFailed(message)).rejects.toThrow(
        'Failed to publish to dtm.jobs.failed: Network error',
      );
    });
  });

  describe('publish (generic)', () => {
    beforeEach(async () => {
      service = new KafkaProducerService({
        broker: 'kafka:9092',
        clientId: 'test-client',
      });
      await service.connect();
    });

    it('should publish generic message to any topic', async () => {
      // Arrange
      const message = { customField: 'customValue', timestamp: Date.now() };

      // Act
      await service.publish('custom-topic', message);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'custom-topic',
        messages: [
          {
            key: undefined,
            value: JSON.stringify(message),
            partition: undefined,
            headers: undefined,
          },
        ],
      });
    });

    it('should publish generic message with key', async () => {
      // Arrange
      const message = { data: 'test' };

      // Act
      await service.publish('custom-topic', message, 'custom-key');

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'custom-topic',
        messages: [
          {
            key: 'custom-key',
            value: JSON.stringify(message),
            partition: undefined,
            headers: undefined,
          },
        ],
      });
    });

    it('should publish generic message with partition', async () => {
      // Arrange
      const message = { data: 'test' };

      // Act
      await service.publish('custom-topic', message, 'custom-key', 3);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'custom-topic',
        messages: [
          {
            key: 'custom-key',
            value: JSON.stringify(message),
            partition: 3,
            headers: undefined,
          },
        ],
      });
    });

    it('should publish generic message with headers', async () => {
      // Arrange
      const message = { data: 'test' };
      const headers = { 'x-correlation-id': 'corr-123', 'x-request-id': 'req-456' };

      // Act
      await service.publish('custom-topic', message, 'custom-key', 2, headers);

      // Assert
      expect(mockProducer.send).toHaveBeenCalledWith({
        topic: 'custom-topic',
        messages: [
          {
            key: 'custom-key',
            value: JSON.stringify(message),
            partition: 2,
            headers,
          },
        ],
      });
    });

    it('should throw error if not connected', async () => {
      // Arrange
      await service.disconnect();

      // Act & Assert
      await expect(service.publish('test-topic', { data: 'test' })).rejects.toThrow(
        'Producer is not connected. Call connect() first.',
      );
    });

    it('should throw error if send fails', async () => {
      // Arrange
      mockProducer.send.mockRejectedValue(new Error('Topic not found'));

      // Act & Assert
      await expect(service.publish('non-existent-topic', { data: 'test' })).rejects.toThrow(
        'Failed to publish to non-existent-topic: Topic not found',
      );
    });
  });

  describe('getTopics', () => {
    beforeEach(() => {
      service = new KafkaProducerService({
        broker: 'kafka:9092',
      });
    });

    it('should return configured topic names', () => {
      // Act
      const topics = service.getTopics();

      // Assert
      expect(topics).toEqual({
        transformed: 'dtm.jobs.completed',
        failed: 'dtm.jobs.failed',
      });
    });
  });

});

