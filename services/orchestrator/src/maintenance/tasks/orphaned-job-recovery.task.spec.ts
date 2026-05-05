import { Test, TestingModule } from '@nestjs/testing';
import { OrphanedJobRecoveryTask } from './orphaned-job-recovery.task';
import { Job, Step, JobStatus, StepStatus } from '@dtm/database';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { OrchestrationService } from '../../orchestration/orchestration.service';

describe('OrphanedJobRecoveryTask', () => {
  let module: TestingModule;
  let task: OrphanedJobRecoveryTask;
  let jobRepository: jest.Mocked<Repository<Job>>;
  let orchestrationService: jest.Mocked<OrchestrationService>;

  // Shared mocks
  const mockJobRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockStepRepository = {
    find: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockTaskRegistry = {
    register: jest.fn(),
  };

  const mockOrchestrationService = {
    continueJob: jest.fn(),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        OrphanedJobRecoveryTask,
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
        { provide: OrchestrationService, useValue: mockOrchestrationService },
      ],
    }).compile();

    task = module.get<OrphanedJobRecoveryTask>(OrphanedJobRecoveryTask);
    jobRepository = module.get(getRepositoryToken(Job));
    stepRepository = module.get(getRepositoryToken(Step));
    configService = module.get(ConfigService);
    taskRegistry = module.get(MaintenanceTaskRegistry);
    orchestrationService = module.get(OrchestrationService);
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
      expect(metadata).toEqual({
        name: 'orphaned-job-recovery',
        description: 'Recovers jobs stuck in PROCESSING state despite all steps being terminal',
        schedule: '0 */10 * * * *', // EVERY_10_MINUTES
        priority: 90,
        category: 'recovery',
        timeoutMs: 120000,
        enabled: true,
      });
    });
  });

  describe('Detection Logic', () => {
    it('should detect jobs in PROCESSING with all steps terminal', async () => {
      // Arrange
      const orphanedJob: Partial<Job> = {
        id: 'job-123',
        status: JobStatus.PROCESSING,
        submittedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
        steps: [
          { id: 'step-1', status: StepStatus.COMPLETED } as Step,
          { id: 'step-2', status: StepStatus.COMPLETED } as Step,
          { id: 'step-3', status: StepStatus.FAILED } as Step,
          { id: 'step-4', status: StepStatus.SKIPPED } as Step,
        ],
      };

      jobRepository.find.mockResolvedValue([orphanedJob]);
      jobRepository.findOne.mockResolvedValue({
        ...orphanedJob,
        status: JobStatus.FAILED,
      } as Job);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert
      expect(jobRepository.find).toHaveBeenCalledWith({
        where: { status: JobStatus.PROCESSING },
        relations: ['steps'],
      });
      expect(result.success).toBe(true);
      expect(result.metrics.orphanedJobsFound).toBe(1);
      expect(result.metrics.recovered).toBe(1);
    });

    it('should ignore jobs with some steps still active', async () => {
      // Arrange
      const activeJob: Partial<Job> = {
        id: 'job-active',
        status: JobStatus.PROCESSING,
        submittedAt: new Date(),
        steps: [
          { id: 'step-1', status: StepStatus.COMPLETED } as Step,
          { id: 'step-2', status: StepStatus.IN_PROGRESS } as Step, // ACTIVE!
          { id: 'step-3', status: StepStatus.PENDING } as Step,
        ],
      };

      jobRepository.find.mockResolvedValue([activeJob]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.orphanedJobsFound).toBe(0);
      expect(result.metrics.recovered).toBe(0);
      // Orchestration should NOT be triggered for legitimately active jobs
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should handle zero processing jobs gracefully', async () => {
      // Arrange
      jobRepository.find.mockResolvedValue([]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('No jobs in PROCESSING state');
      expect(result.metrics.orphanedJobsFound).toBe(0);
      expect(result.metrics.recovered).toBe(0);
      expect(result.metrics.failed).toBe(0);
    });
  });

  describe('Recovery Behavior', () => {
    it('should trigger orchestration for orphaned job', async () => {
      // Arrange
      const orphanedJob: Partial<Job> = {
        id: 'job-recovery',
        status: JobStatus.PROCESSING,
        submittedAt: new Date(Date.now() - 15 * 60 * 1000),
        steps: [
          { id: 'step-1', status: StepStatus.COMPLETED } as Step,
          { id: 'step-2', status: StepStatus.COMPLETED } as Step,
        ],
      };

      jobRepository.find.mockResolvedValue([orphanedJob]);
      jobRepository.findOne.mockResolvedValue({
        ...orphanedJob,
        status: JobStatus.COMPLETED,
      } as Job);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      await task['execute']();

      // Assert - Verify orchestration was triggered
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-recovery');
      expect(orchestrationService.continueJob).toHaveBeenCalledTimes(1);

      // Verify job status was fetched after recovery
      expect(jobRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'job-recovery' },
      });
    });

    it('should handle orchestration errors gracefully', async () => {
      // Arrange
      const orphanedJob: Partial<Job> = {
        id: 'job-error',
        status: JobStatus.PROCESSING,
        submittedAt: new Date(),
        steps: [{ id: 'step-1', status: StepStatus.COMPLETED } as Step],
      };

      jobRepository.find.mockResolvedValue([orphanedJob]);
      orchestrationService.continueJob.mockRejectedValue(
        new Error('Orchestration service unavailable'),
      );

      // Act
      const result = await task['execute']();

      // Assert - Task should report failure but not throw
      expect(result.success).toBe(false); // Success is false when recovery fails
      expect(result.metrics.orphanedJobsFound).toBe(1);
      expect(result.metrics.recovered).toBe(0);
      expect(result.metrics.failed).toBe(1);
      expect(result.actions[0].type).toBe('auto-fix');
      expect(result.actions[0].result).toBe('failed');
      expect(result.actions[0].description).toContain('Orchestration service unavailable');
    });
  });

  describe('Finding Details', () => {
    it('should include step breakdown in findings', async () => {
      // Arrange
      const orphanedJob: Partial<Job> = {
        id: 'job-detailed',
        status: JobStatus.PROCESSING,
        submittedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
        steps: [
          { id: 'step-1', status: StepStatus.COMPLETED } as Step,
          { id: 'step-2', status: StepStatus.COMPLETED } as Step,
          { id: 'step-3', status: StepStatus.FAILED } as Step,
          { id: 'step-4', status: StepStatus.SKIPPED } as Step,
          { id: 'step-5', status: StepStatus.SKIPPED } as Step,
        ],
      };

      jobRepository.find.mockResolvedValue([orphanedJob]);
      jobRepository.findOne.mockResolvedValue({
        ...orphanedJob,
        status: JobStatus.FAILED,
      } as Job);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.findings[0].description).toContain('Job orphaned');
      expect(result.findings[0].context).toEqual({
        jobId: 'job-detailed',
        totalSteps: 5,
        completed: 2,
        failed: 1,
        skipped: 2,
        submittedAt: expect.any(Date),
        ageMinutes: 20,
      });
    });
  });

  describe('Multiple Jobs', () => {
    it('should process multiple orphaned jobs correctly', async () => {
      // Arrange
      const orphanedJobs: Partial<Job>[] = [
        {
          id: 'job-1',
          status: JobStatus.PROCESSING,
          submittedAt: new Date(),
          steps: [{ id: 'step-1', status: StepStatus.COMPLETED } as Step],
        },
        {
          id: 'job-2',
          status: JobStatus.PROCESSING,
          submittedAt: new Date(),
          steps: [{ id: 'step-2', status: StepStatus.FAILED } as Step],
        },
      ];

      jobRepository.find.mockResolvedValue(orphanedJobs);
      jobRepository.findOne.mockResolvedValue({ status: JobStatus.COMPLETED } as Job);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.orphanedJobsFound).toBe(2);
      expect(result.metrics.recovered).toBe(2);
      expect(orchestrationService.continueJob).toHaveBeenCalledTimes(2);
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-1');
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-2');
    });

    it('should continue processing if one job recovery fails', async () => {
      // Arrange
      const orphanedJobs: Partial<Job>[] = [
        {
          id: 'job-success',
          status: JobStatus.PROCESSING,
          submittedAt: new Date(),
          steps: [{ id: 'step-1', status: StepStatus.COMPLETED } as Step],
        },
        {
          id: 'job-fail',
          status: JobStatus.PROCESSING,
          submittedAt: new Date(),
          steps: [{ id: 'step-2', status: StepStatus.COMPLETED } as Step],
        },
      ];

      jobRepository.find.mockResolvedValue(orphanedJobs);
      jobRepository.findOne.mockResolvedValue({ status: JobStatus.COMPLETED } as Job);

      // First call succeeds, second fails
      orchestrationService.continueJob
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Recovery failed'));

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(false); // Overall success is false due to one failure
      expect(result.metrics.orphanedJobsFound).toBe(2);
      expect(result.metrics.recovered).toBe(1);
      expect(result.metrics.failed).toBe(1);
      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].result).toBe('success');
      expect(result.actions[1].result).toBe('failed');
    });
  });

  // ==================== TODO: Additional test cases for future implementation ====================
  // TODO: describe('Edge Cases', () => {
  //   TODO: it('should handle jobs with no steps gracefully')
  //   TODO: it('should handle database query failures')
  //   TODO: it('should handle jobs in other terminal states (already completed/failed)')
  //   TODO: it('should handle missing job after recovery attempt')
  // });

  // TODO: describe('Performance', () => {
  //   TODO: it('should handle large numbers of orphaned jobs efficiently')
  //   TODO: it('should respect task timeout configuration')
  // });
});
