import { Test, TestingModule } from '@nestjs/testing';
import { AcknowledgementHandler } from './acknowledgement.handler';
import { StepRepository, StepStatus } from '@dtm/database';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import { CascadePublishService } from '../../orchestration/cascade-publish.service';
import { FanOutService } from '../../orchestration/fan-out.service';
import { CorrelationService } from '../../common/correlation/correlation.service';
import { WorkflowRegistryService } from '../../workflow-loader/workflow-registry.service';
import { EventsGateway } from '../../websocket/events.gateway';
import { EachMessagePayload } from 'kafkajs';

describe('AcknowledgementHandler', () => {
  let handler: AcknowledgementHandler;
  let stepRepository: jest.Mocked<StepRepository>;
  let orchestrationService: jest.Mocked<OrchestrationService>;
  let cascadePublishService: jest.Mocked<CascadePublishService>;
  let workflowRegistryService: jest.Mocked<WorkflowRegistryService>;
  // Chainable QueryBuilder mock — handler uses .createQueryBuilder().update().set().where().execute(),
  // NOT repo.save(). Exposed at describe scope so tests can assert on .set()/.execute() calls.
  let mockQueryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    execute: jest.Mock;
  };

  // Sample test data
  const mockJobId = '550e8400-e29b-41d4-a716-446655440000';
  const mockStepId = '660e8400-e29b-41d4-a716-446655440001';

  beforeEach(async () => {
    // Create mocks
    mockQueryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const mockStepRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
      repo: {
        save: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      },
    };

    const mockOrchestrationService = {
      continueJob: jest.fn(),
    };

    const mockCorrelationService = {
      getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
      runWithCorrelationId: jest.fn(async (fn) => await fn()),
    };

    const mockCascadePublishService = {
      areCascadeDependenciesMet: jest.fn().mockReturnValue(true),
      injectFkValues: jest
        .fn()
        .mockImplementation((_et: unknown, _steps: unknown, data: unknown) => data),
      hasDependentCascades: jest.fn().mockReturnValue(false),
      publishCascade: jest.fn().mockResolvedValue(undefined),
    };

    const mockFanOutService = {
      handleDiscoveryComplete: jest.fn(),
      handleChildStepComplete: jest.fn(),
    };

    const mockWorkflowRegistryService = {
      get: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      // Topic-aware: mirrors the real registry, which looks up the topic and returns
      // undefined for anything unregistered (used by the "unknown topic" test below).
      getByAckTopic: jest
        .fn()
        .mockImplementation((topic: string) =>
          topic === 'order-processing.customer.ack'
            ? { config: {}, cascadeName: 'customer' }
            : undefined,
        ),
    };

    const mockEventsGateway = {
      broadcast: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcknowledgementHandler,
        {
          provide: StepRepository,
          useValue: mockStepRepository,
        },
        {
          provide: OrchestrationService,
          useValue: mockOrchestrationService,
        },
        {
          provide: CascadePublishService,
          useValue: mockCascadePublishService,
        },
        {
          provide: FanOutService,
          useValue: mockFanOutService,
        },
        {
          provide: CorrelationService,
          useValue: mockCorrelationService,
        },
        {
          provide: WorkflowRegistryService,
          useValue: mockWorkflowRegistryService,
        },
        {
          provide: EventsGateway,
          useValue: mockEventsGateway,
        },
      ],
    }).compile();

    handler = module.get<AcknowledgementHandler>(AcknowledgementHandler);
    stepRepository = module.get(StepRepository);
    orchestrationService = module.get(OrchestrationService);
    cascadePublishService = module.get(CascadePublishService);
    workflowRegistryService = module.get(WorkflowRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleMessage', () => {
    it('should process customer acknowledgement successfully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
        acknowledgedAt: '2025-01-01T00:00:00Z',
        metadata: { status: 'processed' },
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        jobId: mockJobId,
        name: 'SubmitCustomer',
        status: StepStatus.WAITING_FOR_ACK,
        ackReceivedAt: null,
        ackMetadata: null,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce({
        ...mockStep,
        status: StepStatus.COMPLETED,
      } as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'Orchestration continued',
        nextStepDelegated: 'NextStep',
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).toHaveBeenCalledWith(mockStepId);
      expect(stepRepository.updateStatus).toHaveBeenCalledWith(mockStepId, StepStatus.COMPLETED);
      // ACK metadata is written via a targeted UPDATE query builder (not repo.save()) so
      // it doesn't clobber the output field if it's being written concurrently.
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
      expect(orchestrationService.continueJob).toHaveBeenCalledWith(mockJobId);
    });

    // Regression test for T2 (parallel-ACK race / RC5): hasDependentCascades() must be
    // checked against the ACKed step's OWN workflow config, not the DI-default
    // WorkflowConfigService (which only ever matches the first-registered workflow,
    // order-processing). Before the fix, `resolved.config` from
    // WorkflowRegistryService.getByAckTopic() was resolved but discarded — cascade
    // checks for non-default workflows (infra-provisioning, iot-sensor-pipeline)
    // silently always saw hasDependentCascades() return false, so
    // checkAndExecutePendingPublishSteps() (the retry hook for a cascade whose publish
    // was earlier deferred because a sibling parent hadn't ACKed yet) never fired.
    it("resolves cascade checks against the ACKed topic's own workflow config, not the DI-default", async () => {
      // A distinguishable per-workflow config marker — NOT the DI-default {}
      // returned by other tests' getByAckTopic mock.
      const infraProvisioningConfigMarker = { __workflow: 'infra-provisioning' };

      (workflowRegistryService.getByAckTopic as jest.Mock).mockReturnValueOnce({
        config: infraProvisioningConfigMarker,
        cascadeName: 'network',
      });
      cascadePublishService.hasDependentCascades.mockReturnValueOnce(false);

      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
        acknowledgedAt: '2025-01-01T00:00:00Z',
      };

      const payload: EachMessagePayload = {
        topic: 'infra-provisioning.network.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = { id: mockStepId, status: StepStatus.WAITING_FOR_ACK };
      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce({
        ...mockStep,
        status: StepStatus.COMPLETED,
      } as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'Orchestration continued',
      });

      await handler.handleMessage(payload);

      // The gate MUST be checked against the resolved per-topic workflow config
      // (infraProvisioningConfigMarker), never a bare/default call.
      expect(cascadePublishService.hasDependentCascades).toHaveBeenCalledWith(
        'network',
        infraProvisioningConfigMarker,
      );
    });

    it('should process customer order acknowledgement successfully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
        acknowledgedAt: '2025-01-01T00:00:00Z',
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce({
        ...mockStep,
        status: StepStatus.COMPLETED,
      } as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'Job completed',
        jobComplete: true,
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).toHaveBeenCalledWith(mockStepId);
      expect(stepRepository.updateStatus).toHaveBeenCalledWith(mockStepId, StepStatus.COMPLETED);
      expect(orchestrationService.continueJob).toHaveBeenCalledWith(mockJobId);
    });

    it('should throw for empty message value (poison pill to DLQ)', async () => {
      // Arrange
      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: null,
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      // Act & Assert - should throw to send poison pill to DLQ
      await expect(handler.handleMessage(payload)).rejects.toThrow(
        'Acknowledgement message value is null',
      );
      expect(stepRepository.findById).not.toHaveBeenCalled();
    });

    it('should throw for invalid JSON (poison pill to DLQ)', async () => {
      // Arrange
      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from('invalid-json{'),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      // Act & Assert - should throw to send poison pill to DLQ
      await expect(handler.handleMessage(payload)).rejects.toThrow('JSON parse error');
      expect(stepRepository.findById).not.toHaveBeenCalled();
    });

    it('should warn about unknown topic', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'unknown.topic',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should handle missing jobId or stepId gracefully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        // stepId is missing
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).not.toHaveBeenCalled();
      expect(stepRepository.updateStatus).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should handle non-existent step gracefully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      stepRepository.findById.mockResolvedValue(null);

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).toHaveBeenCalledWith(mockStepId);
      expect(stepRepository.updateStatus).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should ignore duplicate acknowledgement for already completed step', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.COMPLETED,
      };

      stepRepository.findById.mockResolvedValue(mockStep as any);

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).toHaveBeenCalledWith(mockStepId);
      expect(stepRepository.updateStatus).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should store acknowledgement metadata without acknowledgedAt', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
        // acknowledgedAt is missing - should use current date
        metadata: { ext_id: '12345' },
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
        ackReceivedAt: null,
        ackMetadata: null,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'Continued',
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.updateStatus).toHaveBeenCalledWith(mockStepId, StepStatus.COMPLETED);
      // ACK metadata is written via .createQueryBuilder().update().set({...}) — verify the
      // values passed to .set() rather than a repo.save() payload (handler no longer calls save()).
      expect(mockQueryBuilder.set).toHaveBeenCalled();
      const savedStep = mockQueryBuilder.set.mock.calls[0][0];
      expect(savedStep.ackReceivedAt).toBeInstanceOf(Date);
      expect(savedStep.ackMetadata).toEqual({
        ext_id: '12345',
        acknowledgedBy: 'external-system',
        cascadeName: 'customer',
      });
    });

    it('should handle orchestration failure gracefully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: false,
        message: 'No pending steps',
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.updateStatus).toHaveBeenCalledWith(mockStepId, StepStatus.COMPLETED);
      expect(orchestrationService.continueJob).toHaveBeenCalledWith(mockJobId);
      // Should not throw despite orchestration failure
    });

    it('should handle database errors gracefully without throwing', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      stepRepository.findById.mockRejectedValue(new Error('Database connection lost'));

      // Act & Assert - should not throw
      await expect(handler.handleMessage(payload)).resolves.not.toThrow();
      expect(stepRepository.updateStatus).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });

    it('should include additional message properties in metadata', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
        acknowledgedAt: '2025-01-01T00:00:00Z',
        customField1: 'value1',
        customField2: 123,
        metadata: { existing: 'data' },
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'Continued',
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      // ACK metadata is written via .createQueryBuilder().update().set({...}), not repo.save().
      expect(mockQueryBuilder.set).toHaveBeenCalled();
      const savedStep = mockQueryBuilder.set.mock.calls[0][0];
      expect(savedStep.ackMetadata).toEqual({
        existing: 'data',
        customField1: 'value1',
        customField2: 123,
        acknowledgedBy: 'external-system',
        cascadeName: 'customer',
      });
    });

    it('should handle orchestration result with no next steps', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
      };

      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.findById.mockResolvedValueOnce(mockStep as any);
      stepRepository.updateStatus.mockResolvedValue(undefined);
      stepRepository.repo.save.mockResolvedValue(undefined);
      orchestrationService.continueJob.mockResolvedValue({
        success: true,
        message: 'No pending steps',
        nextStepDelegated: null,
        jobComplete: false,
      });

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(orchestrationService.continueJob).toHaveBeenCalledWith(mockJobId);
      // Should complete successfully even without next steps
    });

    it('should handle step in FAILED status gracefully', async () => {
      // Arrange
      const message = {
        jobId: mockJobId,
        stepId: mockStepId,
      };

      const payload: EachMessagePayload = {
        topic: 'order-processing.customer.ack',
        partition: 0,
        message: {
          key: Buffer.from('key'),
          value: Buffer.from(JSON.stringify(message)),
          timestamp: '1234567890',
          attributes: 0,
          offset: '0',
          headers: {},
          size: 0,
        },
      };

      const mockStep = {
        id: mockStepId,
        status: StepStatus.FAILED,
      };

      stepRepository.findById.mockResolvedValue(mockStep as any);

      // Act
      await handler.handleMessage(payload);

      // Assert
      expect(stepRepository.findById).toHaveBeenCalledWith(mockStepId);
      expect(stepRepository.updateStatus).not.toHaveBeenCalled();
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should log initialization message', () => {
      // Arrange
      const logSpy = jest.spyOn(handler['logger'], 'log');

      // Act
      handler.onModuleInit();

      // Assert
      expect(logSpy).toHaveBeenCalledWith('✅ AcknowledgementHandler initialized');
    });
  });
});
