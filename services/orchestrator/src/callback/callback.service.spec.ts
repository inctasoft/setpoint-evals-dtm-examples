/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CallbackService } from './callback.service';
import { JobRepository, StepRepository, JobStatus, StepStatus, JobType } from '@dtm/database';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { CascadePublishService } from '../orchestration/cascade-publish.service';
import { FanOutService } from '../orchestration/fan-out.service';
import { KafkaService } from '../kafka/kafka.service';
import { WorkflowConfigService } from '../workflow-loader/workflow-config.service';
import { WorkflowRegistryService } from '../workflow-loader/workflow-registry.service';
import { EventsGateway } from '../websocket/events.gateway';
import { CorrelationService } from '../common/correlation/correlation.service';
import { ConfigService } from '@nestjs/config';
import { QueueTransport } from '../transport/queue-transport.interface';
import { StepProgressDto } from './dto/step-progress.dto';

describe('CallbackService', () => {
  let service: CallbackService;
  let jobRepository: jest.Mocked<JobRepository>;
  let stepRepository: jest.Mocked<StepRepository>;
  let orchestrationService: jest.Mocked<OrchestrationService>;

  beforeEach(async () => {
    // Create mock implementations
    const mockJobRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
      findRecentJobs: jest.fn(),
    };

    const mockStepRepository = {
      findById: jest.fn(),
      findByJobId: jest.fn(),
      updateStatus: jest.fn(),
      updateFromCallback: jest.fn(),
    };

    const mockOrchestrationService = {
      continueJob: jest.fn(),
    };

    const mockKafkaService = {
      publish: jest.fn().mockResolvedValue(true),
      publishJobCompleted: jest.fn().mockResolvedValue(true),
    };

    const mockCascadePublishService = {
      areCascadeDependenciesMet: jest.fn().mockReturnValue(true),
      injectFkValues: jest
        .fn()
        .mockImplementation((_et: unknown, _steps: unknown, data: unknown) => data),
    };

    const mockFanOutService = {
      handleDiscoveryComplete: jest.fn(),
      handleChildStepComplete: jest.fn(),
    };

    const mockWorkflowConfigService = {
      getStepName: jest.fn().mockReturnValue('test-step'),
      getStepDefinition: jest.fn(),
      getStepDefinitions: jest.fn().mockReturnValue([]),
      getCascades: jest.fn().mockReturnValue([]),
      getCascadeByStep: jest.fn(),
      isOutputStep: jest.fn().mockReturnValue(false),
    };

    const mockWorkflowRegistryService = {
      get: jest.fn().mockReturnValue(mockWorkflowConfigService),
      has: jest.fn().mockReturnValue(true),
    };

    const mockEventsGateway = {
      broadcast: jest.fn(),
    };

    const mockCorrelationService = {
      getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    };

    // Default aws/SQS profile: bus redelivery, engine OFF — the engine-aware
    // branches in CallbackService must stay byte-identical to pre-engine behavior.
    const mockTransport = {
      capabilities: {
        stats: 'native',
        redelivery: 'bus',
        attemptCounter: 'native',
        dlq: 'native',
      },
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((_key: string, def?: string) => def),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallbackService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: StepRepository, useValue: mockStepRepository },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        { provide: CascadePublishService, useValue: mockCascadePublishService },
        { provide: FanOutService, useValue: mockFanOutService },
        { provide: KafkaService, useValue: mockKafkaService },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistryService },
        { provide: EventsGateway, useValue: mockEventsGateway },
        { provide: CorrelationService, useValue: mockCorrelationService },
        { provide: QueueTransport, useValue: mockTransport },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CallbackService>(CallbackService);
    jobRepository = module.get(JobRepository);
    stepRepository = module.get(StepRepository);
    orchestrationService = module.get(OrchestrationService);
    // kafkaService is injected but not directly tested (async publishing)
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleStepProgress', () => {
    describe('IN_PROGRESS status', () => {
      it('should update step to IN_PROGRESS and trigger orchestration', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.DELEGATED,
          startedAt: new Date(),
          retryCount: 0,
          maxRetryCount: 3,
          executionHistory: [],
        };

        const mockJob = {
          id: 'job-123',
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateStatus.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job continuing',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateStatus).toHaveBeenCalledWith('step-1', StepStatus.IN_PROGRESS);
        expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
      });

      it('should handle IN_PROGRESS status for already in-progress step', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS, // Already in progress
        };

        const mockJob = {
          id: 'job-123',
          status: JobStatus.PROCESSING,
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job continuing',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateStatus).toHaveBeenCalled();
      });
    });

    describe('COMPLETED status', () => {
      it('should update step to COMPLETED with output and statistics', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: { records: ['data1', 'data2'] },
          recordsProcessed: 100,
          recordsFailed: 5,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS,
        };

        const mockJob = {
          id: 'job-123',
          status: JobStatus.PROCESSING,
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.COMPLETED },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job continuing',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({
            status: StepStatus.COMPLETED,
            output: dto.output,
            recordsProcessed: 100,
            recordsFailed: 5,
            retryCount: 1,
            lastAttemptAt: expect.any(Date),
            executionHistory: expect.arrayContaining([
              expect.objectContaining({
                attemptNumber: 1,
                status: 'success',
              }),
            ]),
          }),
        );
      });

      it('should update job to COMPLETED when all steps are done', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-2',
          status: StepStatus.COMPLETED,
          recordsProcessed: 50,
        };

        const mockStep = {
          id: 'step-2',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS,
        };

        const mockJob = {
          id: 'job-123',
          status: JobStatus.PROCESSING,
          type: JobType.DEFAULT,
          payload: { customerId: 'cust-123' },
          submittedBy: 'test-user',
          submittedAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
        };

        // All steps completed
        const allSteps = [
          {
            id: 'step-1',
            stepValue: 'SubmitCustomer',
            status: StepStatus.COMPLETED,
            recordsProcessed: 1,
            output: {
              submittedCustomers: [{ customer_id: 'CUST-1000', full_name: 'Test User' }],
            },
            completedAt: new Date(),
          },
          {
            id: 'step-2',
            stepValue: 'SubmitOrder',
            status: StepStatus.COMPLETED,
            recordsProcessed: 1,
            output: {
              submittedOrders: [{ order_id: 'ORD-001', status: 'active' }],
            },
            completedAt: new Date(),
          },
        ];

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(allSteps as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          jobComplete: true,
          message: 'Job completed',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-2',
          expect.objectContaining({ status: StepStatus.COMPLETED }),
        );
        // Job status transitions are now owned by OrchestrationService.continueJob(),
        // not CallbackService — verify the delegation instead of a repo call CallbackService no longer makes.
        expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
        // Note: Kafka publishing is async and tested separately
      });

      it('should publish Kafka event when job completes', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
        };

        const mockStep = { id: 'step-1', jobId: 'job-123', status: StepStatus.IN_PROGRESS };
        const mockJob = {
          id: 'job-123',
          status: JobStatus.PROCESSING,
          type: JobType.DEFAULT,
          payload: { customerId: 'cust-123' },
          submittedBy: 'test-user',
          submittedAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([
          {
            ...mockStep,
            stepValue: 'SubmitOrder',
            status: StepStatus.COMPLETED,
            output: {
              submittedOrders: [{ order_id: 'ORD-001', status: 'active' }],
            },
            completedAt: new Date(),
          },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          jobComplete: true,
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        // Note: Kafka publishing is async and happens after callback returns
      });

      it('should clear error field when step succeeds after previous failures', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: { data: 'success' },
          recordsProcessed: 100,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS_RETRYING,
          error: 'Previous failure error', // Had an error from previous attempt
          retryCount: 2,
          maxRetryCount: 3,
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.COMPLETED, error: null },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job continuing',
        });

        // Act
        await service.handleStepProgress(dto);

        // Assert
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({
            status: StepStatus.COMPLETED,
            error: null, // Error cleared on success!
            output: { data: 'success' },
            recordsProcessed: 100,
            retryCount: 3, // Final attempt count
            executionHistory: expect.arrayContaining([
              expect.objectContaining({
                attemptNumber: 3,
                status: 'success',
              }),
            ]),
          }),
        );
      });
    });

    describe('FAILED status', () => {
      it('should update step to IN_PROGRESS_RETRYING when retries available', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.FAILED,
          error: 'Database connection failed',
          recordsProcessed: 50,
          recordsFailed: 10,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS,
          retryCount: 0,
          maxRetryCount: 3,
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.IN_PROGRESS_RETRYING },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Step will retry',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('waiting for retry');
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({
            status: StepStatus.IN_PROGRESS_RETRYING,
            error: 'Database connection failed',
            recordsProcessed: 50,
            recordsFailed: 10,
            retryCount: 1,
            lastAttemptAt: expect.any(Date),
            executionHistory: expect.arrayContaining([
              expect.objectContaining({
                attemptNumber: 1,
                status: 'failure',
                error: 'Database connection failed',
              }),
            ]),
          }),
        );
        // Job status should NOT be updated when retries are available
        expect(jobRepository.updateStatus).not.toHaveBeenCalled();
        // Orchestration should NOT continue when retries are available
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      });

      it('should NOT update job to FAILED when step fails but retries available', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-2',
          status: StepStatus.FAILED,
          error: 'Processing error',
        };

        const mockStep = {
          id: 'step-2',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS,
          retryCount: 0,
          maxRetryCount: 3,
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        // Mixed step statuses
        const allSteps = [
          { id: 'step-1', status: StepStatus.COMPLETED },
          { id: 'step-2', status: StepStatus.IN_PROGRESS_RETRYING },
          { id: 'step-3', status: StepStatus.PENDING },
        ];

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue(allSteps as any);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('waiting for retry');
        // Job status should NOT be updated (retries available)
        expect(jobRepository.updateStatus).not.toHaveBeenCalled();
        // Orchestration should NOT continue (waiting for retry)
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      });

      it('should update job to FAILED when step fails and retries exhausted', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-2',
          status: StepStatus.FAILED,
          error: 'Processing error',
        };

        const mockStep = {
          id: 'step-2',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS_RETRYING,
          retryCount: 2, // Already tried 2 times
          maxRetryCount: 3, // This is the 3rd (final) attempt
          startedAt: new Date(),
          firstAttemptAt: new Date(),
          executionHistory: [],
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        // After this callback, retryCount will be 3, which equals maxRetryCount
        const updatedStep = {
          ...mockStep,
          retryCount: 3, // Exhausted!
          status: StepStatus.FAILED,
        };

        // Mixed step statuses
        const allSteps = [
          { id: 'step-1', status: StepStatus.COMPLETED },
          { id: 'step-2', status: StepStatus.FAILED, retryCount: 3 },
          { id: 'step-3', status: StepStatus.PENDING },
        ];

        // Mock findById to return initial step, then updated step for all subsequent calls
        let findByIdCallCount = 0;
        stepRepository.findById.mockImplementation(() => {
          findByIdCallCount++;
          if (findByIdCallCount === 1) {
            return Promise.resolve(mockStep as any); // First call in updateStepFromCallback
          }
          return Promise.resolve(updatedStep as any); // All subsequent calls return updated step
        });

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue(allSteps as any);
        jobRepository.updateStatus.mockResolvedValue(undefined);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job failed',
        });

        // Act
        await service.handleStepProgress(dto);

        // Assert
        // Step is marked permanently FAILED (retries exhausted: attemptNumber 3 >= maxRetryCount 3).
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-2',
          expect.objectContaining({ status: StepStatus.FAILED }),
        );
        // Job status transitions (including FAILED on exhausted retries) are now owned by
        // OrchestrationService.continueJob() — CallbackService just delegates to it.
        // Orchestration SHOULD continue (to mark dependent steps as SKIPPED)
        expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
      });

      it('should not continue orchestration when step fails but retries available', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.FAILED,
          error: 'Fatal error',
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS,
          retryCount: 0,
          maxRetryCount: 3,
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.IN_PROGRESS_RETRYING },
        ] as any);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('waiting for retry');
        // Orchestration should NOT continue (waiting for SQS retry)
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
        // Job status should NOT be updated
        expect(jobRepository.updateStatus).not.toHaveBeenCalled();
      });

      it('should continue orchestration when step fails and retries exhausted', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.FAILED,
          error: 'Fatal error',
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS_RETRYING,
          retryCount: 2, // Already tried 2 times
          maxRetryCount: 3, // This is the 3rd (final) attempt
          startedAt: new Date(),
          firstAttemptAt: new Date(),
          executionHistory: [],
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        // After this callback, retryCount will be 3, which equals maxRetryCount
        const updatedStep = {
          ...mockStep,
          retryCount: 3, // Exhausted!
          status: StepStatus.FAILED,
        };

        // Mock findById to return initial step, then updated step for all subsequent calls
        let findByIdCallCount = 0;
        stepRepository.findById.mockImplementation(() => {
          findByIdCallCount++;
          if (findByIdCallCount === 1) {
            return Promise.resolve(mockStep as any); // First call in updateStepFromCallback
          }
          return Promise.resolve(updatedStep as any); // All subsequent calls return updated step
        });

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.FAILED, retryCount: 3 },
        ] as any);
        jobRepository.updateStatus.mockResolvedValue(undefined);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job failed, no next steps',
        });

        // Act
        await service.handleStepProgress(dto);

        // Assert
        // Step is marked permanently FAILED (retries exhausted: attemptNumber 3 >= maxRetryCount 3).
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({ status: StepStatus.FAILED }),
        );
        // Orchestration SHOULD continue (to mark dependent steps as SKIPPED); job status
        // transitions to FAILED are now handled inside OrchestrationService.continueJob().
        expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
      });
    });

    describe('error handling', () => {
      it('should throw NotFoundException when step does not exist', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'non-existent-step',
          status: StepStatus.IN_PROGRESS,
        };

        stepRepository.findById.mockResolvedValue(null);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });

      it('should throw NotFoundException when job does not exist', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'non-existent-job',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        };

        const mockStep = { id: 'step-1', jobId: 'non-existent-job' };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(null);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('not found');
      });

      it('should handle database errors gracefully', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        };

        stepRepository.findById.mockRejectedValue(new Error('Database connection lost'));

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toBe('Database connection lost');
      });

      it('should handle orchestration service errors gracefully', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
        };

        const mockStep = { id: 'step-1', jobId: 'job-123' };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockRejectedValue(new Error('Orchestration failed'));

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toBe('Orchestration failed');
      });
    });

    describe('idempotency / terminal-state guard', () => {
      it('should reject duplicate COMPLETED callback without calling updateFromCallback or continueJob', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          recordsProcessed: 100,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.COMPLETED, // Already completed
          recordsProcessed: 100,
        };

        const mockJob = { id: 'job-123', status: JobStatus.COMPLETED };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('Duplicate callback ignored');
        // Must NOT call updateFromCallback or continueJob
        expect(stepRepository.updateFromCallback).not.toHaveBeenCalled();
        expect(stepRepository.updateStatus).not.toHaveBeenCalled();
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      });

      it('should reject callback when step is in WAITING_FOR_ACK state', async () => {
        // Arrange - e.g. SQS re-delivers after Submit step already published to Kafka
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: { submittedCustomers: [{ firstName: 'Test' }] },
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.WAITING_FOR_ACK, // Already published to Kafka
        };

        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('Duplicate callback ignored');
        expect(result.message).toContain('waiting_for_ack');
        expect(stepRepository.updateFromCallback).not.toHaveBeenCalled();
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      });

      it('should reject late success callback when step is already FAILED', async () => {
        // Arrange - e.g. late success callback arrives after retries exhausted
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: { entity: { entity_id: 'ENT-1000' } },
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.FAILED, // Already permanently failed
          retryCount: 3,
          maxRetryCount: 3,
        };

        const mockJob = { id: 'job-123', status: JobStatus.FAILED };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('Duplicate callback ignored');
        expect(result.message).toContain('failed');
        expect(stepRepository.updateFromCallback).not.toHaveBeenCalled();
        expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      });

      it('should accept callback when step is IN_PROGRESS_RETRYING (retry success)', async () => {
        // Arrange - step failed once, SQS retries, Lambda succeeds on retry
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: { entity: { entity_id: 'ENT-1000' } },
          recordsProcessed: 1,
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.IN_PROGRESS_RETRYING, // Retrying - should accept
          retryCount: 1,
          maxRetryCount: 3,
          executionHistory: [],
        };

        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.COMPLETED },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          message: 'Job continuing',
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).not.toContain('Duplicate callback ignored');
        // SHOULD call updateFromCallback (retry success is valid)
        expect(stepRepository.updateFromCallback).toHaveBeenCalled();
      });

      it('should handle multiple progress updates for same step', async () => {
        // Arrange
        const dto1: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        };

        const dto2: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS, // Duplicate
        };

        const mockStep = { id: 'step-1', jobId: 'job-123', status: StepStatus.DELEGATED };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
        });

        // Act
        const result1 = await service.handleStepProgress(dto1);
        const result2 = await service.handleStepProgress(dto2);

        // Assert
        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle callback with no recordsProcessed or recordsFailed', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          // No records info
        };

        const mockStep = { id: 'step-1', jobId: 'job-123', status: StepStatus.IN_PROGRESS };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.COMPLETED },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({ success: true });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({
            status: StepStatus.COMPLETED,
            output: {}, // Empty object when no output provided
            recordsProcessed: undefined,
            recordsFailed: undefined,
            retryCount: 1,
            lastAttemptAt: expect.any(Date),
            executionHistory: expect.arrayContaining([
              expect.objectContaining({
                attemptNumber: 1,
                status: 'success',
              }),
            ]),
          }),
        );
      });

      it('should handle callback with large output data', async () => {
        // Arrange
        const largeOutput = {
          records: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: 'test' })),
        };

        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
          output: largeOutput,
          recordsProcessed: 1000,
        };

        const mockStep = { id: 'step-1', jobId: 'job-123', status: StepStatus.IN_PROGRESS };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockResolvedValue({ success: true });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
      });

      it('should handle callback for job with no other steps', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-single',
          stepId: 'step-only',
          status: StepStatus.COMPLETED,
        };

        const mockStep = { id: 'step-only', jobId: 'job-single', status: StepStatus.IN_PROGRESS };
        const mockJob = { id: 'job-single', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.COMPLETED },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({
          success: true,
          jobComplete: true,
        });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-only',
          expect.objectContaining({ status: StepStatus.COMPLETED }),
        );
        // Job status transitions are owned by OrchestrationService.continueJob(), not CallbackService.
        expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-single');
      });
    });

    describe('state transitions', () => {
      it('should allow DELEGATED → IN_PROGRESS → COMPLETED', async () => {
        // This tests the normal flow
        const mockStep = { id: 'step-1', jobId: 'job-123' };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue([mockStep] as any);
        orchestrationService.continueJob.mockResolvedValue({ success: true });

        // Act & Assert each transition
        await service.handleStepProgress({
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.IN_PROGRESS,
        });

        await service.handleStepProgress({
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.COMPLETED,
        });

        expect(stepRepository.updateStatus).toHaveBeenCalled();
        expect(stepRepository.updateFromCallback).toHaveBeenCalled();
      });

      it('should allow DELEGATED → IN_PROGRESS_RETRYING (failure with retries available)', async () => {
        // Arrange
        const dto: StepProgressDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          status: StepStatus.FAILED,
          error: 'Immediate failure',
        };

        const mockStep = {
          id: 'step-1',
          jobId: 'job-123',
          status: StepStatus.DELEGATED,
          retryCount: 0,
          maxRetryCount: 3,
        };
        const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.updateFromCallback.mockResolvedValue(undefined);
        stepRepository.findByJobId.mockResolvedValue([
          { ...mockStep, status: StepStatus.IN_PROGRESS_RETRYING },
        ] as any);
        orchestrationService.continueJob.mockResolvedValue({ success: true });

        // Act
        const result = await service.handleStepProgress(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
          'step-1',
          expect.objectContaining({
            status: StepStatus.IN_PROGRESS_RETRYING,
            error: 'Immediate failure',
            retryCount: 1,
            recordsProcessed: undefined,
            recordsFailed: undefined,
            retryCount: 1,
            lastAttemptAt: expect.any(Date),
            executionHistory: expect.arrayContaining([
              expect.objectContaining({
                attemptNumber: 1,
                status: 'failure',
                error: 'Immediate failure',
              }),
            ]),
          }),
        );
      });
    });
  });

  describe('getJobStatus', () => {
    it('should return job and steps information', async () => {
      // Arrange
      const mockJob = {
        id: 'job-123',
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
        submittedAt: new Date(),
        startedAt: new Date(),
      };

      const mockSteps = [
        {
          id: 'step-1',
          stepValue: 'ValidateCustomer',
          status: StepStatus.COMPLETED,
          recordsProcessed: 100,
          recordsFailed: 5,
        },
        {
          id: 'step-2',
          stepValue: 'SubmitCustomer',
          status: StepStatus.IN_PROGRESS,
          recordsProcessed: 50,
          recordsFailed: 2,
        },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      const result = await service.getJobStatus('job-123');

      // Assert
      expect(result.job.id).toBe('job-123');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe(StepStatus.COMPLETED);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      // Arrange
      jobRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getJobStatus('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should handle job with no steps', async () => {
      // Arrange
      const mockJob = {
        id: 'job-no-steps',
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        submittedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue([]);

      // Act
      const result = await service.getJobStatus('job-no-steps');

      // Assert
      expect(result.job.id).toBe('job-no-steps');
      expect(result.steps).toHaveLength(0);
    });
  });

  describe('listRecentJobs', () => {
    it('should return list of recent jobs', async () => {
      // Arrange
      const mockJobs = [
        {
          id: 'job-1',
          type: JobType.DEFAULT,
          status: JobStatus.COMPLETED,
          submittedBy: 'user1',
          submittedAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
          error: null,
        },
        {
          id: 'job-2',
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
          submittedBy: 'user2',
          submittedAt: new Date(),
          startedAt: new Date(),
          completedAt: null,
          error: null,
        },
      ];

      jobRepository.findRecentJobs.mockResolvedValue(mockJobs as any);

      // Act
      const result = await service.listRecentJobs(10);

      // Assert
      expect(result.jobs).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.jobs[0].id).toBe('job-1');
    });

    it('should handle empty job list', async () => {
      // Arrange
      jobRepository.findRecentJobs.mockResolvedValue([]);

      // Act
      const result = await service.listRecentJobs(10);

      // Assert
      expect(result.jobs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should respect limit parameter', async () => {
      // Arrange
      const mockJobs = Array.from({ length: 5 }, (_, i) => ({
        id: `job-${i}`,
        type: JobType.DEFAULT,
        status: JobStatus.COMPLETED,
        submittedBy: 'user',
        submittedAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
      }));

      jobRepository.findRecentJobs.mockResolvedValue(mockJobs as any);

      // Act
      const result = await service.listRecentJobs(5);

      // Assert
      expect(jobRepository.findRecentJobs).toHaveBeenCalledWith(5);
      expect(result.jobs).toHaveLength(5);
    });

    it('should handle jobs with missing submittedBy field', async () => {
      // Arrange
      const mockJobs = [
        {
          id: 'job-1',
          type: JobType.DEFAULT,
          status: JobStatus.COMPLETED,
          submittedBy: null, // Missing
          submittedAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
          error: null,
        },
      ];

      jobRepository.findRecentJobs.mockResolvedValue(mockJobs as any);

      // Act
      const result = await service.listRecentJobs(10);

      // Assert
      expect(result.jobs[0].submittedBy).toBe('unknown');
    });
  });

  describe('job status calculation', () => {
    it('should set job to PROCESSING when steps are still running', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-1',
        status: StepStatus.IN_PROGRESS,
      };

      const mockStep = { id: 'step-1', jobId: 'job-123' };
      const mockJob = { id: 'job-123', status: JobStatus.PENDING };

      const allSteps = [
        { id: 'step-1', status: StepStatus.IN_PROGRESS },
        { id: 'step-2', status: StepStatus.PENDING },
      ];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      expect(stepRepository.updateStatus).toHaveBeenCalledWith('step-1', StepStatus.IN_PROGRESS);
      // Job status transitions (including PENDING -> PROCESSING) are now owned by
      // OrchestrationService.continueJob() — verify CallbackService delegates to it.
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
    });

    it('should not change job status if already correct', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-1',
        status: StepStatus.IN_PROGRESS,
      };

      const mockStep = { id: 'step-1', jobId: 'job-123' };
      const mockJob = { id: 'job-123', status: JobStatus.PROCESSING }; // Already correct

      const allSteps = [
        { id: 'step-1', status: StepStatus.IN_PROGRESS },
        { id: 'step-2', status: StepStatus.PENDING },
      ];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      // Should not update if status is already correct
      expect(jobRepository.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('complex step scenarios', () => {
    it('should handle step with large output payload', async () => {
      // Arrange
      const largeOutput = {
        records: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          data: `record-${i}`,
          metadata: { processed: true },
        })),
      };

      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-1',
        status: StepStatus.COMPLETED,
        output: largeOutput,
        recordsProcessed: 1000,
      };

      const mockStep = {
        id: 'step-1',
        jobId: 'job-123',
        retryCount: 0,
        maxRetryCount: 3,
        executionHistory: [],
      };

      const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };
      const allSteps = [{ id: 'step-1', status: StepStatus.COMPLETED }];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
        'step-1',
        expect.objectContaining({
          status: StepStatus.COMPLETED,
          output: largeOutput,
          recordsProcessed: 1000,
        }),
      );
    });

    it('should handle step with data reference', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-1',
        status: StepStatus.COMPLETED,
        dataReference: {
          type: 'database_table',
          table: 'data_snapshot_123',
          metadata: { rowCount: 500 },
        },
      };

      const mockStep = {
        id: 'step-1',
        jobId: 'job-123',
        retryCount: 0,
        maxRetryCount: 3,
        executionHistory: [],
      };

      const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };
      const allSteps = [{ id: 'step-1', status: StepStatus.COMPLETED }];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
        'step-1',
        expect.objectContaining({
          status: StepStatus.COMPLETED,
          output: expect.objectContaining({
            dataReference: dto.dataReference,
          }),
        }),
      );
    });

    it('should handle mixed step statuses in a job', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-2',
        status: StepStatus.COMPLETED,
      };

      const mockStep = { id: 'step-2', jobId: 'job-123', retryCount: 0, maxRetryCount: 3 };
      const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

      const allSteps = [
        { id: 'step-1', status: StepStatus.COMPLETED },
        { id: 'step-2', status: StepStatus.COMPLETED },
        { id: 'step-3', status: StepStatus.WAITING_FOR_ACK },
        { id: 'step-4', status: StepStatus.PENDING },
      ];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      expect(jobRepository.updateStatus).not.toHaveBeenCalled(); // Job still processing
      expect(orchestrationService.continueJob).toHaveBeenCalled();
    });

    it('should handle job completion with all steps succeeded', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: 'job-123',
        stepId: 'step-4',
        status: StepStatus.COMPLETED,
      };

      const mockStep = { id: 'step-4', jobId: 'job-123', retryCount: 0, maxRetryCount: 3 };
      const mockJob = { id: 'job-123', status: JobStatus.PROCESSING };

      const allSteps = [
        { id: 'step-1', status: StepStatus.COMPLETED },
        { id: 'step-2', status: StepStatus.COMPLETED },
        { id: 'step-3', status: StepStatus.COMPLETED },
        { id: 'step-4', status: StepStatus.COMPLETED },
      ];

      stepRepository.findById.mockResolvedValue(mockStep as any);
      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(allSteps as any);
      orchestrationService.continueJob.mockResolvedValue({ success: true });

      // Act
      await service.handleStepProgress(dto);

      // Assert
      expect(stepRepository.updateFromCallback).toHaveBeenCalledWith(
        'step-4',
        expect.objectContaining({ status: StepStatus.COMPLETED }),
      );
      // Job status transitions to COMPLETED are now owned by OrchestrationService.continueJob().
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
    });
  });

  describe('getJobStatus edge cases', () => {
    it('should handle job with null/undefined fields gracefully', async () => {
      // Arrange
      const mockJob = {
        id: 'job-123',
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        submittedBy: null,
        submittedAt: new Date(),
        startedAt: null,
        completedAt: null,
        error: null,
      };

      const mockSteps = [
        {
          id: 'step-1',
          name: 'ValidateCustomer',
          stepValue: 'ValidateCustomer',
          status: StepStatus.PENDING,
          recordsProcessed: 0,
          recordsFailed: 0,
          startedAt: null,
          completedAt: null,
        },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      const result = await service.getJobStatus('job-123');

      // Assert
      expect(result.job).toMatchObject({
        id: 'job-123',
        status: JobStatus.PENDING,
      });
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]).toMatchObject({
        id: 'step-1',
        status: StepStatus.PENDING,
      });
    });

    it('should include error details in failed step status', async () => {
      // Arrange
      const mockJob = {
        id: 'job-123',
        type: JobType.DEFAULT,
        status: JobStatus.FAILED,
        submittedAt: new Date(),
        error: 'Step validation failed after 3 retries',
      };

      const mockSteps = [
        {
          id: 'step-1',
          name: 'ValidateCustomer',
          stepValue: 'ValidateCustomer',
          status: StepStatus.FAILED,
          error: 'Database connection timeout',
          retryCount: 3,
          recordsProcessed: 0,
          recordsFailed: 1,
        },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      const result = await service.getJobStatus('job-123');

      // Assert
      expect(result.job.status).toBe(JobStatus.FAILED);
      expect(result.steps[0].error).toBe('Database connection timeout');
      expect(result.steps[0].status).toBe(StepStatus.FAILED);
    });
  });

  describe('listRecentJobs edge cases', () => {
    it('should handle empty job list', async () => {
      // Arrange
      jobRepository.findRecentJobs.mockResolvedValue([]);

      // Act
      const result = await service.listRecentJobs(10);

      // Assert
      expect(result.jobs).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle database errors during job listing', async () => {
      // Arrange
      jobRepository.findRecentJobs.mockRejectedValue(new Error('Database connection lost'));

      // Act & Assert
      await expect(service.listRecentJobs(10)).rejects.toThrow('Database connection lost');
    });

    it('should handle jobs with various completion statuses', async () => {
      // Arrange
      const mockJobs = [
        {
          id: 'job-1',
          type: JobType.DEFAULT,
          status: JobStatus.COMPLETED,
          submittedAt: new Date('2025-01-01T00:00:00Z'),
          completedAt: new Date('2025-01-01T00:05:00Z'),
        },
        {
          id: 'job-2',
          type: JobType.DEFAULT,
          status: JobStatus.FAILED,
          submittedAt: new Date('2025-01-01T00:10:00Z'),
          completedAt: new Date('2025-01-01T00:12:00Z'),
          error: 'Worker timeout',
        },
        {
          id: 'job-3',
          type: JobType.DEFAULT,
          status: JobStatus.CANCELLED,
          submittedAt: new Date('2025-01-01T00:15:00Z'),
          completedAt: new Date('2025-01-01T00:16:00Z'),
        },
      ];

      jobRepository.findRecentJobs.mockResolvedValue(mockJobs as any);

      // Act
      const result = await service.listRecentJobs(10);

      // Assert
      expect(result.jobs).toHaveLength(3);
      expect(result.jobs[0].status).toBe('completed');
      expect(result.jobs[1].status).toBe('failed');
      expect(result.jobs[1].error).toBe('Worker timeout');
      expect(result.jobs[2].status).toBe('cancelled');
    });
  });
});
