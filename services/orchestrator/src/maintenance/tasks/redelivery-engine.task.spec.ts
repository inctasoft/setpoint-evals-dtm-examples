import { Test, TestingModule } from '@nestjs/testing';
import { RedeliveryEngineTask } from './redelivery-engine.task';
import { Step, DeadLetter, JobStatus, StepStatus } from '@dtm/database';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { DelegationService } from '../../delegation/delegation.service';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';
import {
  QueueTransport,
  TaskTransportCapabilities,
} from '../../transport/queue-transport.interface';

/**
 * Redelivery engine maintenance task (Phase 1 of the bus-agnosticism program).
 *
 * The engine re-dispatches lease-expired DELEGATED / IN_PROGRESS /
 * IN_PROGRESS_RETRYING steps itself instead of relying on the bus's native
 * redelivery ("leave the SQS message undeleted"). It is a TOTAL NO-OP unless
 * the active transport declares `redelivery: 'orchestrator'` or the
 * REDELIVERY_ENGINE_FORCE_ENABLED escape hatch is set — under the default
 * aws/SQS profile nothing in this task may fire.
 */
describe('RedeliveryEngineTask', () => {
  let module: TestingModule;
  let task: RedeliveryEngineTask;
  let stepRepository: jest.Mocked<Repository<Step>>;
  let deadLetterRepository: jest.Mocked<Repository<DeadLetter>>;
  let delegationService: jest.Mocked<DelegationService>;
  let orchestrationService: jest.Mocked<OrchestrationService>;

  const mockStepRepository = {
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockDeadLetterRepository = {
    create: jest.fn().mockImplementation((v: unknown) => v),
    save: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockTaskRegistry = {
    register: jest.fn(),
  };

  const mockDelegationService = {
    retryDelegation: jest.fn(),
  };

  const mockOrchestrationService = {
    continueJob: jest.fn(),
  };

  const mockTransport = {
    capabilities: {
      stats: 'native',
      redelivery: 'bus',
      attemptCounter: 'native',
      dlq: 'native',
    } as TaskTransportCapabilities,
  };

  const mockAdvisoryLockService = {
    // LEADER-1: runExclusive pins acquire->fn->release on one connection; the
    // unit-test double just runs fn() through (lock behavior is proven by the SE).
    runExclusive: jest
      .fn()
      .mockImplementation((_lockId: number, fn: () => Promise<unknown>) => fn()),
  };

  /** Force the engine on via the env escape hatch (bus still declares 'bus'). */
  const forceEngineOn = () => {
    mockConfigService.get.mockImplementation((key: string, def?: string) => {
      if (key === 'REDELIVERY_ENGINE_FORCE_ENABLED') return 'true';
      if (key === 'REDELIVERY_LEASE_SECONDS') return '300';
      return def;
    });
  };

  const makeStep = (overrides: Partial<Step> = {}): Step =>
    ({
      id: 'step-1',
      stepValue: 'ValidateCustomer',
      status: StepStatus.DELEGATED,
      attemptCount: 1,
      maxRetryCount: 3,
      leaseExpiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
      input: { customerId: 1 },
      error: null,
      job: {
        id: 'job-123',
        status: JobStatus.PROCESSING,
        workflowName: 'order-processing',
      },
      ...overrides,
    }) as unknown as Step;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        RedeliveryEngineTask,
        { provide: getRepositoryToken(Step), useValue: mockStepRepository },
        { provide: getRepositoryToken(DeadLetter), useValue: mockDeadLetterRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
        { provide: DelegationService, useValue: mockDelegationService },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        { provide: QueueTransport, useValue: mockTransport },
        { provide: AdvisoryLockService, useValue: mockAdvisoryLockService },
      ],
    }).compile();

    task = module.get<RedeliveryEngineTask>(RedeliveryEngineTask);
    stepRepository = module.get(getRepositoryToken(Step));
    deadLetterRepository = module.get(getRepositoryToken(DeadLetter));
    delegationService = module.get(DelegationService);
    orchestrationService = module.get(OrchestrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockTransport.capabilities = {
      stats: 'native',
      redelivery: 'bus',
      attemptCounter: 'native',
      dlq: 'native',
    } as TaskTransportCapabilities;
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('getMetadata', () => {
    it('registers as a LEADER-guarded recovery task with a new lock id', () => {
      const metadata = task.getMetadata();

      expect(metadata.name).toBe('redelivery-engine');
      expect(metadata.category).toBe('recovery');
      expect(metadata.lockId).toBe(LockId.REDELIVERY_ENGINE);
      expect(metadata.enabled).toBe(true);
    });
  });

  describe('engine disabled (default aws profile)', () => {
    it('is a total no-op when the transport redelivers on the bus and no force flag is set', async () => {
      mockConfigService.get.mockImplementation((key: string, def?: string) => def);

      const result = await task.execute();

      expect(result.success).toBe(true);
      expect(result.message).toContain('skipped');
      expect(stepRepository.find).not.toHaveBeenCalled();
      expect(delegationService.retryDelegation).not.toHaveBeenCalled();
      expect(deadLetterRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('engine forced on (REDELIVERY_ENGINE_FORCE_ENABLED=true)', () => {
    beforeEach(() => {
      forceEngineOn();
      mockDelegationService.retryDelegation.mockResolvedValue({
        stepId: 'step-1',
        success: true,
        sqsMessageId: 'msg-new',
      });
    });

    it('activates when the transport declares orchestrator redelivery, even without the force flag', async () => {
      mockConfigService.get.mockImplementation((key: string, def?: string) => def);
      mockTransport.capabilities = {
        stats: 'none',
        redelivery: 'orchestrator',
        attemptCounter: 'synthetic',
        dlq: 'table',
      };
      mockStepRepository.find.mockResolvedValue([]);

      const result = await task.execute();

      expect(result.success).toBe(true);
      expect(stepRepository.find).toHaveBeenCalled();
    });

    it('re-dispatches a lease-expired DELEGATED step via DelegationService.retryDelegation', async () => {
      mockStepRepository.find.mockResolvedValue([makeStep()]);

      const result = await task.execute();

      expect(delegationService.retryDelegation).toHaveBeenCalledWith('step-1');
      expect(result.metrics?.reDispatched).toBe(1);
      expect(deadLetterRepository.save).not.toHaveBeenCalled();
    });

    it('re-dispatches a lease-expired IN_PROGRESS step (worker died mid-task)', async () => {
      mockStepRepository.find.mockResolvedValue([makeStep({ status: StepStatus.IN_PROGRESS })]);

      const result = await task.execute();

      expect(delegationService.retryDelegation).toHaveBeenCalledWith('step-1');
      expect(result.metrics?.reDispatched).toBe(1);
    });

    it('re-dispatches a lease-expired IN_PROGRESS_RETRYING step', async () => {
      mockStepRepository.find.mockResolvedValue([
        makeStep({ status: StepStatus.IN_PROGRESS_RETRYING }),
      ]);

      const result = await task.execute();

      expect(delegationService.retryDelegation).toHaveBeenCalledWith('step-1');
      expect(result.metrics?.reDispatched).toBe(1);
    });

    it('scans only the lease-based statuses with an expired lease', async () => {
      mockStepRepository.find.mockResolvedValue([]);

      await task.execute();

      const findArgs = mockStepRepository.find.mock.calls[0][0] as {
        where: { status: { _type: string; _value: StepStatus[] }; leaseExpiresAt: unknown };
      };
      const statuses = findArgs.where.status._value;
      expect(statuses).toEqual(
        expect.arrayContaining([
          StepStatus.DELEGATED,
          StepStatus.IN_PROGRESS,
          StepStatus.IN_PROGRESS_RETRYING,
        ]),
      );
      expect(statuses).toHaveLength(3);
      // leaseExpiresAt must be a LessThan(now) comparator — an unexpired or
      // NULL lease never matches, so untouched steps stay untouched.
      expect(findArgs.where.leaseExpiresAt).toMatchObject({ _type: 'lessThan' });
    });

    it('skips a step whose job is no longer PROCESSING', async () => {
      mockStepRepository.find.mockResolvedValue([
        makeStep({ job: { id: 'job-123', status: JobStatus.FAILED } as Step['job'] }),
      ]);

      const result = await task.execute();

      expect(delegationService.retryDelegation).not.toHaveBeenCalled();
      expect(result.metrics?.skipped).toBe(1);
      expect(result.metrics?.reDispatched).toBe(0);
    });

    it('dead-letters a step whose attempt count is exhausted and marks it FAILED', async () => {
      const step = makeStep({
        status: StepStatus.IN_PROGRESS_RETRYING,
        attemptCount: 3,
        maxRetryCount: 3,
        error: 'SIMULATED FAILURE [TESTING]',
      });
      mockStepRepository.find.mockResolvedValue([step]);

      const result = await task.execute();

      // No further re-dispatch once attempts are exhausted
      expect(delegationService.retryDelegation).not.toHaveBeenCalled();

      // A dead-letter row lands with the full diagnostic payload
      expect(deadLetterRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          stepId: 'step-1',
          jobId: 'job-123',
          workflowName: 'order-processing',
          stepValue: 'ValidateCustomer',
          attemptCount: 3,
          lastError: 'SIMULATED FAILURE [TESTING]',
          input: { customerId: 1 },
        }),
      );

      // The step goes FAILED
      expect(stepRepository.update).toHaveBeenCalledWith(
        'step-1',
        expect.objectContaining({ status: StepStatus.FAILED }),
      );

      // Orchestration is nudged so the job can reach its own terminal state
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-123');
      expect(result.metrics?.deadLettered).toBe(1);
    });

    it('does not re-dispatch a step that was already dead-lettered (terminal FAILED)', async () => {
      // After dead-lettering the step is FAILED, so the next scan's query
      // (non-terminal statuses only) no longer returns it.
      mockStepRepository.find.mockResolvedValue([]);

      const result = await task.execute();

      expect(delegationService.retryDelegation).not.toHaveBeenCalled();
      expect(deadLetterRepository.save).not.toHaveBeenCalled();
      expect(result.metrics?.reDispatched).toBe(0);
      expect(result.metrics?.deadLettered).toBe(0);
    });

    it('counts a failed re-dispatch without dead-lettering', async () => {
      mockStepRepository.find.mockResolvedValue([makeStep()]);
      mockDelegationService.retryDelegation.mockResolvedValue({
        stepId: 'step-1',
        success: false,
        error: 'transport down',
      });

      const result = await task.execute();

      expect(result.metrics?.reDispatched).toBe(0);
      expect(result.metrics?.failed).toBe(1);
      expect(deadLetterRepository.save).not.toHaveBeenCalled();
    });
  });
});
