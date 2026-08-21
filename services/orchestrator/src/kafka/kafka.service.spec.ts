import { Test, TestingModule } from '@nestjs/testing';
import { KafkaService } from './kafka.service';
import { KafkaProducerService } from '@dtm/kafka-producer';
import { ConfigService } from '@nestjs/config';
import { CorrelationService } from '../common/correlation/correlation.service';

// Mock the entire module
jest.mock('@dtm/kafka-producer', () => {
  return {
    KafkaProducerService: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isProducerConnected: jest.fn().mockReturnValue(true),
      publish: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('KafkaService', () => {
  let service: KafkaService;

  const mockCorrelationService = {
    getCorrelationId: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'kafka.broker') return process.env.KAFKA_BROKER || undefined;
      if (key === 'kafka.producerClientId') return 'dtm-orchestrator';
      return undefined;
    }),
  };

  beforeEach(async () => {
    // Reset environment variables
    process.env.KAFKA_BROKER = 'kafka:9092';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaService,
        { provide: CorrelationService, useValue: mockCorrelationService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<KafkaService>(KafkaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.KAFKA_BROKER;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should connect producer if KAFKA_BROKER is set', async () => {
      await service.onModuleInit();
      expect(KafkaProducerService).toHaveBeenCalled();
      expect(service.isConnected()).toBe(true);
    });

    it('should not connect producer if KAFKA_BROKER is not set', async () => {
      delete process.env.KAFKA_BROKER;
      // Re-create service to trigger init logic
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KafkaService,
          { provide: CorrelationService, useValue: mockCorrelationService },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      const localService = module.get<KafkaService>(KafkaService);

      await localService.onModuleInit();
      expect(localService.isConnected()).toBe(false);
    });
  });

  describe('publish', () => {
    it('should publish message with correlation ID', async () => {
      await service.onModuleInit(); // Ensure connected
      mockCorrelationService.getCorrelationId.mockReturnValue('test-correlation-id');

      const result = await service.publish('test-topic', { foo: 'bar' });

      expect(result).toBe(true);
      // Get the mocked instance
      const mockProducer = (service as any).kafkaProducer;
      expect(mockProducer.publish).toHaveBeenCalledWith(
        'test-topic',
        { foo: 'bar' },
        undefined,
        undefined,
        { 'x-correlation-id': 'test-correlation-id' },
      );
    });

    it('should return false if producer not connected', async () => {
      // Don't init
      const result = await service.publish('test-topic', { foo: 'bar' });
      expect(result).toBe(false);
    });
  });
});
