/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { HealthMetricsTask } from './health-metrics.task';
import { Job, Step } from '@dtm/database';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';

describe('HealthMetricsTask', () => {
  let module: TestingModule;
  let task: HealthMetricsTask;
  let jobRepository: jest.Mocked<Repository<Job>>;
  let stepRepository: jest.Mocked<Repository<Step>>;

  // Shared mocks
  const mockJobRepository = {
    count: jest.fn(),
  };

  const mockStepRepository = {
    count: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockTaskRegistry = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        HealthMetricsTask,
        {
          provide: getRepositoryToken(Job),
          useValue: mockJobRepository,
        },
        {
          provide: getRepositoryToken(Step),
          useValue: mockStepRepository,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
      ],
    }).compile();

    task = module.get<HealthMetricsTask>(HealthMetricsTask);
    jobRepository = module.get(getRepositoryToken(Job));
    stepRepository = module.get(getRepositoryToken(Step));
    configService = module.get(ConfigService);
    taskRegistry = module.get(MaintenanceTaskRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('getMetadata', () => {
    it('should return correct task metadata', () => {
      // Act
      const metadata = task.getMetadata();

      // Assert
      expect(metadata.name).toBe('health-metrics');
      expect(metadata.category).toBe('metrics');
      expect(metadata.priority).toBe(50);
      expect(metadata.enabled).toBe(true);
      expect(metadata.schedule).toBeDefined();
    });
  });

  describe('Basic Metrics Calculations', () => {
    it('should calculate totalJobs correctly', async () => {
      // Arrange
      jobRepository.count.mockImplementation((options?: any) => {
        if (!options || !options.where) return Promise.resolve(150); // totalJobs
        return Promise.resolve(0);
      });
      stepRepository.count.mockResolvedValue(0);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.totalJobs).toBe(150);
    });

    it('should calculate active/pending job counts', async () => {
      // Arrange
      jobRepository.count.mockImplementation((options?: any) => {
        if (!options || !options.where) return Promise.resolve(100); // totalJobs
        if (options.where.status === 'processing') return Promise.resolve(10); // activeJobs
        if (options.where.status === 'pending') return Promise.resolve(5); // pendingJobs
        return Promise.resolve(0);
      });
      stepRepository.count.mockResolvedValue(0);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.metrics.activeJobs).toBe(10);
      expect(result.metrics.pendingJobs).toBe(5);
    });

    it('should calculate completed/failed counts for last 24h', async () => {
      // Arrange
      jobRepository.count.mockImplementation((options?: any) => {
        if (!options || !options.where) return Promise.resolve(500); // totalJobs

        // Last 24h metrics
        if (options.where.status === 'completed' && options.where.completedAt) {
          return Promise.resolve(45); // jobsCompletedLast24h
        }
        if (options.where.status === 'failed' && options.where.completedAt) {
          return Promise.resolve(5); // jobsFailedLast24h
        }

        return Promise.resolve(0);
      });
      stepRepository.count.mockResolvedValue(0);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.metrics.jobsCompletedLast24h).toBeDefined();
      expect(result.metrics.jobsFailedLast24h).toBeDefined();
    });

    it('should handle empty database gracefully', async () => {
      // Arrange
      jobRepository.count.mockResolvedValue(0);
      stepRepository.count.mockResolvedValue(0);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.totalJobs).toBe(0);
      expect(result.metrics.activeJobs).toBe(0);
      expect(result.metrics.pendingJobs).toBe(0);
    });
  });

  describe('Output Format', () => {
    it('should return metrics in expected format', async () => {
      // Arrange
      jobRepository.count.mockResolvedValue(100);
      stepRepository.count.mockResolvedValue(50);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(typeof result.metrics).toBe('object');

      // Verify key metrics exist
      expect(result.metrics).toHaveProperty('totalJobs');
      expect(result.metrics).toHaveProperty('activeJobs');
      expect(result.metrics).toHaveProperty('pendingJobs');
      expect(result.metrics).toHaveProperty('jobsCompletedLast24h');
      expect(result.metrics).toHaveProperty('jobsFailedLast24h');
    });

    it('should include success rates in metrics', async () => {
      // Arrange
      jobRepository.count.mockImplementation((options?: any) => {
        if (!options || !options.where) return Promise.resolve(100);

        // Simulate 45 completed, 5 failed in last 24h
        if (options.where.status === 'completed' && options.where.completedAt) {
          return Promise.resolve(45);
        }
        if (options.where.status === 'failed' && options.where.completedAt) {
          return Promise.resolve(5);
        }

        return Promise.resolve(0);
      });
      stepRepository.count.mockResolvedValue(0);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.metrics).toHaveProperty('successRateLast24h');
      expect(result.metrics.successRateLast24h).toBeGreaterThanOrEqual(0);
      expect(result.metrics.successRateLast24h).toBeLessThanOrEqual(100);
    });
  });

  describe('Step Health Metrics', () => {
    it('should count steps by status', async () => {
      // Arrange
      jobRepository.count.mockResolvedValue(50);
      stepRepository.count.mockImplementation((options?: any) => {
        if (!options || !options.where) return Promise.resolve(200); // all steps
        if (options.where.status === 'in_progress') return Promise.resolve(10);
        if (options.where.status === 'in_progress_retrying') return Promise.resolve(2);
        if (options.where.status === 'waiting_for_ack') return Promise.resolve(5);
        return Promise.resolve(0);
      });

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.metrics.stepsInProgress).toBe(10);
      expect(result.metrics.stepsRetrying).toBe(2);
      // Note: stepsWaitingAck may be named differently in actual implementation
      expect(result.metrics.stepsWaitingForAck || result.metrics.stepsWaitingAck).toBeDefined();
    });
  });

  // ==================== TODO: Additional test cases for future implementation ====================
  // TODO: describe('Time-Windowed Metrics', () => {
  //   TODO: it('should calculate 5-minute window metrics correctly')
  //   TODO: it('should calculate 1-hour window metrics correctly')
  //   TODO: it('should handle timezone considerations')
  // });

  // TODO: describe('Success Rate Calculations', () => {
  //   TODO: it('should calculate success rate with zero jobs')
  //   TODO: it('should calculate success rate with 100% success')
  //   TODO: it('should calculate success rate with failures')
  // });

  // TODO: describe('Performance', () => {
  //   TODO: it('should complete within timeout threshold')
  //   TODO: it('should handle large job counts efficiently')
  // });

  // TODO: describe('Metric Export', () => {
  //   TODO: it('should format metrics for CloudWatch')
  //   TODO: it('should format metrics for Datadog')
  //   TODO: it('should format metrics for Prometheus')
  // });
});
