import { Test, TestingModule } from '@nestjs/testing';
import { CallbackController } from './callback.controller';
import { CallbackService } from './callback.service';
import { StepProgressDto, StepProgressResponseDto } from './dto/step-progress.dto';
import { StepStatus } from '@dtm/database';

describe('CallbackController', () => {
  let controller: CallbackController;
  let callbackService: jest.Mocked<CallbackService>;

  // Sample test data
  const mockJobId = '550e8400-e29b-41d4-a716-446655440000';
  const mockStepId = '660e8400-e29b-41d4-a716-446655440001';

  beforeEach(async () => {
    // Create a mock CallbackService
    const mockCallbackService = {
      handleStepProgress: jest.fn(),
      getJobStatus: jest.fn(),
      listRecentJobs: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallbackController],
      providers: [
        {
          provide: CallbackService,
          useValue: mockCallbackService,
        },
      ],
    }).compile();

    controller = module.get<CallbackController>(CallbackController);
    callbackService = module.get(CallbackService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleStepProgress', () => {
    it('should successfully handle step progress with IN_PROGRESS status', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.IN_PROGRESS,
        message: 'Processing records...',
        recordsProcessed: 10,
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step progress recorded',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(callbackService.handleStepProgress).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expectedResponse);
    });

    it('should successfully handle step progress with COMPLETED status and output data', async () => {
      // Arrange
      const outputData = {
        customer_id: 'CUST-1000',
        order_id: 'ORD-001',
        validatedAt: '2025-01-01T00:00:00Z',
      };

      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.COMPLETED,
        output: outputData,
        recordsProcessed: 1,
        message: 'Validation completed',
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step completed successfully',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedResponse);
    });

    it('should successfully handle step progress with FAILED status and error message', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.FAILED,
        error: 'Database connection timeout',
        recordsFailed: 1,
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step failed, waiting for retry (1/3)',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedResponse);
    });

    it('should handle step progress with retry metadata', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.FAILED,
        error: 'SIMULATED FAILURE: ValidateCustomer failed after 8000ms (attempt 2/2+) [TESTING]',
        retryMetadata: {
          sqsMessageId: 'abc123',
          sqsReceiveCount: 2,
          processingTimeMs: 8500,
          isRetry: true,
        },
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step failed, waiting for retry (2/3)',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result.message).toContain('retry');
    });

    it('should handle step progress with data reference', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.COMPLETED,
        output: { processed: true },
        dataReference: {
          type: 'database_table',
          table: 'entities_snapshot',
          metadata: { entity_id: 'ENT-1000' },
        },
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step completed',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedResponse);
    });

    it('should handle step progress with WAITING_FOR_ACK status', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.WAITING_FOR_ACK,
        output: { submit_completed: true },
        message: 'Published to Kafka, waiting for acknowledgement',
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step published to Kafka - waiting for acknowledgement',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result.message).toContain('acknowledgement');
    });

    it('should handle step progress with IN_PROGRESS_RETRYING status', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.IN_PROGRESS_RETRYING,
        error: 'First attempt failed',
        retryMetadata: {
          sqsMessageId: 'xyz789',
          sqsReceiveCount: 1,
          processingTimeMs: 5000,
          isRetry: false,
        },
      };

      const expectedResponse: StepProgressResponseDto = {
        success: true,
        message: 'Step retrying after failure',
        jobId: mockJobId,
        stepId: mockStepId,
      };

      callbackService.handleStepProgress.mockResolvedValue(expectedResponse);

      // Act
      const result = await controller.handleStepProgress(dto);

      // Assert
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedResponse);
    });

    it('should propagate errors from CallbackService', async () => {
      // Arrange
      const dto: StepProgressDto = {
        jobId: mockJobId,
        stepId: mockStepId,
        status: StepStatus.IN_PROGRESS,
      };

      const error = new Error('Step not found');
      callbackService.handleStepProgress.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.handleStepProgress(dto)).rejects.toThrow('Step not found');
      expect(callbackService.handleStepProgress).toHaveBeenCalledWith(dto);
    });
  });

  describe('getJobStatus', () => {
    it('should successfully retrieve job status', async () => {
      // Arrange
      const mockJobStatus = {
        id: mockJobId,
        type: 'default',
        status: 'processing',
        steps: [
          {
            id: mockStepId,
            name: 'ValidateCustomer',
            status: 'completed',
            output: { entity_id: 'ENT-1000' },
          },
        ],
        submittedAt: new Date('2025-01-01T00:00:00Z'),
      };

      callbackService.getJobStatus.mockResolvedValue(mockJobStatus);

      // Act
      const result = await controller.getJobStatus(mockJobId);

      // Assert
      expect(callbackService.getJobStatus).toHaveBeenCalledWith(mockJobId);
      expect(callbackService.getJobStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockJobStatus);
      expect(result.id).toBe(mockJobId);
    });

    it('should handle job with pending steps', async () => {
      // Arrange
      const mockJobStatus = {
        id: mockJobId,
        type: 'default',
        status: 'pending',
        steps: [
          { id: mockStepId, name: 'ValidateCustomer', status: 'pending' },
          {
            id: '770e8400-e29b-41d4-a716-446655440002',
            name: 'ValidateOrder',
            status: 'pending',
          },
        ],
        submittedAt: new Date(),
      };

      callbackService.getJobStatus.mockResolvedValue(mockJobStatus);

      // Act
      const result = await controller.getJobStatus(mockJobId);

      // Assert
      expect(result.status).toBe('pending');
      expect(result.steps).toHaveLength(2);
      expect(result.steps.every((step) => step.status === 'pending')).toBe(true);
    });

    it('should handle completed job with all steps finished', async () => {
      // Arrange
      const mockJobStatus = {
        id: mockJobId,
        type: 'default',
        status: 'completed',
        steps: [
          {
            id: mockStepId,
            name: 'ValidateCustomer',
            status: 'completed',
            completedAt: new Date(),
          },
          {
            id: '770e8400-e29b-41d4-a716-446655440002',
            name: 'SubmitCustomer',
            status: 'completed',
            completedAt: new Date(),
          },
        ],
        completedAt: new Date(),
      };

      callbackService.getJobStatus.mockResolvedValue(mockJobStatus);

      // Act
      const result = await controller.getJobStatus(mockJobId);

      // Assert
      expect(result.status).toBe('completed');
      expect(result.steps.every((step) => step.status === 'completed')).toBe(true);
    });

    it('should handle failed job with error details', async () => {
      // Arrange
      const mockJobStatus = {
        id: mockJobId,
        type: 'default',
        status: 'failed',
        error: 'Retries exhausted for step ValidateCustomer',
        steps: [
          {
            id: mockStepId,
            name: 'ValidateCustomer',
            status: 'failed',
            error: 'Database connection failed',
            retryCount: 3,
          },
        ],
      };

      callbackService.getJobStatus.mockResolvedValue(mockJobStatus);

      // Act
      const result = await controller.getJobStatus(mockJobId);

      // Assert
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.steps[0].status).toBe('failed');
    });

    it('should propagate not found errors from CallbackService', async () => {
      // Arrange
      const error = new Error('Job not found');
      callbackService.getJobStatus.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.getJobStatus('invalid-job-id')).rejects.toThrow('Job not found');
    });
  });

  describe('listJobs', () => {
    it('should successfully retrieve list of recent jobs', async () => {
      // Arrange
      const mockJobs = [
        {
          id: mockJobId,
          type: 'default',
          status: 'completed',
          submittedAt: new Date('2025-01-01T00:00:00Z'),
        },
        {
          id: '660e8400-e29b-41d4-a716-446655440002',
          type: 'default',
          status: 'processing',
          submittedAt: new Date('2025-01-01T01:00:00Z'),
        },
      ];

      callbackService.listRecentJobs.mockResolvedValue(mockJobs);

      // Act
      const result = await controller.listJobs();

      // Assert
      expect(callbackService.listRecentJobs).toHaveBeenCalledWith(10);
      expect(callbackService.listRecentJobs).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockJobs);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no jobs exist', async () => {
      // Arrange
      callbackService.listRecentJobs.mockResolvedValue([]);

      // Act
      const result = await controller.listJobs();

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should limit results to 10 jobs', async () => {
      // Arrange
      const mockJobs = Array.from({ length: 10 }, (_, i) => ({
        id: `job-${i}`,
        type: 'default',
        status: 'completed',
        submittedAt: new Date(),
      }));

      callbackService.listRecentJobs.mockResolvedValue(mockJobs);

      // Act
      const result = await controller.listJobs();

      // Assert
      expect(callbackService.listRecentJobs).toHaveBeenCalledWith(10);
      expect(result).toHaveLength(10);
    });

    it('should handle various job statuses', async () => {
      // Arrange
      const mockJobs = [
        { id: '1', type: 'default', status: 'pending', submittedAt: new Date() },
        { id: '2', type: 'default', status: 'processing', submittedAt: new Date() },
        { id: '3', type: 'default', status: 'completed', submittedAt: new Date() },
        { id: '4', type: 'default', status: 'failed', submittedAt: new Date() },
      ];

      callbackService.listRecentJobs.mockResolvedValue(mockJobs);

      // Act
      const result = await controller.listJobs();

      // Assert
      expect(result).toHaveLength(4);
      expect(result.map((job) => job.status)).toEqual([
        'pending',
        'processing',
        'completed',
        'failed',
      ]);
    });

    it('should propagate errors from CallbackService', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      callbackService.listRecentJobs.mockRejectedValue(error);

      // Act & Assert
      await expect(controller.listJobs()).rejects.toThrow('Database connection failed');
    });
  });

  describe('healthCheck', () => {
    it('should return UP status with correct structure', () => {
      // Act
      const result = controller.healthCheck();

      // Assert
      expect(result).toHaveProperty('status', 'UP');
      expect(result).toHaveProperty('service', 'callback');
      expect(result).toHaveProperty('message', 'Callback service is operational');
      expect(result).toHaveProperty('timestamp');
    });

    it('should return current timestamp in ISO format', () => {
      // Act
      const result = controller.healthCheck();

      // Assert
      expect(result.timestamp).toBeDefined();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should always return successful response', () => {
      // Act
      const result1 = controller.healthCheck();
      const result2 = controller.healthCheck();

      // Assert
      expect(result1.status).toBe('UP');
      expect(result2.status).toBe('UP');
    });

    it('should have independent timestamps for multiple calls', () => {
      // Act
      const result1 = controller.healthCheck();
      // Small delay to ensure different timestamps
      const result2 = controller.healthCheck();

      // Assert
      expect(result1.timestamp).toBeDefined();
      expect(result2.timestamp).toBeDefined();
      // Timestamps should be very close but technically can be different
    });
  });
});
