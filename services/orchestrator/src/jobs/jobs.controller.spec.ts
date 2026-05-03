import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobRepository, StepRepository, StepStatus } from '@dtm/database';
import { NotFoundException } from '@nestjs/common';
import { WorkflowConfigService } from '../workflow-loader/workflow-config.service';

describe('JobsController', () => {
  let controller: JobsController;

  const mockJobRepo = {
    findById: jest.fn(),
    findRecentJobs: jest.fn(),
  };

  const mockStepRepo = {
    findByJobId: jest.fn(),
  };

  const mockWorkflowConfigService = {
    getStepName: jest.fn().mockImplementation((step: string) => step.toLowerCase()),
    getStepDefinitions: jest.fn().mockReturnValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: StepRepository, useValue: mockStepRepo },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
      ],
    }).compile();

    controller = module.get<JobsController>(JobsController);
    jobRepo = module.get<JobRepository>(JobRepository);
    stepRepo = module.get<StepRepository>(StepRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getEventStatus', () => {
    it('should return event status', async () => {
      const jobId = '123';
      const mockJob = {
        id: jobId,
        status: 'processing',
        payload: { customerId: 'CUST123' },
        submittedAt: new Date(),
      };
      const mockSteps = [
        { status: StepStatus.COMPLETED, stepValue: 'ValidateCustomer' },
        { status: StepStatus.IN_PROGRESS, stepValue: 'SubmitCustomer' },
      ];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getEventStatus(jobId);

      expect(result.jobId).toBe(jobId);
      expect(result.status).toBe('IN_PROGRESS'); // Mapped from 'processing'
      expect(result.currentStep).toBe('submitcustomer');
    });

    it('should throw NotFoundException if job not found', async () => {
      mockJobRepo.findById.mockResolvedValue(null);
      await expect(controller.getEventStatus('123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getEventProgress', () => {
    it('should return progress', async () => {
      const jobId = '123';
      const mockJob = {
        id: jobId,
        status: 'processing',
        payload: { customerId: 'CUST123' },
        submittedAt: new Date(),
      };
      const mockSteps = [
        { status: StepStatus.COMPLETED, stepValue: 'ValidateCustomer' },
        { status: StepStatus.COMPLETED, stepValue: 'SubmitCustomer' },
        { status: StepStatus.PENDING, stepValue: 'ValidateOrder' },
        { status: StepStatus.PENDING, stepValue: 'SubmitOrder' },
      ];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getEventProgress(jobId);

      expect(result.progress.percentComplete).toBe(50);
      expect(result.progress.completedSteps).toBe(2);
      expect(result.progress.totalSteps).toBe(4);
    });
  });

  describe('getJobDetails', () => {
    it('should return full job details', async () => {
      const jobId = '123';
      const mockJob = {
        id: jobId,
        status: 'completed',
        results: {
          totalRecordsProcessed: 10,
          totalRecordsFailed: 0,
          stepsCompleted: 4,
          stepsFailed: 0,
          stepsAborted: 0,
          durationMs: 1000,
        },
      };
      const mockSteps = [];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getJobDetails(jobId);

      expect(result.id).toBe(jobId);
      expect(result.result).toBeDefined();
      expect(result.result.totalRecords).toBe(10);
    });
  });

  describe('listJobs', () => {
    it('should return list of jobs', async () => {
      const mockJobs = [{ id: '1' }, { id: '2' }];
      mockJobRepo.findRecentJobs.mockResolvedValue(mockJobs);

      const result = await controller.listJobs();

      expect(result.total).toBe(2);
      expect(result.jobs).toHaveLength(2);
    });
  });
});
