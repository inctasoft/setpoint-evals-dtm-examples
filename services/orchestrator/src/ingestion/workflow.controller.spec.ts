import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { JobRepository } from '@dtm/database';
import { OrchestrationService } from '../orchestration/orchestration.service';
import { DeduplicationService } from '../common/deduplication.service';
import { WorkflowRegistryService } from '../workflow-loader';
import { InitiateWorkflowJobDto } from './dto/initiate-workflow-job.dto';

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let jobRepo: jest.Mocked<Pick<JobRepository, 'createJob'>>;
  let orchestrationService: jest.Mocked<Pick<OrchestrationService, 'startJob'>>;
  let deduplicationService: jest.Mocked<Pick<DeduplicationService, 'findExistingJob'>>;
  let workflowRegistry: jest.Mocked<
    Pick<
      WorkflowRegistryService,
      'has' | 'isEnabled' | 'get' | 'getDefaultVariant' | 'getWorkflowSummaries'
    >
  >;

  const mockJobId = '550e8400-e29b-41d4-a716-446655440000';

  const mockWorkflowConfig = {
    getWorkflow: jest.fn().mockReturnValue({
      name: 'order-processing',
      description: 'E-commerce order processing',
      variants: {
        default: { isDefault: true, description: 'Default variant' },
        'quick-order': { isDefault: false, description: 'Batch import variant' },
      },
    }),
  };

  beforeEach(async () => {
    const mockJobRepository = {
      createJob: jest.fn(),
    };

    const mockOrchestrationService = {
      startJob: jest.fn(),
    };

    const mockDeduplicationService = {
      findExistingJob: jest.fn(),
    };

    const mockWorkflowRegistry = {
      has: jest.fn(),
      isEnabled: jest.fn(),
      get: jest.fn(),
      getDefaultVariant: jest.fn(),
      getWorkflowSummaries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: JobRepository, useValue: mockJobRepository },
        { provide: OrchestrationService, useValue: mockOrchestrationService },
        { provide: DeduplicationService, useValue: mockDeduplicationService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistry },
      ],
    }).compile();

    controller = module.get<WorkflowController>(WorkflowController);
    jobRepo = module.get(JobRepository);
    orchestrationService = module.get(OrchestrationService);
    deduplicationService = module.get(DeduplicationService);
    workflowRegistry = module.get(WorkflowRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initiateWorkflowJob', () => {
    const baseDto: InitiateWorkflowJobDto = {};

    it('should create a job successfully with default variant', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');
      deduplicationService.findExistingJob.mockResolvedValue(null);
      jobRepo.createJob.mockResolvedValue({
        id: mockJobId,
        workflowName: 'order-processing',
        type: 'default',
        status: 'PENDING' as any,
        payload: {},
        submittedAt: new Date(),
        submittedBy: 'api',
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      });
      orchestrationService.startJob.mockResolvedValue({
        success: true,
        message: 'Orchestration started',
        stepsCreated: 12,
        firstStepDelegated: true,
      });

      // Act
      const result = await controller.initiateWorkflowJob('order-processing', baseDto);

      // Assert
      expect(result.jobId).toBe(mockJobId);
      expect(result.workflowName).toBe('order-processing');
      expect(result.variant).toBe('default');
      expect(workflowRegistry.getDefaultVariant).toHaveBeenCalledWith('order-processing');
      expect(jobRepo.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'order-processing',
          type: 'default',
          submittedBy: 'api',
        }),
      );
    });

    it('should create a job with explicit variant', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      deduplicationService.findExistingJob.mockResolvedValue(null);
      jobRepo.createJob.mockResolvedValue({
        id: mockJobId,
        workflowName: 'order-processing',
        type: 'quick-order',
        status: 'PENDING' as any,
        payload: {},
        submittedAt: new Date(),
        submittedBy: 'api',
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      });
      orchestrationService.startJob.mockResolvedValue({
        success: true,
        message: 'Orchestration started',
        stepsCreated: 8,
        firstStepDelegated: true,
      });

      const dtoWithVariant: InitiateWorkflowJobDto = {
        ...baseDto,
        variant: 'quick-order',
      };

      // Act
      const result = await controller.initiateWorkflowJob('order-processing', dtoWithVariant);

      // Assert
      expect(result.variant).toBe('quick-order');
      expect(workflowRegistry.getDefaultVariant).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for unknown workflow', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(false);
      workflowRegistry.getWorkflowSummaries.mockReturnValue([
        {
          name: 'order-processing',
          description: 'E-commerce order processing pipeline',
          enabled: true,
          variants: ['default'],
          cascadeCount: 6,
          stepCount: 12,
        },
      ]);

      // Act & Assert
      await expect(controller.initiateWorkflowJob('unknown-workflow', baseDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for disabled workflow', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(false);

      // Act & Assert
      await expect(controller.initiateWorkflowJob('order-processing', baseDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException for invalid variant', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      deduplicationService.findExistingJob.mockResolvedValue(null);

      const dtoWithBadVariant: InitiateWorkflowJobDto = {
        ...baseDto,
        variant: 'nonexistent-variant',
      };

      // Act & Assert
      await expect(
        controller.initiateWorkflowJob('order-processing', dtoWithBadVariant),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException for duplicate job', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');
      deduplicationService.findExistingJob.mockResolvedValue({
        id: 'existing-job-id',
        status: 'PROCESSING' as any,
        submittedAt: new Date(),
      } as any);

      // Act & Assert
      await expect(controller.initiateWorkflowJob('order-processing', baseDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException when orchestration fails', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');
      deduplicationService.findExistingJob.mockResolvedValue(null);
      jobRepo.createJob.mockResolvedValue({
        id: mockJobId,
        workflowName: 'order-processing',
        type: 'default',
        status: 'PENDING' as any,
        payload: {},
        submittedAt: new Date(),
        submittedBy: 'api',
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      });
      orchestrationService.startJob.mockResolvedValue({
        success: false,
        message: 'No step definitions found',
        stepsCreated: 0,
      });

      // Act & Assert
      await expect(controller.initiateWorkflowJob('order-processing', baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should pass payload and testOptions through to job creation', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');
      deduplicationService.findExistingJob.mockResolvedValue(null);
      jobRepo.createJob.mockResolvedValue({
        id: mockJobId,
        workflowName: 'order-processing',
        type: 'default',
        status: 'PENDING' as any,
        payload: {},
        submittedAt: new Date(),
        submittedBy: 'api',
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      });
      orchestrationService.startJob.mockResolvedValue({
        success: true,
        message: 'OK',
        stepsCreated: 12,
        firstStepDelegated: true,
      });

      const dtoWithPayload: InitiateWorkflowJobDto = {
        payload: { customerId: 'cust-1', region: 'US' },
        testOptions: {
          ValidateCustomer: { simDelay: 300 },
        },
        submittedBy: 'external-system',
      };

      // Act
      await controller.initiateWorkflowJob('order-processing', dtoWithPayload);

      // Assert
      expect(jobRepo.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'order-processing',
          type: 'default',
          submittedBy: 'external-system',
          payload: expect.objectContaining({
            customerId: 'cust-1',
            region: 'US',
            testOptions: {
              ValidateCustomer: { simDelay: 300 },
            },
          }),
        }),
      );
    });

    it('should include deduplication override when provided', async () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');
      deduplicationService.findExistingJob.mockResolvedValue(null);
      jobRepo.createJob.mockResolvedValue({
        id: mockJobId,
        workflowName: 'order-processing',
        type: 'default',
        status: 'PENDING' as any,
        payload: {},
        submittedAt: new Date(),
        submittedBy: 'api',
        updatedAt: new Date(),
        completedAt: null,
        results: null,
        steps: [],
      });
      orchestrationService.startJob.mockResolvedValue({
        success: true,
        message: 'OK',
        stepsCreated: 12,
        firstStepDelegated: true,
      });

      const dtoWithDedup: InitiateWorkflowJobDto = {
        deduplicationKey: 'dedup-123',
        enableDeduplication: true,
      };

      // Act
      await controller.initiateWorkflowJob('order-processing', dtoWithDedup);

      // Assert
      expect(deduplicationService.findExistingJob).toHaveBeenCalledWith(
        'dedup-123',
        'api',
        undefined,
        true,
      );
    });
  });
});
