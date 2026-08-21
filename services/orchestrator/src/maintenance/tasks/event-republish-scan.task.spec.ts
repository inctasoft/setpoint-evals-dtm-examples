import { Test, TestingModule } from '@nestjs/testing';
import { Step, JobStatus, StepStatus } from '@dtm/database';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventRepublishScanTask } from './event-republish-scan.task';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { AdvisoryLockService } from '../advisory-lock.service';
import { CascadePublishService } from '../../orchestration/cascade-publish.service';
import { EventBus, EventBusCapabilities } from '../../event-bus/event-bus.interface';

/**
 * Event Republish Scan Task (Phase 3, the A5 gap-closer) — RED-first.
 *
 * Under a drop-realistic event bus (zmq PUB/SUB), a publish fired while no
 * subscriber is attached vanishes silently; the step sits WAITING_FOR_ACK
 * until the 30-minute stuck-ack task auto-FAILS it. This scan re-publishes
 * un-ACKed steps past a short lease (and re-fires pending publishes) on a
 * 30s cadence. It is a TOTAL NO-OP under the brokered Kafka bus (fail-closed
 * capability gate) unless the EVENT_REPUBLISH_SCAN_FORCE_ENABLED escape
 * hatch is set — kafka behavior stays byte-identical.
 */
describe('EventRepublishScanTask', () => {
  let module: TestingModule;
  let task: EventRepublishScanTask;

  const mockStepRepository = {
    find: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn(),
  };
  const mockTaskRegistry = {
    register: jest.fn(),
  };
  const mockCascadePublishService = {
    republishStepEvent: jest.fn(),
    checkAndExecutePendingPublishSteps: jest.fn(),
  };
  const mockEventBus = {
    capabilities: {
      droppedPublishRecovery: 'orchestrator',
    } as EventBusCapabilities,
  };
  const mockAdvisoryLockService = {
    runExclusive: jest
      .fn()
      .mockImplementation((_lockId: number, fn: () => Promise<unknown>) => fn()),
  };

  const kafkaBus = () => {
    mockEventBus.capabilities = {
      droppedPublishRecovery: 'bus',
    } as EventBusCapabilities;
  };
  const zmqBus = () => {
    mockEventBus.capabilities = {
      droppedPublishRecovery: 'orchestrator',
    } as EventBusCapabilities;
  };

  const makeWaitingStep = (overrides: Partial<Step> = {}): Step =>
    ({
      id: 'step-ack-1',
      stepValue: 'SubmitCustomer',
      status: StepStatus.WAITING_FOR_ACK,
      kafkaPublishedAt: new Date(Date.now() - 120 * 1000), // published 2 min ago, no ACK
      output: { submittedCustomers: [{ customerId: 1 }] },
      job: {
        id: 'job-1',
        status: JobStatus.PROCESSING,
        workflowName: 'order-processing',
      },
      ...overrides,
    }) as unknown as Step;

  const makePendingStep = (overrides: Partial<Step> = {}): Step =>
    ({
      id: 'step-pending-1',
      stepValue: 'SubmitOrder',
      status: StepStatus.COMPLETED,
      kafkaPublishedAt: null, // transformation done, publish never fired
      output: { submittedOrders: [{ orderId: 1 }] },
      job: {
        id: 'job-1',
        status: JobStatus.PROCESSING,
        workflowName: 'order-processing',
      },
      ...overrides,
    }) as unknown as Step;

  beforeEach(async () => {
    jest.clearAllMocks();
    zmqBus();
    mockConfigService.get.mockImplementation((key: string, def?: string) => {
      if (key === 'EVENT_REPUBLISH_SCAN_FORCE_ENABLED') return 'false';
      if (key === 'EVENT_REPUBLISH_LEASE_SECONDS') return '60';
      return def;
    });
    mockCascadePublishService.republishStepEvent.mockResolvedValue(true);
    mockCascadePublishService.checkAndExecutePendingPublishSteps.mockResolvedValue({
      checkedSteps: 4,
      publishedSteps: 1,
      details: [],
    });

    module = await Test.createTestingModule({
      providers: [
        EventRepublishScanTask,
        { provide: getRepositoryToken(Step), useValue: mockStepRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
        { provide: CascadePublishService, useValue: mockCascadePublishService },
        { provide: EventBus, useValue: mockEventBus },
        { provide: AdvisoryLockService, useValue: mockAdvisoryLockService },
      ],
    }).compile();

    task = module.get(EventRepublishScanTask);
  });

  it('registers with the maintenance registry and takes its own advisory lock id', () => {
    expect(mockTaskRegistry.register).toHaveBeenCalledWith(task);
    expect(task.getMetadata().lockId).toBeDefined();
    expect(task.getMetadata().name).toBe('event-republish-scan');
  });

  it('SE-REPUB-gate-off: TOTAL no-op under the brokered kafka bus (fail-closed)', async () => {
    kafkaBus();

    expect(await task.canRun()).toBe(false);
  });

  it('SE-REPUB-gate-on: active under a drops-realistic bus, and via the escape hatch under kafka', async () => {
    expect(await task.canRun()).toBe(true);

    kafkaBus();
    mockConfigService.get.mockImplementation((key: string, def?: string) =>
      key === 'EVENT_REPUBLISH_SCAN_FORCE_ENABLED' ? 'true' : def,
    );
    expect(await task.canRun()).toBe(true);
  });

  it('SE-REPUB-unacked: re-publishes a WAITING_FOR_ACK step whose publish is past the lease', async () => {
    const step = makeWaitingStep();
    mockStepRepository.find
      .mockResolvedValueOnce([step]) // expired un-ACKed publishes
      .mockResolvedValueOnce([]); // pending (never-fired) publishes

    const result = await task.execute();

    expect(result.success).toBe(true);
    expect(mockCascadePublishService.republishStepEvent).toHaveBeenCalledTimes(1);
    expect(mockCascadePublishService.republishStepEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step-ack-1' }),
    );
    expect(result.metrics?.republished).toBe(1);
  });

  it('SE-REPUB-lease-fresh: the un-ACKed scan only selects publishes older than the lease cutoff', async () => {
    mockStepRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const before = Date.now();
    await task.execute();
    const after = Date.now();

    const where = mockStepRepository.find.mock.calls[0][0].where as {
      status: StepStatus;
      kafkaPublishedAt: { _type: string; _value: Date };
    };
    expect(where.status).toBe(StepStatus.WAITING_FOR_ACK);
    // The cutoff must be ~EVENT_REPUBLISH_LEASE_SECONDS (60s) in the past —
    // a step published 5s ago never matches it (fresh ACK windows untouched).
    const cutoffMs = where.kafkaPublishedAt._value.getTime();
    expect(cutoffMs).toBeLessThanOrEqual(before - 59 * 1000);
    expect(cutoffMs).toBeGreaterThan(after - 61 * 1000);
    expect(mockCascadePublishService.republishStepEvent).not.toHaveBeenCalled();
  });

  it('SE-REPUB-terminal-job: steps of a non-PROCESSING job are skipped (terminal guard)', async () => {
    const step = makeWaitingStep({
      job: { id: 'job-1', status: JobStatus.COMPLETED, workflowName: 'order-processing' } as never,
    });
    mockStepRepository.find.mockResolvedValueOnce([step]).mockResolvedValueOnce([]);

    const result = await task.execute();

    expect(mockCascadePublishService.republishStepEvent).not.toHaveBeenCalled();
    expect(result.metrics?.skipped).toBe(1);
  });

  it('SE-REPUB-pending: COMPLETED steps with kafkaPublishedAt NULL re-fire the pending-publish check per job', async () => {
    const pending = makePendingStep();
    mockStepRepository.find
      .mockResolvedValueOnce([]) // no expired un-ACKed
      .mockResolvedValueOnce([pending]); // pending publishes

    const result = await task.execute();

    expect(mockCascadePublishService.checkAndExecutePendingPublishSteps).toHaveBeenCalledTimes(1);
    expect(mockCascadePublishService.checkAndExecutePendingPublishSteps).toHaveBeenCalledWith(
      'job-1',
    );
    expect(result.metrics?.pendingPublished).toBe(1);
  });

  it('SE-REPUB-idle: nothing to scan → clean no-op result', async () => {
    mockStepRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await task.execute();

    expect(result.success).toBe(true);
    expect(result.metrics?.republished).toBe(0);
    expect(result.metrics?.pendingPublished).toBe(0);
    expect(mockCascadePublishService.republishStepEvent).not.toHaveBeenCalled();
  });
});
