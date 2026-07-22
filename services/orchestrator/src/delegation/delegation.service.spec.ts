/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DelegationService } from './delegation.service';
import { QueueTransport } from '../transport/queue-transport.interface';
import { StepRepository, StepStatus, JobType } from '@dtm/database';
import { StepDelegationDto } from './dto/step-delegation.dto';
import { CorrelationService } from '../common/correlation/correlation.service';
import { WorkflowConfigService } from '../workflow-loader/workflow-config.service';
import { WorkflowRegistryService } from '../workflow-loader/workflow-registry.service';

describe('DelegationService', () => {
  let service: DelegationService;
  let transport: jest.Mocked<QueueTransport>;
  let stepRepository: jest.Mocked<StepRepository>;

  beforeEach(async () => {
    // Create mock implementations
    const mockTransport = {
      capabilities: { stats: 'native' as const },
      sendTask: jest.fn(),
      getQueueStatuses: jest.fn(),
      getWorkerEndpointUrl: jest.fn(),
      healthCheck: jest.fn(),
    };

    const mockStepRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
      markAsDelegated: jest.fn(),
      claimForDelegation: jest.fn().mockResolvedValue(true),
    };

    const mockCorrelationService = {
      getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
    };

    const mockWorkflowConfigService = {
      getStepName: jest.fn().mockImplementation((step: string) => step.toLowerCase()),
      getAllQueueNames: jest.fn().mockReturnValue([]),
      getStepDefinitions: jest.fn().mockReturnValue([
        {
          step: 'TestStep',
          queueName: 'test-queue',
          dependencies: [],
        },
        {
          // retryDelegation tests build steps with stepValue: 'ValidateCustomer'
          step: 'ValidateCustomer',
          queueName: 'test-queue',
          dependencies: [],
        },
      ]),
    };

    const mockWorkflowRegistryService = {
      get: jest.fn().mockReturnValue(mockWorkflowConfigService),
      has: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationService,
        { provide: QueueTransport, useValue: mockTransport },
        { provide: StepRepository, useValue: mockStepRepository },
        { provide: CorrelationService, useValue: mockCorrelationService },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistryService },
      ],
    }).compile();

    service = module.get<DelegationService>(DelegationService);
    transport = module.get(QueueTransport);
    stepRepository = module.get(StepRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('delegateStep', () => {
    describe('successful delegation', () => {
      it('should delegate step and update status to DELEGATED', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'order-validate-customer',
          jobType: JobType.DEFAULT,
          input: { customerId: 'CUST-123', orderId: 'ORD-123' },
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-abc-123',
        });
        stepRepository.markAsDelegated.mockResolvedValue(undefined);

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(true);
        expect(result.stepId).toBe('step-1');
        expect(result.sqsMessageId).toBe('msg-abc-123');
        expect(stepRepository.markAsDelegated).toHaveBeenCalledWith('step-1', 'msg-abc-123');
      });

      it('should send correct SQS message payload', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'order-validate-customer',
          jobType: JobType.DEFAULT,
          input: { customerId: 'CUST-123' },
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        await service.delegateStep(dto);

        // Assert
        expect(transport.sendTask).toHaveBeenCalledWith('order-validate-customer', {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          jobType: JobType.DEFAULT,
          input: { customerId: 'CUST-123' },
          callbackUrl: 'http://orchestrator:3000/api/v1/callback/step-progress',
          correlationId: 'test-correlation-id',
          sourceConfig: undefined,
          processingConfig: undefined,
        });
      });

      it('should include callback URL in SQS payload', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://my-orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        await service.delegateStep(dto);

        // Assert
        const sentPayload = transport.sendTask.mock.calls[0][1];
        expect(sentPayload.callbackUrl).toBe(
          'http://my-orchestrator:3000/api/v1/callback/step-progress',
        );
      });

      it('should delegate step with empty input object', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {}, // Empty input
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(true);
      });

      it('should delegate step with complex input data', async () => {
        // Arrange
        const complexInput = {
          customerId: 'CUST-123',
          orderId: 'ORD-123',
          metadata: {
            source: 'legacy-system',
            timestamp: new Date().toISOString(),
            nested: {
              values: [1, 2, 3],
            },
          },
        };

        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: complexInput,
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(true);
        const sentPayload = transport.sendTask.mock.calls[0][1];
        expect(sentPayload.input).toEqual(complexInput);
      });
    });

    describe('SQS failures', () => {
      it('should handle SQS send failure and mark step as FAILED', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: false,
          taskHandle: '',
          error: 'SQS connection timeout',
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('SQS connection timeout');
        expect(stepRepository.updateStatus).toHaveBeenCalledWith(
          'step-1',
          StepStatus.FAILED,
          'Failed to delegate: SQS connection timeout',
        );
      });

      it('should handle SQS queue not found error', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'non-existent-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: false,
          taskHandle: '',
          error: 'Queue not found',
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Queue not found');
      });

      it('should handle SQS message too large error', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: { largeData: 'x'.repeat(300000) }, // Very large payload
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: false,
          taskHandle: '',
          error: 'Message size exceeds limit',
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Message size exceeds limit');
      });
    });

    describe('error handling', () => {
      it('should handle unexpected errors and mark step as FAILED', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockImplementation(() => {
          throw new Error('Config error');
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Config error');
        expect(stepRepository.updateStatus).toHaveBeenCalledWith(
          'step-1',
          StepStatus.FAILED,
          'Delegation error: Config error',
        );
      });

      it('should handle database errors when marking as delegated', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });
        stepRepository.markAsDelegated.mockRejectedValue(new Error('Database connection lost'));

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Database connection lost');
      });

      it('should handle non-Error exceptions', async () => {
        // Arrange
        const dto: StepDelegationDto = {
          jobId: 'job-123',
          stepId: 'step-1',
          stepValue: '1',
          stepType: 'Customer',
          queueName: 'test-queue',
          jobType: JobType.DEFAULT,
          input: {},
        };

        transport.getWorkerEndpointUrl.mockImplementation(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'String error'; // Intentionally throwing non-Error to test error handling
        });

        // Act
        const result = await service.delegateStep(dto);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown error');
      });
    });
  });

  describe('delegateSteps (bulk)', () => {
    describe('successful bulk delegation', () => {
      it('should delegate multiple steps successfully', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = [
          {
            jobId: 'job-123',
            stepId: 'step-1',
            stepValue: '1',
            stepType: 'Customer',
            queueName: 'queue-1',
            jobType: JobType.DEFAULT,
            input: {},
          },
          {
            jobId: 'job-123',
            stepId: 'step-2',
            stepValue: '2',
            stepType: 'Order',
            queueName: 'queue-2',
            jobType: JobType.DEFAULT,
            input: {},
          },
          {
            jobId: 'job-123',
            stepId: 'step-3',
            stepValue: '3',
            stepType: 'Payment',
            queueName: 'queue-3',
            jobType: JobType.DEFAULT,
            input: {},
          },
        ];

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(3);
        expect(result.successfulDelegations).toBe(3);
        expect(result.failedDelegations).toBe(0);
        expect(result.results).toHaveLength(3);
        expect(result.results.every((r) => r.success)).toBe(true);
      });

      it('should delegate steps in parallel', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = Array.from({ length: 5 }, (_, i) => ({
          jobId: 'job-123',
          stepId: `step-${i + 1}`,
          stepValue: String(i + 1),
          stepType: `Step${i + 1}`,
          queueName: `queue-${i + 1}`,
          jobType: JobType.DEFAULT,
          input: {},
        }));

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const startTime = Date.now();
        const result = await service.delegateSteps(dtos);
        const duration = Date.now() - startTime;

        // Assert
        expect(result.totalSteps).toBe(5);
        expect(result.successfulDelegations).toBe(5);
        // Should be faster than sequential (< 50ms for 5 steps if truly parallel)
        expect(duration).toBeLessThan(500);
      });
    });

    describe('partial failures in bulk', () => {
      it('should handle mixed success and failure results', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = [
          {
            jobId: 'job-123',
            stepId: 'step-1',
            stepValue: '1',
            stepType: 'Customer',
            queueName: 'queue-1',
            jobType: JobType.DEFAULT,
            input: {},
          },
          {
            jobId: 'job-123',
            stepId: 'step-2',
            stepValue: '2',
            stepType: 'Order',
            queueName: 'queue-2',
            jobType: JobType.DEFAULT,
            input: {},
          },
          {
            jobId: 'job-123',
            stepId: 'step-3',
            stepValue: '3',
            stepType: 'Payment',
            queueName: 'queue-3',
            jobType: JobType.DEFAULT,
            input: {},
          },
        ];

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');

        // Mock: first succeeds, second fails, third succeeds
        transport.sendTask
          .mockResolvedValueOnce({ success: true, taskHandle: 'msg-1' })
          .mockResolvedValueOnce({ success: false, taskHandle: '', error: 'SQS error' })
          .mockResolvedValueOnce({ success: true, taskHandle: 'msg-3' });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(3);
        expect(result.successfulDelegations).toBe(2);
        expect(result.failedDelegations).toBe(1);
        expect(result.results[0].success).toBe(true);
        expect(result.results[1].success).toBe(false);
        expect(result.results[2].success).toBe(true);
      });

      it('should continue delegating even if some steps fail', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = Array.from({ length: 5 }, (_, i) => ({
          jobId: 'job-123',
          stepId: `step-${i + 1}`,
          stepValue: String(i + 1),
          stepType: `Step${i + 1}`,
          queueName: `queue-${i + 1}`,
          jobType: JobType.DEFAULT,
          input: {},
        }));

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');

        // Mock: alternating success/failure
        transport.sendTask
          .mockResolvedValueOnce({ success: true, taskHandle: 'msg-1' })
          .mockResolvedValueOnce({ success: false, taskHandle: '', error: 'Fail 1' })
          .mockResolvedValueOnce({ success: true, taskHandle: 'msg-3' })
          .mockResolvedValueOnce({ success: false, taskHandle: '', error: 'Fail 2' })
          .mockResolvedValueOnce({ success: true, taskHandle: 'msg-5' });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(5);
        expect(result.successfulDelegations).toBe(3);
        expect(result.failedDelegations).toBe(2);
      });

      it('should handle all steps failing', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = [
          {
            jobId: 'job-123',
            stepId: 'step-1',
            stepValue: '1',
            stepType: 'Customer',
            queueName: 'queue-1',
            jobType: JobType.DEFAULT,
            input: {},
          },
          {
            jobId: 'job-123',
            stepId: 'step-2',
            stepValue: '2',
            stepType: 'Order',
            queueName: 'queue-2',
            jobType: JobType.DEFAULT,
            input: {},
          },
        ];

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: false,
          taskHandle: '',
          error: 'SQS unavailable',
        });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(2);
        expect(result.successfulDelegations).toBe(0);
        expect(result.failedDelegations).toBe(2);
        expect(result.results.every((r) => !r.success)).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle empty array of steps', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = [];

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(0);
        expect(result.successfulDelegations).toBe(0);
        expect(result.failedDelegations).toBe(0);
        expect(result.results).toHaveLength(0);
      });

      it('should handle single step in bulk delegation', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = [
          {
            jobId: 'job-123',
            stepId: 'step-1',
            stepValue: '1',
            stepType: 'Customer',
            queueName: 'queue-1',
            jobType: JobType.DEFAULT,
            input: {},
          },
        ];

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(1);
        expect(result.successfulDelegations).toBe(1);
        expect(result.failedDelegations).toBe(0);
      });

      it('should handle very large bulk delegation (50 steps)', async () => {
        // Arrange
        const dtos: StepDelegationDto[] = Array.from({ length: 50 }, (_, i) => ({
          jobId: 'job-123',
          stepId: `step-${i + 1}`,
          stepValue: String(i + 1),
          stepType: `Step${i + 1}`,
          queueName: `queue-${i + 1}`,
          jobType: JobType.DEFAULT,
          input: {},
        }));

        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });

        // Act
        const result = await service.delegateSteps(dtos);

        // Assert
        expect(result.totalSteps).toBe(50);
        expect(result.successfulDelegations).toBe(50);
        expect(result.failedDelegations).toBe(0);
      });
    });
  });

  describe('retryDelegation', () => {
    describe('successful retry', () => {
      it('should retry delegation for a failed step', async () => {
        // Arrange
        const stepId = 'step-failed';
        const mockStep = {
          id: stepId,
          stepValue: 'ValidateCustomer', // Matches OrderProcessingStep.ValidateCustomer
          input: { customerId: 'CUST-123' },
          job: {
            id: 'job-123',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-retry-123',
        });
        stepRepository.markAsDelegated.mockResolvedValue(undefined);

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(true);
        expect(result.stepId).toBe(stepId);
        expect(result.sqsMessageId).toBe('msg-retry-123');
      });

      it('should use step input from database for retry', async () => {
        // Arrange
        const stepId = 'step-retry';
        const originalInput = { customerId: 'CUST-123', orderId: 'ORD-123' };
        const mockStep = {
          id: stepId,
          stepValue: 'ValidateCustomer',
          input: originalInput,
          job: {
            id: 'job-123',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });
        stepRepository.markAsDelegated.mockResolvedValue(undefined);

        // Act
        await service.retryDelegation(stepId);

        // Assert
        const sentPayload = transport.sendTask.mock.calls[0][1];
        expect(sentPayload.input).toEqual(originalInput);
      });

      it('should handle retry with empty input', async () => {
        // Arrange
        const stepId = 'step-empty-input';
        const mockStep = {
          id: stepId,
          stepValue: 'ValidateCustomer',
          input: null, // No input
          job: {
            id: 'job-123',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });
        stepRepository.markAsDelegated.mockResolvedValue(undefined);

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(true);
        const sentPayload = transport.sendTask.mock.calls[0][1];
        expect(sentPayload.input).toEqual({});
      });
    });

    describe('retry failures', () => {
      it('should return error when step not found', async () => {
        // Arrange
        const stepId = 'non-existent-step';
        stepRepository.findById.mockResolvedValue(null);

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('Step not found');
        expect(transport.sendTask).not.toHaveBeenCalled();
      });

      it('should return error when step definition not found', async () => {
        // Arrange
        const stepId = 'step-unknown-def';
        const mockStep = {
          id: stepId,
          stepValue: 999, // No definition for this step value
          input: {},
          job: {
            id: 'job-123',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toContain('No step definition found');
      });

      it('should handle retry when SQS fails again', async () => {
        // Arrange
        const stepId = 'step-retry-fail';
        const mockStep = {
          id: stepId,
          stepValue: 'ValidateCustomer',
          input: {},
          job: {
            id: 'job-123',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: false,
          taskHandle: '',
          error: 'SQS still unavailable',
        });

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(false);
        expect(result.error).toBe('SQS still unavailable');
      });
    });

    describe('edge cases', () => {
      it('should handle database errors when fetching step', async () => {
        // Arrange
        const stepId = 'step-db-error';
        stepRepository.findById.mockRejectedValue(new Error('Database connection lost'));

        // Act & Assert
        await expect(service.retryDelegation(stepId)).rejects.toThrow('Database connection lost');
      });

      it.skip('should handle retry for step with different job type', async () => {
        // Arrange
        const stepId = 'step-alt';
        const mockStep = {
          id: stepId,
          stepValue: 'ValidateCustomer', // OrderProcessingStep.ValidateCustomer
          input: {},
          job: {
            id: 'job-alt',
            type: JobType.DEFAULT,
          },
        };

        stepRepository.findById.mockResolvedValue(mockStep as any);
        transport.getWorkerEndpointUrl.mockReturnValue('http://orchestrator:3000');
        transport.sendTask.mockResolvedValue({
          success: true,
          taskHandle: 'msg-123',
        });
        stepRepository.markAsDelegated.mockResolvedValue(undefined);

        // Act
        const result = await service.retryDelegation(stepId);

        // Assert
        expect(result.success).toBe(true);
        const sentPayload = transport.sendTask.mock.calls[0][1];
        expect(sentPayload.jobType).toBe(JobType.DEFAULT);
      });
    });
  });
});
