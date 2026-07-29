/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { CallbackService } from './callback.service';
import { JobRepository, StepRepository, StepStatus, JobType } from '@dtm/database';
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

/**
 * Bus-neutral retry metadata compat aliases (operator decision D-D).
 *
 * The worker→orchestrator callback wire gains `attemptNumber` / `taskHandle`
 * as the bus-neutral names for `sqsReceiveCount` / `sqsMessageId`. During the
 * mixed-version release window the orchestrator must accept BOTH:
 *  - an old worker sending only `sqsReceiveCount` / `sqsMessageId` must
 *    populate execution history exactly as it does today;
 *  - when both names are present (new worker), the bus-neutral names win.
 */
describe('CallbackService — retryMetadata compat aliases', () => {
  let service: CallbackService;
  let stepRepository: jest.Mocked<StepRepository>;

  const mockStepRepository = {
    findById: jest.fn(),
    findByJobId: jest.fn(),
    updateStatus: jest.fn(),
    updateFromCallback: jest.fn(),
    update: jest.fn(),
  };

  const mockJobRepository = {
    findById: jest.fn(),
  };

  const mockOrchestrationService = {
    continueJob: jest
      .fn()
      .mockResolvedValue({ success: true, nextStepDelegated: false, jobComplete: false }),
  };

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

  const mockWorkflowConfigService = {
    getStepName: jest.fn().mockReturnValue('test-step'),
    getStepDefinition: jest.fn().mockReturnValue(undefined),
    getStepDefinitions: jest.fn().mockReturnValue([]),
    getCascades: jest.fn().mockReturnValue([]),
    getCascadeByStep: jest.fn(),
    isOutputStep: jest.fn().mockReturnValue(false),
  };

  const mockWorkflowRegistryService = {
    get: jest.fn().mockReturnValue(mockWorkflowConfigService),
    has: jest.fn().mockReturnValue(true),
  };

  const makeStep = () => ({
    id: 'step-1',
    status: StepStatus.DELEGATED,
    stepValue: 'ValidateCustomer',
    retryCount: 0,
    maxRetryCount: 3,
    startedAt: new Date(),
    executionHistory: [],
  });

  const makeJob = () => ({
    id: 'job-123',
    type: JobType.DEFAULT,
    workflowName: 'order-processing',
    payload: {},
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallbackService,
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: StepRepository, useValue: mockStepRepository },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        {
          provide: CascadePublishService,
          useValue: {
            areCascadeDependenciesMet: jest.fn().mockReturnValue(true),
            injectFkValues: jest
              .fn()
              .mockImplementation((_c: unknown, _s: unknown, d: unknown) => d),
          },
        },
        {
          provide: FanOutService,
          useValue: { handleDiscoveryComplete: jest.fn(), handleChildStepComplete: jest.fn() },
        },
        { provide: KafkaService, useValue: { publish: jest.fn().mockResolvedValue(true) } },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistryService },
        { provide: EventsGateway, useValue: { broadcast: jest.fn() } },
        {
          provide: CorrelationService,
          useValue: { getCorrelationId: jest.fn().mockReturnValue('test-correlation-id') },
        },
        { provide: QueueTransport, useValue: mockTransport },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CallbackService>(CallbackService);
    stepRepository = module.get(StepRepository);

    mockStepRepository.findById.mockResolvedValue(makeStep() as any);
    mockJobRepository.findById.mockResolvedValue(makeJob() as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const lastHistoryEntry = () => {
    const call = stepRepository.updateFromCallback.mock.calls[0];
    expect(call).toBeDefined();
    const history = call[1].executionHistory ?? [];
    expect(history).toHaveLength(1);
    return history[0];
  };

  it('old worker (only sqsReceiveCount/sqsMessageId) populates execution history exactly as today', async () => {
    const dto: StepProgressDto = {
      jobId: 'job-123',
      stepId: 'step-1',
      status: StepStatus.COMPLETED,
      recordsProcessed: 1,
      output: { ok: true },
      retryMetadata: {
        sqsMessageId: 'msg-1',
        sqsReceiveCount: 2,
        processingTimeMs: 120,
        isRetry: true,
      },
    };

    await service.handleStepProgress(dto);

    const entry = lastHistoryEntry();
    expect(entry.sqsReceiveCount).toBe(2);
    expect(entry.sqsMessageId).toBe('msg-1');
    expect(entry.processingTimeMs).toBe(120);
  });

  it('new worker (attemptNumber/taskHandle) lands in the same history fields', async () => {
    const dto: StepProgressDto = {
      jobId: 'job-123',
      stepId: 'step-1',
      status: StepStatus.COMPLETED,
      recordsProcessed: 1,
      output: { ok: true },
      retryMetadata: {
        taskHandle: 'task-handle-9',
        attemptNumber: 3,
        processingTimeMs: 90,
        isRetry: true,
      },
    };

    await service.handleStepProgress(dto);

    const entry = lastHistoryEntry();
    expect(entry.sqsReceiveCount).toBe(3);
    expect(entry.sqsMessageId).toBe('task-handle-9');
    expect(entry.taskHandle).toBe('task-handle-9');
  });

  it('mixed-version payload (both names present): the bus-neutral names are preferred', async () => {
    const dto: StepProgressDto = {
      jobId: 'job-123',
      stepId: 'step-1',
      status: StepStatus.COMPLETED,
      recordsProcessed: 1,
      output: { ok: true },
      retryMetadata: {
        // New primaries — worker-sdk sends both during the transition window
        taskHandle: 'task-handle-9',
        attemptNumber: 5,
        // Legacy aliases (would say something different if they won)
        sqsMessageId: 'msg-1',
        sqsReceiveCount: 2,
        processingTimeMs: 90,
        isRetry: true,
      },
    };

    await service.handleStepProgress(dto);

    const entry = lastHistoryEntry();
    expect(entry.sqsReceiveCount).toBe(5);
    expect(entry.sqsMessageId).toBe('task-handle-9');
    expect(entry.taskHandle).toBe('task-handle-9');
  });
});
