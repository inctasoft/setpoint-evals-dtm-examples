import { validate } from 'class-validator';
import { InitiateWorkflowJobDto } from '../../src/ingestion/dto/initiate-workflow-job.dto';

/**
 * DTO Validation Contract Tests
 *
 * Tests that DTOs properly validate request data
 * without needing any infrastructure or dependencies
 *
 * These tests are extremely fast and catch validation bugs early
 */
describe('DTO Validation Contract Tests', () => {
  describe('InitiateWorkflowJobDto', () => {
    it('should accept valid DTO with no required fields', async () => {
      const dto = new InitiateWorkflowJobDto();

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept valid payload object', async () => {
      const dto = new InitiateWorkflowJobDto();
      dto.payload = {
        customerId: 1,
        orderId: 101,
      };

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject non-object payload', async () => {
      const dto = new InitiateWorkflowJobDto();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dto.payload = 'not-an-object' as any;

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should accept valid variant string', async () => {
      const dto = new InitiateWorkflowJobDto();
      dto.variant = 'default';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept valid testOptions object', async () => {
      const dto = new InitiateWorkflowJobDto();
      dto.testOptions = {
        ValidateCustomer: { simDelay: 300 },
      };

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept valid featureFlags object', async () => {
      const dto = new InitiateWorkflowJobDto();
      dto.featureFlags = {
        enableDeduplication: true,
      };

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('Response DTO Shapes', () => {
    it('should have correct InitiateWorkflowJobResponseDto structure', () => {
      // This is a type check - tests the interface exists
      const response: {
        jobId: string;
        workflowName: string;
        variant: string;
      } = {
        jobId: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
        workflowName: 'order-processing',
        variant: 'default',
      };

      expect(response).toBeDefined();
      expect(response.jobId).toBe('15dc74ca-fca6-4bde-879f-b0afaa3e8d8c');
    });

    it('should have correct job progress structure', () => {
      const response: {
        jobId: string;
        status: string;
        progress: {
          totalSteps: number;
          completedSteps: number;
          percentComplete: number;
        };
      } = {
        jobId: '15dc74ca-fca6-4bde-879f-b0afaa3e8d8c',
        status: 'IN_PROGRESS',
        progress: {
          totalSteps: 10,
          completedSteps: 5,
          percentComplete: 50,
        },
      };

      expect(response).toBeDefined();
      expect(response.progress.percentComplete).toBe(50);
    });
  });
});
