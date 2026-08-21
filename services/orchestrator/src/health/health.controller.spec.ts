import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { KafkaHealthIndicator } from './kafka.health';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('HealthController', () => {
  let controller: HealthController;

  const mockHealthCheckService = {
    check: jest.fn(),
  };

  const mockDbHealthIndicator = {
    pingCheck: jest.fn(),
  };

  const mockKafkaHealthIndicator = {
    getProjectTopics: jest.fn(),
    isHealthy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDbHealthIndicator },
        { provide: KafkaHealthIndicator, useValue: mockKafkaHealthIndicator },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    dbHealthIndicator = module.get<TypeOrmHealthIndicator>(TypeOrmHealthIndicator);
    kafkaHealthIndicator = module.get<KafkaHealthIndicator>(KafkaHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return ok status', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.info.app.status).toBe('up');
    });
  });

  describe('getKafkaTopics', () => {
    it('should return kafka topics', async () => {
      const mockTopics = { topics: ['topic1'], details: [] };
      mockKafkaHealthIndicator.getProjectTopics.mockResolvedValue(mockTopics);

      const result = await controller.getKafkaTopics();

      expect(result.topics).toEqual(['topic1']);
    });

    it('should return 503 if kafka unavailable', async () => {
      mockKafkaHealthIndicator.getProjectTopics.mockRejectedValue(new Error('Kafka down'));

      await expect(controller.getKafkaTopics()).rejects.toThrow(HttpException);
      await expect(controller.getKafkaTopics()).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });
  });

  describe('readiness', () => {
    it('should return ready if DB is up', async () => {
      const mockDbResult = {
        status: 'ok',
        info: { database: { status: 'up' } },
        details: { database: { status: 'up' } },
      };
      const mockKafkaResult = { kafka: { status: 'up' } };

      mockHealthCheckService.check.mockResolvedValue(mockDbResult);
      mockKafkaHealthIndicator.isHealthy.mockResolvedValue(mockKafkaResult);

      const result = await controller.readiness();

      expect(result.status).toBe('ok');
      expect(result.details.database.status).toBe('up');
      expect(result.details.kafka.status).toBe('up');
    });

    it('should throw 503 if DB is down', async () => {
      const mockDbResult = {
        status: 'error',
        info: { database: { status: 'down' } },
        details: { database: { status: 'down' } },
      };

      mockHealthCheckService.check.mockResolvedValue(mockDbResult);

      await expect(controller.readiness()).rejects.toThrow(HttpException);
    });

    it('should not fail if Kafka is down (graceful degradation)', async () => {
      const mockDbResult = {
        status: 'ok',
        info: { database: { status: 'up' } },
        details: { database: { status: 'up' } },
      };

      mockHealthCheckService.check.mockResolvedValue(mockDbResult);
      mockKafkaHealthIndicator.isHealthy.mockRejectedValue(new Error('Kafka down'));

      const result = await controller.readiness();

      expect(result.status).toBe('ok');
      expect(result.details.database.status).toBe('up');
      expect(result.details.kafka.status).toBe('down');
    });
  });
});
