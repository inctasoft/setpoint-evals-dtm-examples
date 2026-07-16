import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobRepository, StepRepository, StepStatus } from '@dtm/database';
import { NotFoundException } from '@nestjs/common';
import { WorkflowConfigService } from '../workflow-loader/workflow-config.service';
import { WorkflowRegistryService } from '../workflow-loader/workflow-registry.service';

describe('JobsController', () => {
  let controller: JobsController;

  const mockJobRepo = {
    findById: jest.fn(),
    findRecentJobs: jest.fn(),
  };

  const mockStepRepo = {
    findByJobId: jest.fn(),
  };

  // The default-bound singleton (as if it were injected as the app's default workflow).
  const mockWorkflowConfigService = {
    getStepName: jest.fn().mockImplementation((step: string) => step.toLowerCase()),
    getStepDefinitions: jest.fn().mockReturnValue([]),
  };

  // A DIFFERENT workflow's config — distinguishable output proves the controller
  // actually resolved against it instead of falling back to the default singleton.
  const mockIotWorkflowConfigService = {
    getStepName: jest.fn().mockImplementation((step: string) => `IOT::${step}`),
    getStepDefinitions: jest.fn().mockReturnValue([]),
  };

  const mockWorkflowRegistry = {
    has: jest.fn().mockImplementation((name: string) => name === 'iot-sensor-pipeline'),
    get: jest.fn().mockImplementation((name: string) => {
      if (name === 'iot-sensor-pipeline') return mockIotWorkflowConfigService;
      throw new Error(`unexpected workflow lookup in test: ${name}`);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        { provide: JobRepository, useValue: mockJobRepo },
        { provide: StepRepository, useValue: mockStepRepo },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistry },
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

    it('DI-singleton sweep: resolves currentStep against the JOB workflow, not the default singleton', async () => {
      // A job on a non-default workflow (iot-sensor-pipeline) must have its
      // currentStep derived from ITS OWN WorkflowConfigService, not the
      // default-bound singleton injected at boot.
      const jobId = 'iot-job-1';
      const mockJob = {
        id: jobId,
        workflowName: 'iot-sensor-pipeline',
        status: 'processing',
        payload: {},
        submittedAt: new Date(),
      };
      const mockSteps = [{ status: StepStatus.IN_PROGRESS, stepValue: 'IngestReading' }];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getEventStatus(jobId);

      // The IOT:: prefix only appears if the iot-sensor-pipeline config was used.
      expect(result.currentStep).toBe('IOT::IngestReading');
      expect(mockWorkflowRegistry.has).toHaveBeenCalledWith('iot-sensor-pipeline');
      expect(mockIotWorkflowConfigService.getStepName).toHaveBeenCalledWith('IngestReading');
      // A plausible-but-wrong "fix" that still calls the default singleton would
      // return 'ingestreading' (lowercased) here instead — this assertion fails
      // against that fix.
      expect(mockWorkflowConfigService.getStepName).not.toHaveBeenCalled();
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

    it('DI-singleton sweep: resolves each step.stepName against the JOB workflow', async () => {
      const jobId = 'iot-job-2';
      const mockJob = {
        id: jobId,
        workflowName: 'iot-sensor-pipeline',
        status: 'processing',
        payload: {},
        submittedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
      };
      const mockSteps = [{ id: 's1', stepValue: 'IngestReading', status: StepStatus.COMPLETED }];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getJobDetails(jobId);

      expect(result.steps[0].stepName).toBe('IOT::IngestReading');
      expect(mockWorkflowConfigService.getStepName).not.toHaveBeenCalled();
    });

    it('should pass through step input/output for the monitor Payloads tab', async () => {
      const jobId = 'job-with-payloads';
      const mockJob = { id: jobId, status: 'completed' };
      const mockSteps = [
        {
          id: 's1',
          stepValue: 'ValidateCustomer',
          status: StepStatus.COMPLETED,
          input: { customerId: 42 },
          output: { valid: true },
        },
        // A step with no captured payload must come back as null, not undefined
        // (undefined would silently drop the key from the JSON response).
        { id: 's2', stepValue: 'SubmitCustomer', status: StepStatus.PENDING },
      ];

      mockJobRepo.findById.mockResolvedValue(mockJob);
      mockStepRepo.findByJobId.mockResolvedValue(mockSteps);

      const result = await controller.getJobDetails(jobId);

      expect(result.steps[0].input).toEqual({ customerId: 42 });
      expect(result.steps[0].output).toEqual({ valid: true });
      expect(result.steps[1].input).toBeNull();
      expect(result.steps[1].output).toBeNull();
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
