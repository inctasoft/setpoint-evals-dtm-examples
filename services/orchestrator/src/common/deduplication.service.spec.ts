import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DeduplicationService } from './deduplication.service';
import { JobRepository, Job, JobType, JobStatus } from '@dtm/database';

describe('DeduplicationService', () => {
  let service: DeduplicationService;
  let mockJobRepository: jest.Mocked<JobRepository>;

  beforeEach(async () => {
    mockJobRepository = {
      findRecentJobs: jest.fn(),
    } as jest.Mocked<JobRepository>;

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'app.features.enableDeduplication')
          return process.env.ENABLE_DEDUPLICATION === 'true';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeduplicationService,
        {
          provide: JobRepository,
          useValue: mockJobRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DeduplicationService>(DeduplicationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should return true when ENABLE_DEDUPLICATION is "true"', () => {
      process.env.ENABLE_DEDUPLICATION = 'true';
      expect(service.isEnabled()).toBe(true);
    });

    it('should return false when ENABLE_DEDUPLICATION is not set', () => {
      delete process.env.ENABLE_DEDUPLICATION;
      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when ENABLE_DEDUPLICATION is "false"', () => {
      process.env.ENABLE_DEDUPLICATION = 'false';
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('findExistingJob', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const createMockJob = (overrides: Partial<Job> = {}): Job => ({
      id: 'test-job-id',
      type: JobType.DEFAULT,
      status: JobStatus.PROCESSING,
      submittedAt: new Date(),
      submittedBy: 'api',
      payload: {},
      updatedAt: new Date(),
      completedAt: null,
      results: null,
      steps: [],
      ...overrides,
    });

    it('should return null when deduplication is disabled', async () => {
      process.env.ENABLE_DEDUPLICATION = 'false';
      mockJobRepository.findRecentJobs.mockResolvedValue([]);

      const result = await service.findExistingJob('12345', 'api');

      expect(result).toBeNull();
      expect(mockJobRepository.findRecentJobs).not.toHaveBeenCalled();
    });

    it('should return null when no matching jobs found', async () => {
      process.env.ENABLE_DEDUPLICATION = 'true';
      mockJobRepository.findRecentJobs.mockResolvedValue([]);

      const result = await service.findExistingJob('12345', 'api');

      expect(result).toBeNull();
    });

    it('should return null for jobs submitted before today', async () => {
      process.env.ENABLE_DEDUPLICATION = 'true';
      const oldJob = createMockJob({
        submittedAt: yesterday,
        payload: { deduplicationKey: 'ENT-12345' },
      });

      mockJobRepository.findRecentJobs.mockResolvedValue([oldJob]);

      const result = await service.findExistingJob('ENT-12345', 'api');

      expect(result).toBeNull();
    });

    describe('Kafka-triggered jobs', () => {
      it('should find existing Kafka job by consumerId and eventType', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'kafka-consumer-created',
          payload: {
            _trigger: {
              consumerId: 'consumer-123',
              topic: 'dtm.test.created',
            },
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('consumer-123', 'kafka-consumer-created', {
          eventType: 'created',
        });

        expect(result).toEqual(existingJob);
      });

      it('should not match different consumerId', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'kafka-consumer-created',
          payload: {
            _trigger: {
              consumerId: 'consumer-456',
              topic: 'dtm.test.event',
            },
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('consumer-123', 'kafka-consumer-created', {
          eventType: 'created',
        });

        expect(result).toBeNull();
      });

      it('should not match different eventType', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'kafka-consumer-created',
          payload: {
            _trigger: {
              consumerId: 'consumer-123',
              topic: 'dtm.test.event',
            },
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('consumer-123', 'kafka-consumer-updated', {
          eventType: 'updated',
        });

        expect(result).toBeNull();
      });

      it('should handle jobs without _trigger metadata', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'kafka-consumer-created',
          payload: { deduplicationKey: 'ENT-123' }, // No _trigger field
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('consumer-123', 'kafka-consumer-created', {
          eventType: 'created',
        });

        expect(result).toBeNull();
      });
    });

    describe('API-triggered jobs', () => {
      it('should find existing API job by deduplicationKey', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: {
            deduplicationKey: 'ENT-12345',
            groupId: 'GROUP-123',
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api', {
          groupId: 'GROUP-123',
        });

        expect(result).toEqual(existingJob);
      });

      it('should find existing API job by deduplicationKey without additional context', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: {
            deduplicationKey: 'ENT-12345',
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api');

        expect(result).toEqual(existingJob);
      });

      it('should not match when additional context field is different', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: {
            deduplicationKey: 'ENT-12345',
            groupId: 'GROUP-456',
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api', {
          groupId: 'GROUP-123',
        });

        expect(result).toBeNull();
      });

      it('should match when additional context is not provided', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: {
            deduplicationKey: 'ENT-12345',
            groupId: 'GROUP-456',
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api');

        expect(result).toEqual(existingJob);
      });

      it('should not match when deduplicationKey does not match', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: {
            deduplicationKey: 'ENT-99999',
            groupId: 'GROUP-123',
          },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api', {
          groupId: 'GROUP-123',
        });

        expect(result).toBeNull();
      });

      it('should handle jobs without payload', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const existingJob = createMockJob({
          submittedBy: 'api',
          payload: null as unknown as Record<string, unknown>,
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

        const result = await service.findExistingJob('ENT-12345', 'api');

        expect(result).toBeNull();
      });
    });

    describe('Multiple jobs scenarios', () => {
      it('should return the first matching job', async () => {
        process.env.ENABLE_DEDUPLICATION = 'true';
        const job1 = createMockJob({
          id: 'job-1',
          submittedBy: 'api',
          payload: { deduplicationKey: 'ENT-12345', groupId: 'GROUP-123' },
        });
        const job2 = createMockJob({
          id: 'job-2',
          submittedBy: 'api',
          payload: { deduplicationKey: 'ENT-12345', groupId: 'GROUP-123' },
        });

        mockJobRepository.findRecentJobs.mockResolvedValue([job1, job2]);

        const result = await service.findExistingJob('ENT-12345', 'api', {
          groupId: 'GROUP-123',
        });

        expect(result).toEqual(job1);
      });
    });
  });

  describe('isDuplicate', () => {
    it('should return true when duplicate is found', async () => {
      process.env.ENABLE_DEDUPLICATION = 'true';
      const existingJob: Job = {
        id: 'existing-job',
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
        submittedAt: new Date(),
        submittedBy: 'api',
        payload: { deduplicationKey: 'ENT-12345' },
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      };

      mockJobRepository.findRecentJobs.mockResolvedValue([existingJob]);

      const result = await service.isDuplicate('ENT-12345', 'api');

      expect(result).toBe(true);
    });

    it('should return false when no duplicate is found', async () => {
      process.env.ENABLE_DEDUPLICATION = 'true';
      mockJobRepository.findRecentJobs.mockResolvedValue([]);

      const result = await service.isDuplicate('ENT-12345', 'api');

      expect(result).toBe(false);
    });
  });
});
