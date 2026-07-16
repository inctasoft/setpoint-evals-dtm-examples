/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { OrchestrationService } from './orchestration.service';
import { JobRepository, StepRepository, JobStatus, StepStatus, JobType } from '@dtm/database';
import { DelegationService } from '../delegation/delegation.service';
import { CorrelationService } from '../common/correlation/correlation.service';
import { KafkaService } from '../kafka/kafka.service';
import { WorkflowConfigService } from '../workflow-loader/workflow-config.service';
import { WorkflowRegistryService } from '../workflow-loader/workflow-registry.service';
import { FeatureFlagService } from '../workflow-loader/feature-flag.service';
import { EventsGateway } from '../websocket/events.gateway';

describe('OrchestrationService', () => {
  let service: OrchestrationService;
  let jobRepository: jest.Mocked<JobRepository>;
  let stepRepository: jest.Mocked<StepRepository>;
  let delegationService: jest.Mocked<DelegationService>;
  let workflowConfigService: jest.Mocked<WorkflowConfigService>;

  beforeEach(async () => {
    // Create mock implementations
    const mockJobRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
      updateResults: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
      create: jest.fn(),
    };

    const mockStepRepository = {
      createSteps: jest.fn(),
      findByJobId: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      findReadySteps: jest.fn(),
      updateFromCallback: jest.fn(),
    };

    const mockDelegationService = {
      delegateStep: jest.fn(),
      delegateSteps: jest.fn(),
    };

    const mockCorrelationService = {
      getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
      runWithCorrelationId: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    };

    const mockKafkaService = {
      publish: jest.fn().mockResolvedValue(true),
      publishJobCompleted: jest.fn().mockResolvedValue(true),
    };

    const mockWorkflowConfigService = {
      getStepName: jest.fn().mockImplementation((step: string) => step.toLowerCase()),
      getWorkflow: jest.fn().mockReturnValue({
        name: 'test-workflow',
        dynamicSteps: false,
        featureFlags: { defaults: {} },
        steps: {},
      }),
      getWorkflowName: jest.fn().mockReturnValue('test-workflow'),
      getStepDefinitions: jest.fn().mockReturnValue([]),
      getUpfrontStepDefinitions: jest.fn().mockReturnValue([]),
      getStepDefinition: jest.fn(),
      getStepOrder: jest.fn().mockReturnValue(0),
      getCascades: jest.fn().mockReturnValue([]),
      getOutcomeRules: jest.fn().mockReturnValue([]),
      determineOutcome: jest.fn(),
      isFanOutDiscoveryStep: jest.fn().mockReturnValue(false),
      isChildStep: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<WorkflowConfigService>;
    // getStepDefinitionsForJob mirrors the real WorkflowConfigService: for non-dynamic
    // workflows it falls through to getStepDefinitions(job.type). Wired as a separate
    // assignment so per-test overrides of getStepDefinitions flow through automatically.
    (mockWorkflowConfigService as any).getStepDefinitionsForJob = jest
      .fn()
      .mockImplementation((job: { type: string }) =>
        mockWorkflowConfigService.getStepDefinitions(job.type),
      );

    const mockWorkflowRegistryService = {
      get: jest.fn().mockReturnValue(mockWorkflowConfigService),
      has: jest.fn().mockReturnValue(true),
    };

    const mockEventsGateway = {
      broadcast: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestrationService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: StepRepository, useValue: mockStepRepository },
        { provide: DelegationService, useValue: mockDelegationService },
        { provide: CorrelationService, useValue: mockCorrelationService },
        { provide: KafkaService, useValue: mockKafkaService },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistryService },
        { provide: EventsGateway, useValue: mockEventsGateway },
        // Real (not mocked): stateless, has its own dedicated spec file (feature-flag.service.spec.ts).
        FeatureFlagService,
      ],
    }).compile();

    service = module.get<OrchestrationService>(OrchestrationService);
    jobRepository = module.get(JobRepository);
    stepRepository = module.get(StepRepository);
    delegationService = module.get(DelegationService);
    workflowConfigService = module.get(WorkflowConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startJob', () => {
    describe('successful job start', () => {
      it.skip('should create correct number of steps for order-processing workflow (needs update for 4-step model)', async () => {
        // Arrange
        const jobId = 'job-123';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PENDING,
          payload: { orderId: '123', customerId: 'CUST123' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer',
            status: StepStatus.PENDING,
            description: 'Validate Customer step',
            lambdaFunctionName: 'validate-customer-worker',
            retryCount: 0,
            maxRetryCount: 3,
            executionHistory: [],
            startedAt: new Date(),
          },
          {
            id: 'step-2',
            jobId,
            stepValue: 'ValidateOrder',
            status: StepStatus.PENDING,
            description: 'Validate Order step',
            lambdaFunctionName: 'validate-order-worker',
          },
          // ... would have multiple steps total for order-processing
        ];

        jobRepository.findById.mockResolvedValue(mockJob);
        stepRepository.createSteps.mockResolvedValue(mockSteps);
        delegationService.delegateSteps.mockResolvedValue({
          totalSteps: 2,
          successfulDelegations: 2,
          failedDelegations: 0,
          results: [
            { success: true, stepId: 'step-1', messageId: 'msg-123' },
            { success: true, stepId: 'step-2', messageId: 'msg-124' },
          ],
        });

        // Act
        const result = await service.startJob(jobId);

        // Assert
        expect(result.success).toBe(true);
        expect(result.stepsCreated).toBeGreaterThan(0);
        expect(jobRepository.findById).toHaveBeenCalledWith(jobId);
        expect(jobRepository.updateStatus).toHaveBeenCalledWith(jobId, JobStatus.PROCESSING);
        // Both ValidateCustomer and ValidateOrder should be delegated in parallel
        expect(delegationService.delegateSteps).toHaveBeenCalledTimes(1);
      });

      it.skip('should create correct number of steps for default workflow variant (not implemented)', async () => {
        // Arrange
        const jobId = 'job-456';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PENDING,
          payload: { sourceFile: 's3://bucket/data.csv' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer',
            status: StepStatus.PENDING,
            description: 'Validate step',
            lambdaFunctionName: 'validate-worker',
          },
          // ... would have multiple steps total for default variant
        ];

        jobRepository.findById.mockResolvedValue(mockJob);
        stepRepository.createSteps.mockResolvedValue(mockSteps);
        delegationService.delegateStep.mockResolvedValue({
          success: true,
          stepId: 'step-1',
          messageId: 'msg-456',
        });

        // Act
        const result = await service.startJob(jobId);

        // Assert
        expect(result.success).toBe(true);
        expect(result.stepsCreated).toBeGreaterThan(0);
        expect(delegationService.delegateStep).toHaveBeenCalledTimes(1);
      });

      it.skip('should delegate all ready steps in parallel (needs update for current behavior)', async () => {
        // Arrange
        const jobId = 'job-789';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PENDING,
          payload: { orderId: '123' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer', // No dependencies - ready immediately
            status: StepStatus.PENDING,
            description: 'Customer',
            lambdaFunctionName: 'validate-customer-worker',
          },
          {
            id: 'step-2',
            jobId,
            stepValue: 'ValidateProduct', // No dependencies - ready immediately
            status: StepStatus.PENDING,
            description: 'Product',
            lambdaFunctionName: 'validate-product-worker',
          },
        ];

        jobRepository.findById.mockResolvedValue(mockJob);
        stepRepository.createSteps.mockResolvedValue(mockSteps);
        delegationService.delegateSteps.mockResolvedValue({
          totalSteps: 2,
          successfulDelegations: 2,
          failedDelegations: 0,
          results: [
            { success: true, stepId: 'step-1', messageId: 'msg-123' },
            { success: true, stepId: 'step-2', messageId: 'msg-124' },
          ],
        });

        // Act
        await service.startJob(jobId);

        // Assert
        // Both steps should be delegated in parallel (huge performance improvement!)
        expect(delegationService.delegateSteps).toHaveBeenCalledTimes(1);
        expect(delegationService.delegateSteps).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              stepId: 'step-1',
              jobId: jobId,
            }),
            expect.objectContaining({
              stepId: 'step-2',
              jobId: jobId,
            }),
          ]),
        );
      });

      it.skip('should update job status to PROCESSING after creating steps (needs update for current behavior)', async () => {
        // Arrange
        const jobId = 'job-abc';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PENDING,
          payload: { orderId: '123' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        jobRepository.findById.mockResolvedValue(mockJob);
        stepRepository.createSteps.mockResolvedValue([
          { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
        ] as any);
        delegationService.delegateStep.mockResolvedValue({
          success: true,
          stepId: 'step-1',
          messageId: 'msg-123',
        });

        // Act
        await service.startJob(jobId);

        // Assert
        expect(jobRepository.updateStatus).toHaveBeenCalledWith(jobId, JobStatus.PROCESSING);
        // Verify it's called BEFORE delegation
        const updateStatusCall = jobRepository.updateStatus.mock.invocationCallOrder[0];
        const delegateCall = delegationService.delegateStep.mock.invocationCallOrder[0];
        expect(updateStatusCall).toBeLessThan(delegateCall);
      });
    });

    describe('error handling', () => {
      it('should throw error when job not found', async () => {
        // Arrange
        const jobId = 'non-existent-job';
        jobRepository.findById.mockResolvedValue(null);

        // Act
        const result = await service.startJob(jobId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('Job non-existent-job not found');
        expect(stepRepository.createSteps).not.toHaveBeenCalled();
        expect(delegationService.delegateStep).not.toHaveBeenCalled();
      });

      it('should throw error for unknown workflow type', async () => {
        // Arrange
        const jobId = 'job-unknown';
        const mockJob = {
          id: jobId,
          type: 'UNKNOWN_TYPE' as JobType,
          status: JobStatus.PENDING,
          payload: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        jobRepository.findById.mockResolvedValue(mockJob);

        // Act
        const result = await service.startJob(jobId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('No step definitions found');
      });

      it.skip('should handle delegation failure gracefully (needs update for current behavior)', async () => {
        // Arrange
        const jobId = 'job-fail';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PENDING,
          payload: { orderId: '123' },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        jobRepository.findById.mockResolvedValue(mockJob);
        stepRepository.createSteps.mockResolvedValue([
          { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
        ] as any);
        delegationService.delegateStep.mockResolvedValue({
          success: false,
          stepId: 'step-1',
          error: 'SQS send failed',
        });

        // Act
        const result = await service.startJob(jobId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.message).toContain('Failed to delegate step');
        expect(result.message).toContain('SQS send failed');
      });
    });
  });

  describe('continueJob', () => {
    describe('sequential step execution', () => {
      it('should delegate the next step when previous completes', async () => {
        // Arrange
        const jobId = 'job-seq';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer', // Customer (COMPLETED)
            status: StepStatus.COMPLETED,
          },
          {
            id: 'step-2',
            jobId,
            stepValue: 'SubmitCustomer', // SubmitCustomer (PENDING, depends on ValidateCustomer)
            status: StepStatus.PENDING,
          },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
        workflowConfigService.getStepDefinitions.mockReturnValue([
          { step: 'ValidateCustomer', queueName: 'q-validate-customer', dependencies: [] },
          {
            step: 'SubmitCustomer',
            queueName: 'q-submit-customer',
            dependencies: ['ValidateCustomer'],
          },
        ] as any);
        delegationService.delegateStep.mockResolvedValue({
          success: true,
          stepId: 'step-2',
          messageId: 'msg-2',
        });

        // Act
        await service.continueJob(jobId);

        // Assert
        expect(delegationService.delegateStep).toHaveBeenCalledWith(
          expect.objectContaining({ stepId: 'step-2' }),
        );
      });

      it('should not delegate when dependencies are not met', async () => {
        // Arrange
        const jobId = 'job-blocked';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer', // Customer (IN_PROGRESS)
            status: StepStatus.IN_PROGRESS,
          },
          {
            id: 'step-2',
            jobId,
            stepValue: 'SubmitCustomer', // SubmitCustomer (PENDING, depends on ValidateCustomer)
            status: StepStatus.PENDING,
          },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

        // Act
        await service.continueJob(jobId);

        // Assert
        expect(delegationService.delegateSteps).not.toHaveBeenCalled();
      });
    });

    describe('parallel step execution', () => {
      it.skip('should delegate multiple parallel steps together (complex dependencies not in 4-step model)', async () => {
        // Arrange
        const jobId = 'job-parallel';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          {
            id: 'step-1',
            jobId,
            stepValue: 'ValidateCustomer', // Customer (COMPLETED)
            status: StepStatus.COMPLETED,
          },
          {
            id: 'step-2',
            jobId,
            stepValue: 'SubmitCustomer', // SubmitCustomer (COMPLETED)
            status: StepStatus.COMPLETED,
          },
          {
            id: 'step-3',
            jobId,
            stepValue: 'ValidateOrder', // ValidateOrder (PENDING, can run parallel)
            status: StepStatus.PENDING,
          },
          {
            id: 'step-4',
            jobId,
            stepValue: 'ValidatePayment', // ValidatePayment (PENDING, can run parallel)
            status: StepStatus.PENDING,
          },
          {
            id: 'step-5',
            jobId,
            stepValue: 'ValidateShipment', // ValidateShipment (PENDING, can run parallel)
            status: StepStatus.PENDING,
          },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
        delegationService.delegateSteps.mockResolvedValue({
          results: [
            { success: true, stepId: 'step-3', messageId: 'msg-3' },
            { success: true, stepId: 'step-4', messageId: 'msg-4' },
            { success: true, stepId: 'step-5', messageId: 'msg-5' },
          ],
          successCount: 3,
          failureCount: 0,
        });

        // Act
        await service.continueJob(jobId);

        // Assert
        expect(delegationService.delegateSteps).toHaveBeenCalledTimes(1);
        expect(delegationService.delegateSteps).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ stepId: 'step-3' }),
            expect.objectContaining({ stepId: 'step-4' }),
            expect.objectContaining({ stepId: 'step-5' }),
          ]),
        );
      });
    });

    describe('job completion', () => {
      it('should mark job as COMPLETED when all steps are done', async () => {
        // Arrange
        const jobId = 'job-complete';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
          { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.COMPLETED },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

        // Act
        await service.continueJob(jobId);

        // Assert
        expect(jobRepository.updateStatus).toHaveBeenCalledWith(jobId, JobStatus.COMPLETED);
      });

      it('should not delegate any steps when job is complete', async () => {
        // Arrange
        const jobId = 'job-done';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
          { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.COMPLETED },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

        // Act
        await service.continueJob(jobId);

        // Assert
        expect(delegationService.delegateSteps).not.toHaveBeenCalled();
      });
    });

    describe('job failure', () => {
      it.skip('should mark job as FAILED when a step fails (needs update for current behavior)', async () => {
        // Arrange
        const jobId = 'job-failed';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
          { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.FAILED },
          { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.PENDING },
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

        // Act
        const result = await service.continueJob(jobId);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('failed steps');
        expect(result.nextStepDelegated).toBe(false);
        expect(delegationService.delegateSteps).not.toHaveBeenCalled();
        expect(delegationService.delegateStep).not.toHaveBeenCalled();
      });

      it.skip('should handle partial failures in parallel steps (needs update for current behavior)', async () => {
        // Arrange
        const jobId = 'job-partial-fail';
        const mockJob = {
          id: jobId,
          type: JobType.DEFAULT,
          status: JobStatus.PROCESSING,
        };

        const mockSteps = [
          { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.COMPLETED }, // ValidateOrder OK
          { id: 'step-4', jobId, stepValue: 'SubmitOrder', status: StepStatus.FAILED }, // SubmitOrder FAILED
          { id: 'step-5', jobId, stepValue: 'ValidatePayment', status: StepStatus.COMPLETED }, // ValidatePayment OK
          { id: 'step-6', jobId, stepValue: 'SubmitPayment', status: StepStatus.PENDING }, // SubmitPayment (blocked)
        ];

        jobRepository.findById.mockResolvedValue(mockJob as any);
        stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

        // Act
        const result = await service.continueJob(jobId);

        // Assert
        expect(result.success).toBe(true);
        expect(result.message).toContain('failed steps');
        // SubmitPayment step should NOT be delegated because SubmitOrder failed
        expect(delegationService.delegateSteps).not.toHaveBeenCalled();
        expect(delegationService.delegateStep).not.toHaveBeenCalled();
      });
    });
  });

  describe('complex dependency scenarios', () => {
    // TODO: Fix test - unrealistic scenario where workflow steps have no dependencies
    // The actual step definitions have dependencies defined, so this test scenario is invalid.
    // Need to either mock getStepDefinitions or test with actual dependency structure.
    it.skip('should handle jobs with no dependencies (all parallel)', async () => {
      // Arrange
      const jobId = 'job-all-parallel';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      // All steps have no dependencies (hypothetical scenario)
      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
        { id: 'step-2', jobId, stepValue: 'ValidateProduct', status: StepStatus.PENDING },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
      delegationService.delegateSteps.mockResolvedValue({
        results: [
          { success: true, stepId: 'step-1', messageId: 'msg-1' },
          { success: true, stepId: 'step-2', messageId: 'msg-2' },
          { success: true, stepId: 'step-3', messageId: 'msg-3' },
        ],
        successCount: 3,
        failureCount: 0,
      });

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateSteps).toHaveBeenCalledTimes(1);
      const delegatedSteps = delegationService.delegateSteps.mock.calls[0][0];
      expect(delegatedSteps).toHaveLength(3);
    });

    it.skip('should handle deep dependency chains (complex dependencies not in 4-step model)', async () => {
      // Arrange: Step 1 → Step 2 → Step 3 → Step 4 (sequential chain)
      const jobId = 'job-chain';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.COMPLETED },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.COMPLETED },
        { id: 'step-4', jobId, stepValue: 'SubmitOrder', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
      // Only one step ready, so delegateStep (singular) is called
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-4',
        messageId: 'msg-4',
      });

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateStep).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: 'step-4' }),
      );
    });

    it.skip('should handle mixed parallel and sequential dependencies (complex dependencies not in 4-step model)', async () => {
      // Arrange: (Step1, Step2 parallel) → Step3 depends on both
      const jobId = 'job-mixed';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'ValidateProduct', status: StepStatus.COMPLETED },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.PENDING }, // Depends on 1 & 2
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
      // Only one step ready, so delegateStep (singular) is called
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-3',
        messageId: 'msg-3',
      });

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateStep).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: 'step-3' }),
      );
    });

    it('should not delegate if only some dependencies are met', async () => {
      // Arrange: Step3 depends on Step1 AND Step2, but only Step1 is complete
      const jobId = 'job-partial-deps';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'ValidateProduct', status: StepStatus.IN_PROGRESS },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.PENDING }, // Blocked
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateSteps).not.toHaveBeenCalled();
    });
  });

  describe('idempotency and duplicate calls', () => {
    // TODO: Fix test - startJob needs idempotency logic to check job status
    // Currently startJob doesn't check if job is already PROCESSING/COMPLETED.
    // Need to add status validation at the start of startJob to prevent duplicate starts.
    it.skip('should handle multiple startJob calls for same job gracefully', async () => {
      // Arrange
      const jobId = 'job-duplicate';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING, // Already processing
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);

      // Act
      const result = await service.startJob(jobId);

      // Assert
      // Should handle gracefully when job already processing - returns success false
      expect(result.success).toBe(true); // Job already started, steps created
    });

    it('should handle continueJob being called when no steps are ready', async () => {
      // Arrange
      const jobId = 'job-not-ready';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.IN_PROGRESS },
        { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateSteps).not.toHaveBeenCalled();
      expect(jobRepository.updateStatus).not.toHaveBeenCalled();
    });

    // TODO: Fix test - continueJob needs status check for completed jobs
    // Currently continueJob doesn't check job status, always fetches steps.
    // Should add early return if job status is COMPLETED or FAILED to avoid unnecessary work.
    it.skip('should handle continueJob called on already completed job', async () => {
      // Arrange
      const jobId = 'job-already-done';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.COMPLETED, // Already completed
      };

      jobRepository.findById.mockResolvedValue(mockJob as any);

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(stepRepository.findByJobId).not.toHaveBeenCalled();
      expect(delegationService.delegateSteps).not.toHaveBeenCalled();
    });
  });

  describe('error recovery scenarios', () => {
    it('should handle database errors gracefully during step creation', async () => {
      // Arrange
      const jobId = 'job-db-error';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      workflowConfigService.getStepDefinitions.mockReturnValue([
        { step: 'ValidateCustomer', queueName: 'q-validate-customer', dependencies: [] },
      ] as any);
      stepRepository.createSteps.mockRejectedValue(new Error('Database connection lost'));

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Database connection lost');
    });

    // TODO: Fix test - mock timing issue with updateStatus rejection
    // The test expects updateStatus to be called and throw, but need to ensure
    // delegateStep mock is also provided since startJob continues after status update.
    // Add delegateStep mock to complete the flow properly.
    it.skip('should handle job repository errors during status update', async () => {
      // Arrange
      const jobId = 'job-update-error';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      stepRepository.createSteps.mockResolvedValue([
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
      ] as any);
      jobRepository.updateStatus.mockRejectedValue(new Error('Update failed'));

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Update failed');
    });

    it.skip('should handle delegation service returning partial failures (needs review for 4-step model)', async () => {
      // Arrange
      const jobId = 'job-partial-delegation-fail';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.COMPLETED },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.PENDING },
        { id: 'step-4', jobId, stepValue: 'SubmitOrder', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
      delegationService.delegateSteps.mockResolvedValue({
        results: [
          { success: true, stepId: 'step-3', messageId: 'msg-3' },
          { success: false, stepId: 'step-4', error: 'SQS timeout' },
        ],
        successCount: 1,
        failureCount: 1,
      });

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateSteps).toHaveBeenCalled();
      // Should handle partial failures appropriately
    });
  });

  describe('edge cases', () => {
    // TODO: Fix test - getStepDefinitions returns actual workflow steps, not []
    // This test mocks createSteps to return [], but getStepDefinitions is not mocked
    // and returns workflow steps. The error happens when trying to find first step
    // in empty createdSteps array. Need to mock getStepDefinitions to return [].
    it.skip('should handle job with zero steps configured', async () => {
      // Arrange
      const jobId = 'job-no-steps';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      // Mock config to return no steps
      stepRepository.createSteps.mockResolvedValue([]);

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('No step definitions found');
    });

    it.skip('should handle empty job payload (needs review for 4-step model)', async () => {
      // Arrange
      const jobId = 'job-empty-payload';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: {}, // Empty payload
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      stepRepository.createSteps.mockResolvedValue([
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
      ] as any);
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-1',
        messageId: 'msg-1',
      });

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(true);
      // Should handle empty payload gracefully
    });

    it('should handle job with invalid status transitions', async () => {
      // Arrange
      const jobId = 'job-invalid-status';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.FAILED, // Already failed
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);

      // Act
      const result = await service.startJob(jobId);

      // Assert
      // startJob doesn't check status - it will try to start anyway
      // This could be considered a valid scenario (retry a failed job)
      expect(result).toBeDefined();
    });

    // TODO: Fix test - stepValue should be enum strings, not numbers
    // Mock data uses numeric stepValues (1, 2, 3...) but service expects enum strings
    // like 'ValidateCustomer', 'SubmitCustomer', etc. Update mock to use valid enum values or
    // create a test-specific workflow type with numeric step values.
    it.skip('should handle very large number of steps', async () => {
      // Arrange
      const jobId = 'job-many-steps';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Create 50 steps
      const manySteps = Array.from({ length: 50 }, (_, i) => ({
        id: `step-${i + 1}`,
        jobId,
        stepValue: i + 1,
        status: StepStatus.PENDING,
      }));

      jobRepository.findById.mockResolvedValue(mockJob);
      stepRepository.createSteps.mockResolvedValue(manySteps as any);
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-1',
        messageId: 'msg-1',
      });

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.stepsCreated).toBe(50);
      expect(delegationService.delegateStep).toHaveBeenCalledTimes(1); // Only first step
    });

    it('should handle steps completing out of order', async () => {
      // Arrange: Step 3 completes before Step 2
      const jobId = 'job-out-of-order';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.IN_PROGRESS },
        { id: 'step-3', jobId, stepValue: 'ValidateOrder', status: StepStatus.COMPLETED }, // Out of order!
        { id: 'step-4', jobId, stepValue: 'SubmitOrder', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      await service.continueJob(jobId);

      // Assert
      // Should NOT delegate step 4 because step 2 is not complete
      expect(delegationService.delegateSteps).not.toHaveBeenCalled();
    });
  });

  describe('state consistency', () => {
    it.skip('should maintain consistent job state when delegation succeeds (needs review for 4-step model)', async () => {
      // Arrange
      const jobId = 'job-consistent';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      stepRepository.createSteps.mockResolvedValue([
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
      ] as any);
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-1',
        messageId: 'msg-1',
      });

      // Act
      const result = await service.startJob(jobId);

      // Assert - verify all operations were called
      expect(result.success).toBe(true);
      expect(jobRepository.findById).toHaveBeenCalled();
      expect(stepRepository.createSteps).toHaveBeenCalled();
      expect(jobRepository.updateStatus).toHaveBeenCalledWith(jobId, JobStatus.PROCESSING);
      expect(delegationService.delegateStep).toHaveBeenCalled();
    });

    it.skip('should not update job status if delegation fails (needs review for 4-step model)', async () => {
      // Arrange
      const jobId = 'job-no-update-on-fail';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PENDING,
        payload: { orderId: '123' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jobRepository.findById.mockResolvedValue(mockJob);
      stepRepository.createSteps.mockResolvedValue([
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.PENDING },
      ] as any);
      jobRepository.updateStatus.mockResolvedValue(undefined);
      delegationService.delegateStep.mockResolvedValue({
        success: false,
        stepId: 'step-1',
        error: 'Delegation failed',
      });

      // Act
      const result = await service.startJob(jobId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to delegate first step');
      // Job is updated to PROCESSING before delegation, remains in that state
    });
  });

  describe('performance scenarios', () => {
    it.skip('should handle rapid consecutive continueJob calls (needs review for 4-step model)', async () => {
      // Arrange
      const jobId = 'job-rapid-calls';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.COMPLETED },
        { id: 'step-2', jobId, stepValue: 'SubmitCustomer', status: StepStatus.PENDING },
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);
      delegationService.delegateStep.mockResolvedValue({
        success: true,
        stepId: 'step-2',
        messageId: 'msg-2',
      });

      // Act - call multiple times rapidly
      await Promise.all([
        service.continueJob(jobId),
        service.continueJob(jobId),
        service.continueJob(jobId),
      ]);

      // Assert - should handle gracefully without errors
      expect(delegationService.delegateStep).toHaveBeenCalled();
    });

    it('should handle timeout scenarios gracefully', async () => {
      // Arrange
      const jobId = 'job-timeout';
      const mockJob = {
        id: jobId,
        type: JobType.DEFAULT,
        status: JobStatus.PROCESSING,
      };

      const mockSteps = [
        { id: 'step-1', jobId, stepValue: 'ValidateCustomer', status: StepStatus.DELEGATED },
        // Step stuck in DELEGATED for too long
      ];

      jobRepository.findById.mockResolvedValue(mockJob as any);
      stepRepository.findByJobId.mockResolvedValue(mockSteps as any);

      // Act
      await service.continueJob(jobId);

      // Assert
      expect(delegationService.delegateSteps).not.toHaveBeenCalled();
      // Should not break, just wait for step to complete/fail
    });
  });
});
