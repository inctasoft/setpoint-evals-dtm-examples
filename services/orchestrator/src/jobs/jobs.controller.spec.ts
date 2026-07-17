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
    findPrimaryByJobIdAndStepValue: jest.fn(),
    findByParentId: jest.fn(),
    findChildInstancesByJobIdAndStepValue: jest.fn(),
    findByIds: jest.fn(),
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

  describe('getStepActivity', () => {
    it('should return attempts/ack/fanOut=null for a plain (non-fan-out) step', async () => {
      const jobId = 'job-1';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue({
        id: 'step-1',
        stepValue: 'ValidateCustomer',
        status: 'failed',
        durationMs: 63000,
        retryCount: 3,
        maxRetryCount: 3,
        firstAttemptAt: new Date('2026-01-01T00:00:00.000Z'),
        lastAttemptAt: new Date('2026-01-01T00:01:00.000Z'),
        executionHistory: [{ attemptNumber: 1, status: 'failure', attemptedAt: 't1' }],
        lambdaFunctionName: 'fn-a',
        sqsMessageId: 'sqs-1',
        kafkaPublishedAt: null,
        ackReceivedAt: null,
        ackMetadata: null,
        childCount: null,
        input: { a: 1 },
        output: null,
      });
      mockStepRepo.findByParentId.mockResolvedValue([]);

      const result = await controller.getStepActivity(jobId, 'ValidateCustomer');

      expect(mockStepRepo.findPrimaryByJobIdAndStepValue).toHaveBeenCalledWith(
        jobId,
        'ValidateCustomer',
      );
      expect(result.step).toBe('ValidateCustomer');
      expect(result.attempts).toHaveLength(1);
      expect(result.ack).toEqual({
        kafkaPublishedAt: null,
        ackReceivedAt: null,
        ackWaitMs: null,
        ackMetadata: null,
      });
      expect(result.fanOut).toBeNull();
      expect(result.input).toEqual({ a: 1 });
      expect(result.output).toBeNull();
    });

    it('should compute ack.ackWaitMs from kafkaPublishedAt/ackReceivedAt', async () => {
      const jobId = 'job-2';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue({
        id: 'step-2',
        stepValue: 'SubmitOrder',
        status: 'completed',
        retryCount: 0,
        maxRetryCount: 3,
        executionHistory: [],
        kafkaPublishedAt: new Date('2026-01-01T00:00:00.000Z'),
        ackReceivedAt: new Date('2026-01-01T00:00:02.000Z'),
        ackMetadata: { foo: 'bar' },
      });
      mockStepRepo.findByParentId.mockResolvedValue([]);

      const result = await controller.getStepActivity(jobId, 'SubmitOrder');

      expect(result.ack.ackWaitMs).toBe(2000);
      expect(result.ack.ackMetadata).toEqual({ foo: 'bar' });
    });

    it('should populate fanOut for a discovery/parent step with children', async () => {
      const jobId = 'job-3';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue({
        id: 'parent-step',
        stepValue: 'DiscoverLineItems',
        status: 'completed',
        retryCount: 0,
        maxRetryCount: 3,
        executionHistory: [],
        childCount: 2,
      });
      mockStepRepo.findByParentId.mockResolvedValue([
        {
          stepValue: 'ValidateLineItem',
          childIndex: 0,
          childItemId: '18',
          status: 'completed',
          durationMs: 100,
          retryCount: 0,
        },
        {
          stepValue: 'SubmitLineItem',
          childIndex: 0,
          childItemId: '18',
          status: 'completed',
          durationMs: 150,
          retryCount: 0,
        },
      ]);

      const result = await controller.getStepActivity(jobId, 'DiscoverLineItems');

      expect(mockStepRepo.findByParentId).toHaveBeenCalledWith('parent-step');
      expect(result.fanOut).not.toBeNull();
      expect(result.fanOut.childCount).toBe(2);
      expect(result.fanOut.children).toHaveLength(2);
      // Fan-out children can span MORE THAN ONE step type sharing the same parent
      // (order-processing's DiscoverLineItems parents both ValidateLineItem and
      // SubmitLineItem instances) — each child entry must disambiguate via its own
      // `step` field, never assume the parent's children are all one type.
      expect(result.fanOut.children.map((c: { step: string }) => c.step)).toEqual([
        'ValidateLineItem',
        'SubmitLineItem',
      ]);
    });

    it('should throw NotFoundException when the job does not exist', async () => {
      mockJobRepo.findById.mockResolvedValue(null);

      await expect(controller.getStepActivity('missing-job', 'AnyStep')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStepRepo.findPrimaryByJobIdAndStepValue).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when NEITHER a primary row NOR any fan-out-child row matches (truly unknown step)', async () => {
      const jobId = 'job-4';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue(null);
      mockStepRepo.findChildInstancesByJobIdAndStepValue.mockResolvedValue([]);

      await expect(controller.getStepActivity(jobId, 'DoesNotExistStep')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStepRepo.findByParentId).not.toHaveBeenCalled();
      expect(mockStepRepo.findChildInstancesByJobIdAndStepValue).toHaveBeenCalledWith(
        jobId,
        'DoesNotExistStep',
      );
      expect(mockStepRepo.findByIds).not.toHaveBeenCalled();
    });

    it('should return an instance-aggregate (200, not 404) when stepName has NO primary row but DOES have fan-out-child rows (e.g. iot double fan-out DiscoverReadings/IngestReading)', async () => {
      const jobId = 'job-5';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue(null);
      mockStepRepo.findChildInstancesByJobIdAndStepValue.mockResolvedValue([
        {
          id: 'child-1',
          stepValue: 'DiscoverReadings',
          parentStepId: 'sensor-parent',
          childIndex: 0,
          childItemId: 'SENS-GH3-TEMP',
          status: 'completed',
          durationMs: 120,
          retryCount: 0,
          executionHistory: [{ attemptNumber: 1, status: 'success', attemptedAt: 't1' }],
        },
        {
          id: 'child-2',
          stepValue: 'DiscoverReadings',
          parentStepId: 'sensor-parent',
          childIndex: 1,
          childItemId: 'SENS-GH3-HUM',
          status: 'failed',
          durationMs: 80,
          retryCount: 1,
          executionHistory: [],
        },
      ]);
      mockStepRepo.findByIds.mockResolvedValue([
        { id: 'sensor-parent', stepValue: 'DiscoverSensors' },
      ]);

      const result = await controller.getStepActivity(jobId, 'DiscoverReadings');

      expect(mockStepRepo.findChildInstancesByJobIdAndStepValue).toHaveBeenCalledWith(
        jobId,
        'DiscoverReadings',
      );
      expect(mockStepRepo.findByIds).toHaveBeenCalledWith(['sensor-parent']);
      expect(result).toEqual({
        step: 'DiscoverReadings',
        aggregate: true,
        instanceCount: 2,
        statusDistribution: { completed: 1, failed: 1 },
        instances: [
          {
            childIndex: 0,
            childItemId: 'SENS-GH3-TEMP',
            parentStep: 'DiscoverSensors',
            status: 'completed',
            durationMs: 120,
            retryCount: 0,
            attempts: [{ attemptNumber: 1, status: 'success', attemptedAt: 't1' }],
          },
          {
            childIndex: 1,
            childItemId: 'SENS-GH3-HUM',
            parentStep: 'DiscoverSensors',
            status: 'failed',
            durationMs: 80,
            retryCount: 1,
            attempts: [],
          },
        ],
      });
    });

    it('should NOT take the aggregate fallback when a primary row exists, even if same-named child rows also exist elsewhere on the job (primary shape wins, no regression)', async () => {
      const jobId = 'job-6';
      mockJobRepo.findById.mockResolvedValue({ id: jobId });
      mockStepRepo.findPrimaryByJobIdAndStepValue.mockResolvedValue({
        id: 'primary-step',
        stepValue: 'DiscoverLineItems',
        status: 'completed',
        retryCount: 0,
        maxRetryCount: 3,
        executionHistory: [],
        childCount: 1,
      });
      mockStepRepo.findByParentId.mockResolvedValue([
        {
          stepValue: 'ValidateLineItem',
          childIndex: 0,
          childItemId: '18',
          status: 'completed',
          durationMs: 100,
          retryCount: 0,
        },
      ]);

      const result = await controller.getStepActivity(jobId, 'DiscoverLineItems');

      // Primary-row shape, unchanged — the aggregate fallback is never consulted.
      expect(result.aggregate).toBeUndefined();
      expect(result.fanOut).not.toBeNull();
      expect(mockStepRepo.findChildInstancesByJobIdAndStepValue).not.toHaveBeenCalled();
      expect(mockStepRepo.findByIds).not.toHaveBeenCalled();
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
