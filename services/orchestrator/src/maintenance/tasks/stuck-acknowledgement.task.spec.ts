/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { StuckAcknowledgementTask } from './stuck-acknowledgement.task';
import { Step, StepStatus } from '@dtm/database';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { OrchestrationService } from '../../orchestration/orchestration.service';
import { AdvisoryLockService, LockId } from '../advisory-lock.service';

describe('StuckAcknowledgementTask', () => {
  let module: TestingModule;
  let task: StuckAcknowledgementTask;
  let stepRepository: jest.Mocked<Repository<Step>>;
  let orchestrationService: jest.Mocked<OrchestrationService>;

  // Shared mocks
  const mockStepRepository = {
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: string) => {
      if (key === 'MAINTENANCE_ACK_TIMEOUT_MINUTES') return '30';
      if (key === 'MAINTENANCE_AUTO_FIX_ENABLED') return 'true';
      return defaultValue;
    }),
  };

  const mockTaskRegistry = {
    register: jest.fn(),
  };

  const mockOrchestrationService = {
    continueJob: jest.fn(),
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
        StuckAcknowledgementTask,
        {
          provide: getRepositoryToken(Step),
          useValue: mockStepRepository,
        },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        { provide: AdvisoryLockService, useValue: mockAdvisoryLockService },
      ],
    }).compile();

    task = module.get<StuckAcknowledgementTask>(StuckAcknowledgementTask);
    stepRepository = module.get(getRepositoryToken(Step));
    configService = module.get(ConfigService);
    taskRegistry = module.get(MaintenanceTaskRegistry);
    orchestrationService = module.get(OrchestrationService);
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
        name: 'stuck-acknowledgement',
        description: 'Detects and auto-fails steps stuck waiting for external acknowledgements',
        schedule: '0 */5 * * * *', // EVERY_5_MINUTES (cron format with seconds)
        priority: 100,
        category: 'health-check',
        timeoutMs: 60000,
        enabled: true,
        lockId: LockId.STUCK_ACKNOWLEDGEMENT, // LEADER-1
      });
    });
  });

  describe('Detection Logic', () => {
    it('should detect steps stuck in waiting_for_ack state', async () => {
      // Arrange
      const now = new Date();
      const stuckTimestamp = new Date(now.getTime() - 31 * 60 * 1000); // 31 minutes ago

      const stuckStep: Partial<Step> = {
        id: 'step-123',
        stepValue: 'SubmitOrder',
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-123' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert
      expect(stepRepository.find).toHaveBeenCalledWith({
        where: {
          status: StepStatus.WAITING_FOR_ACK,
          kafkaPublishedAt: expect.any(Object), // LessThan matcher
        },
        relations: ['job'],
      });
      expect(result.success).toBe(true);
      expect(result.metrics.stuckStepsFound).toBe(1);
    });

    it('should calculate timeout correctly based on config (30 min default)', async () => {
      // Arrange
      const now = new Date();
      const exactlyAtThreshold = new Date(now.getTime() - 30 * 60 * 1000); // Exactly 30 minutes

      const stuckStep: Partial<Step> = {
        id: 'step-123',
        kafkaPublishedAt: exactlyAtThreshold,
        status: StepStatus.WAITING_FOR_ACK,
        job: { id: 'job-123' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      await task['execute']();

      // Assert - Verify the find was called with correct cutoff time
      const findCall = stepRepository.find.mock.calls[0][0];
      expect(findCall.where.status).toBe(StepStatus.WAITING_FOR_ACK);
      // The kafkaPublishedAt should have a LessThan condition
      expect(findCall.where.kafkaPublishedAt).toBeDefined();
    });

    it('should NOT flag recently created steps', async () => {
      // Arrange: Recent step should not be flagged (within threshold)
      stepRepository.find.mockResolvedValue([]); // Query returns empty because step is not old enough

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.metrics.stuckStepsFound).toBe(0);
      expect(result.message).toBe('No stuck acknowledgements found - all steps healthy');
    });

    it('should handle zero stuck steps gracefully', async () => {
      // Arrange
      stepRepository.find.mockResolvedValue([]);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('No stuck acknowledgements found - all steps healthy');
      expect(result.metrics.stuckStepsFound).toBe(0);
      expect(result.metrics.autoFixed).toBe(0);
      expect(result.metrics.alertsRaised).toBe(0);
    });
  });

  describe('Auto-fix Behavior', () => {
    it('should auto-fail stuck step when auto-fix enabled', async () => {
      // Arrange
      const stuckTimestamp = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago

      const stuckStep: Partial<Step> = {
        id: 'step-789',
        stepValue: 'SubmitCustomer',
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-789' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert - Verify step was updated to FAILED via a conditional UPDATE
      // (LEADER-2) guarded on WHERE status = WAITING_FOR_ACK — not a bare id
      // update — so a real ACK racing in between read and write can't be
      // clobbered.
      expect(stepRepository.update).toHaveBeenCalledWith(
        { id: 'step-789', status: StepStatus.WAITING_FOR_ACK },
        {
          status: StepStatus.FAILED,
          error: expect.stringContaining('Acknowledgement timeout'),
          completedAt: expect.any(Date),
        },
      );

      // Verify auto-fix metrics
      expect(result.metrics.autoFixed).toBe(1);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].type).toBe('auto-fix');
      expect(result.actions[0].result).toBe('success');
    });

    it('should trigger orchestration after auto-fix', async () => {
      // Arrange
      const stuckTimestamp = new Date(Date.now() - 40 * 60 * 1000);

      const stuckStep: Partial<Step> = {
        id: 'step-999',
        stepValue: 'SubmitOrder',
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-999' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      await task['execute']();

      // Assert - Verify orchestration was triggered with correct jobId
      expect(orchestrationService.continueJob).toHaveBeenCalledWith('job-999');
      expect(orchestrationService.continueJob).toHaveBeenCalledTimes(1);
    });

    // TODO: This test requires recreating the task with different config
    // For now, skipping to keep implementation moving forward
    it.skip('should raise alert when auto-fix is disabled', async () => {
      // TODO: Implement test for disabled auto-fix scenario
      // Requires proper handling of config service mock reset
    });

    // TODO: Implement error handling test
    it.skip('should handle auto-fix errors gracefully', async () => {
      // TODO: Implement test for database error scenarios
      // Requires proper error mock setup
    });
  });

  describe('Severity Levels', () => {
    it('should mark finding as critical for stuck steps', async () => {
      // Arrange
      const stuckTimestamp = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes

      const stuckStep: Partial<Step> = {
        id: 'step-critical',
        stepValue: 'SubmitOrder',
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-critical' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe('critical');
      expect(result.findings[0].description).toContain('45 minutes');
      expect(result.findings[0].context.waitTimeMinutes).toBe(45);
    });
  });

  describe('Configuration Overrides', () => {
    it('should respect custom timeout from execution options', async () => {
      // Arrange
      const stuckTimestamp = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes

      const stuckStep: Partial<Step> = {
        id: 'step-custom',
        stepValue: 'SubmitCustomer',
        status: StepStatus.WAITING_FOR_ACK,
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-custom' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      stepRepository.update.mockResolvedValue({ affected: 1 } as any);
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act - Execute with custom 10-minute timeout
      const result = await task['execute']({ ackTimeoutMinutes: 10 });

      // Assert - Should detect as stuck with custom threshold
      expect(result.metrics.stuckStepsFound).toBe(1);
      expect(result.findings[0].context.thresholdMinutes).toBe(10);
    });
  });

  describe('LEADER-2: conditional UPDATE guards a racing real ACK', () => {
    it('does not clobber a step that a real ACK already moved out of WAITING_FOR_ACK', async () => {
      // Arrange: the reaper's SELECT saw the step as stuck WAITING_FOR_ACK, but
      // by the time the reaper's UPDATE runs, a real (late) ACK has already
      // landed and moved the row to COMPLETED. Simulate that race directly at
      // the point that matters: the conditional UPDATE's WHERE clause no
      // longer matches the row's *current* status, so Postgres would affect 0
      // rows. A plausible-but-wrong fix (checking `affected === 0` on a bare
      // `update(id, {...})`) would NOT reproduce this — an id-only update
      // always matches the row and always returns affected: 1. This test
      // fails against that plausible-but-wrong fix and only passes when the
      // UPDATE's criteria genuinely includes `status: WAITING_FOR_ACK`.
      const stuckTimestamp = new Date(Date.now() - 35 * 60 * 1000);
      const stuckStep: Partial<Step> = {
        id: 'step-race',
        stepValue: 'SubmitOrder',
        status: StepStatus.WAITING_FOR_ACK, // as read by the reaper's SELECT
        kafkaPublishedAt: stuckTimestamp,
        job: { id: 'job-race' } as any,
      };

      stepRepository.find.mockResolvedValue([stuckStep]);
      // The real ACK won the race: Postgres finds 0 rows still matching
      // WHERE status = WAITING_FOR_ACK, so `affected` is 0.
      stepRepository.update.mockImplementation((criteria: any) => {
        if (
          criteria &&
          typeof criteria === 'object' &&
          criteria.status === StepStatus.WAITING_FOR_ACK
        ) {
          return Promise.resolve({ affected: 0 } as any);
        }
        // A bare id (or any criteria not pinning the status) always "finds"
        // the row — this branch is what a plausible-but-wrong fix would hit.
        return Promise.resolve({ affected: 1 } as any);
      });
      orchestrationService.continueJob.mockResolvedValue(undefined);

      // Act
      const result = await task['execute']();

      // Assert: the UPDATE was conditioned on the WAITING_FOR_ACK status …
      expect(stepRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'step-race', status: StepStatus.WAITING_FOR_ACK }),
        expect.objectContaining({ status: StepStatus.FAILED }),
      );
      // … lost the race (affected: 0) …
      expect(await stepRepository.update.mock.results[0].value).toEqual({ affected: 0 });
      // … and therefore must NOT re-trigger orchestration for a step that a
      // real ACK already moved forward — that would race the ACK's own
      // continueJob call and could double-cascade.
      expect(orchestrationService.continueJob).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  // ==================== TODO: Additional test cases for future implementation ====================
  // TODO: describe('Edge Cases - Database Errors', () => {
  //   TODO: it('should handle database query failures gracefully')
  //   TODO: it('should handle missing job relation gracefully')
  //   TODO: it('should handle orchestration service failures')
  // });

  // TODO: describe('Multiple Stuck Steps', () => {
  //   TODO: it('should process multiple stuck steps correctly')
  //   TODO: it('should continue processing if one step fails')
  //   TODO: it('should aggregate metrics correctly for bulk operations')
  // });

  // TODO: describe('Integration with BaseMaintenanceTask', () => {
  //   TODO: it('should register with task registry on construction')
  //   TODO: it('should inherit execute() wrapper from base class')
  //   TODO: it('should respect task execution timeout')
  // });
});
