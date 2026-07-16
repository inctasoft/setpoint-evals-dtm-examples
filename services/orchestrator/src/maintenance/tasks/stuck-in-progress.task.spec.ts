/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { StuckInProgressTask } from './stuck-in-progress.task';
import { Step, StepStatus } from '@dtm/database';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import { WorkflowConfigService } from '../../workflow-loader/workflow-config.service';
import { WorkflowRegistryService } from '../../workflow-loader/workflow-registry.service';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';

describe('StuckInProgressTask', () => {
  let module: TestingModule;
  let task: StuckInProgressTask;
  let stepRepository: jest.Mocked<Repository<Step>>;

  // Shared mocks
  const mockStepRepository = {
    find: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: string) => {
      if (key === 'MAINTENANCE_STUCK_IN_PROGRESS_TIMEOUT_MINUTES') return '30';
      return defaultValue;
    }),
  };

  const mockTaskRegistry = {
    register: jest.fn(),
  };

  const mockOrchestrationService = {
    continueJob: jest.fn(),
  };

  const mockWorkflowConfigService = {
    getStepName: jest.fn().mockImplementation((step: string) => step.toLowerCase()),
    getStepDefinition: jest.fn().mockReturnValue(undefined),
  };

  // A DIFFERENT workflow's config — distinguishable return value proves the
  // task actually resolved against it instead of falling back to the default.
  const mockIotWorkflowConfigService = {
    getStepName: jest.fn(),
    getStepDefinition: jest.fn().mockReturnValue({ step: 'IngestReading', timeoutMs: 5000 }),
  };

  const mockWorkflowRegistry = {
    has: jest.fn().mockImplementation((name: string) => name === 'iot-sensor-pipeline'),
    get: jest.fn().mockImplementation((name: string) => {
      if (name === 'iot-sensor-pipeline') return mockIotWorkflowConfigService;
      throw new Error(`unexpected workflow lookup in test: ${name}`);
    }),
  };

  const mockAdvisoryLockService = {
    // LEADER-1: runExclusive pins acquire->fn->release on one connection; the
    // unit-test double just runs fn() through (lock behavior is proven by the SE).
    runExclusive: jest
      .fn()
      .mockImplementation((_lockId: number, fn: () => Promise<unknown>) => fn()),
  };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        StuckInProgressTask,
        {
          provide: getRepositoryToken(Step),
          useValue: mockStepRepository,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        { provide: WorkflowConfigService, useValue: mockWorkflowConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistry },
        { provide: AdvisoryLockService, useValue: mockAdvisoryLockService },
      ],
    }).compile();

    task = module.get<StuckInProgressTask>(StuckInProgressTask);
    stepRepository = module.get(getRepositoryToken(Step));
    configService = module.get(ConfigService);
    taskRegistry = module.get(MaintenanceTaskRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('getMetadata', () => {
    it('should return correct task metadata', () => {
      // Act
      const metadata = task.getMetadata();

      // Assert
      expect(metadata).toEqual({
        name: 'stuck-in-progress',
        description:
          'Detects steps stuck in IN_PROGRESS state and auto-fails them after per-step timeout',
        schedule: '0 */10 * * * *',
        priority: 85,
        category: 'recovery',
        timeoutMs: 120000,
        enabled: true,
        lockId: LockId.STUCK_IN_PROGRESS, // LEADER-1
      });
    });
  });

  describe('Detection Logic', () => {
    it('should detect steps stuck in in_progress state beyond threshold', async () => {
      // Arrange
      const stuckTimestamp = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago

      const stuckStep: Partial<Step> = {
        id: 'step-stuck',
        stepValue: 'ValidateCustomer',
        status: StepStatus.IN_PROGRESS,
        startedAt: stuckTimestamp,
        job: { id: 'job-123' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.stuckStepsFound).toBe(1);
      expect(result.metrics.stuckInProgress).toBe(1);
      expect(result.findings).toHaveLength(1);
    });

    it('should NOT flag recently started steps', async () => {
      // Arrange - Step started 5 minutes ago (within threshold)
      stepRepository.find.mockResolvedValue([]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.stuckStepsFound).toBe(0);
      expect(result.message).toBe('No stuck in-progress steps found - all processing normally');
    });

    it('should detect both in_progress and in_progress_retrying states', async () => {
      // Arrange
      const oldTimestamp = new Date(Date.now() - 40 * 60 * 1000);

      const stuckSteps: Partial<Step>[] = [
        {
          id: 'step-1',
          status: StepStatus.IN_PROGRESS,
          startedAt: oldTimestamp,
          job: { id: 'job-1' } as any,
        },
        {
          id: 'step-2',
          status: StepStatus.IN_PROGRESS_RETRYING,
          startedAt: oldTimestamp,
          job: { id: 'job-2' } as any,
        },
      ];

      stepRepository.find.mockResolvedValue(stuckSteps);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.metrics.stuckStepsFound).toBe(2);
      expect(result.metrics.stuckInProgress).toBe(1);
      expect(result.metrics.stuckInProgressRetrying).toBe(1);
    });
  });

  describe('Alert Generation (NO AUTO-FIX)', () => {
    it('should generate warning severity for borderline cases', async () => {
      // Arrange - 35 minutes stuck (slightly over 30 min threshold)
      const stuckTimestamp = new Date(Date.now() - 35 * 60 * 1000);

      const stuckStep: Partial<Step> = {
        id: 'step-borderline',
        stepValue: 'SubmitCustomer',
        status: StepStatus.IN_PROGRESS,
        startedAt: stuckTimestamp,
        job: { id: 'job-123' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.findings[0].severity).toBe('warning');
      expect(result.metrics.warningAlerts).toBe(1);
      expect(result.metrics.criticalAlerts).toBe(0);
      expect(result.actions[0].type).toBe('alert');
    });

    it('should generate critical severity for extreme cases', async () => {
      // Arrange - 70 minutes stuck (2x threshold)
      const stuckTimestamp = new Date(Date.now() - 70 * 60 * 1000);

      const stuckStep: Partial<Step> = {
        id: 'step-critical',
        stepValue: 'SubmitOrder',
        status: StepStatus.IN_PROGRESS,
        startedAt: stuckTimestamp,
        job: { id: 'job-critical' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.findings[0].severity).toBe('critical');
      expect(result.metrics.criticalAlerts).toBe(1);
      expect(result.metrics.warningAlerts).toBe(0);
      expect(result.actions[0].type).toBe('alert');
      expect(result.actions[0].description).toBeDefined();
    });

    it('should NOT auto-fix stuck steps (manual review required)', async () => {
      // Arrange
      const stuckStep: Partial<Step> = {
        id: 'step-no-autofix',
        status: StepStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
        job: { id: 'job-123' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);

      // Act
      const result = await task['execute']();

      // Assert - Only alerts, no auto-fix actions
      expect(result.actions[0].type).toBe('alert');
      expect(result.actions[0].description).toBeDefined();
      expect(result.metrics.warningAlerts).toBeGreaterThan(0);
    });
  });

  describe('Configuration', () => {
    it('should handle zero stuck steps gracefully', async () => {
      // Arrange
      stepRepository.find.mockResolvedValue([]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('No stuck in-progress steps found - all processing normally');
      expect(result.metrics.stuckStepsFound).toBe(0);
    });
  });

  describe('DI-singleton sweep: per-step timeout lookup resolves against the JOB workflow', () => {
    it('resolves StepDefinition against the job workflow, not the default singleton', async () => {
      // A step belonging to a job on a non-default workflow (iot-sensor-pipeline)
      // must have its per-step timeout looked up via THAT workflow's
      // WorkflowConfigService. Before the fix, `this.workflowConfig` (the
      // default-bound singleton) was queried directly with the iot job's
      // `type`, which doesn't exist in the default workflow's step map —
      // getStepDefinition would silently return undefined and the task would
      // fall back to DEFAULT_TIMEOUT_MS (30min) regardless of the real
      // per-step configured timeout.
      const stuckStep: Partial<Step> = {
        id: 'step-iot',
        stepValue: 'IngestReading',
        status: StepStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 35 * 60 * 1000),
        retryCount: 0,
        job: { id: 'job-iot', type: 'sensor-batch', workflowName: 'iot-sensor-pipeline' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);

      const result = await task['execute']();

      // The iot config's getStepDefinition was consulted with the job's own type …
      expect(mockWorkflowRegistry.has).toHaveBeenCalledWith('iot-sensor-pipeline');
      expect(mockIotWorkflowConfigService.getStepDefinition).toHaveBeenCalledWith(
        'sensor-batch',
        'IngestReading',
      );
      // … and the default singleton's getStepDefinition was NEVER consulted —
      // a plausible-but-wrong fix that still calls the default singleton (just
      // wrapped in a no-op resolver) would fail this assertion.
      expect(mockWorkflowConfigService.getStepDefinition).not.toHaveBeenCalled();
      // The resolved StepDefinition's timeoutMs (5000ms) is used, so the step —
      // stuck for 35min, way past a 5s per-step timeout — is reported.
      expect(result.findings[0].context.stepTimeoutMs).toBe(5000);
    });
  });

  // ==================== TODO: Additional test cases for future implementation ====================
  // TODO: describe('Edge Cases', () => {
  //   TODO: it('should handle database query failures gracefully')
  //   TODO: it('should handle missing job relation')
  //   TODO: it('should handle multiple stuck steps efficiently')
  // });

  // TODO: describe('Severity Thresholds', () => {
  //   TODO: it('should adjust severity based on duration')
  //   TODO: it('should escalate from warning to critical over time')
  // });
});
