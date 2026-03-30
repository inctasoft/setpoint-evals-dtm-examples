import { Test, TestingModule } from '@nestjs/testing';
import { SqsService, LambdaStepPayload } from './sqs.service';
import { SqsConfig } from './sqs.config';
import { JobType } from '@dtm/database';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { Logger } from '@nestjs/common';

describe('SqsService', () => {
  let service: SqsService;
  const sqsMock = mockClient(SQSClient);

  const mockSqsConfig = {
    getRegion: jest.fn().mockReturnValue('us-east-1'),
    getEndpoint: jest.fn().mockReturnValue('http://localhost:4566'),
    getAccessKeyId: jest.fn().mockReturnValue('test'),
    getSecretAccessKey: jest.fn().mockReturnValue('test'),
    getQueueUrlByName: jest.fn().mockReturnValue('http://localhost:4566/000000000000/test-queue'),
    getAllQueueUrls: jest.fn().mockReturnValue(['http://localhost:4566/000000000000/test-queue']),
  };

  beforeEach(async () => {
    sqsMock.reset();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsService,
        {
          provide: SqsConfig,
          useValue: mockSqsConfig,
        },
      ],
    }).compile();

    service = module.get<SqsService>(SqsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Constructor & Configuration', () => {
    it('should initialize with local endpoint for development', () => {
      // Service was initialized in beforeEach with local endpoint
      expect(mockSqsConfig.getEndpoint).toHaveBeenCalled();
      expect(mockSqsConfig.getRegion).toHaveBeenCalled();
    });

    it('should use explicit credentials when provided', () => {
      // Service was initialized in beforeEach with test credentials
      expect(mockSqsConfig.getAccessKeyId).toHaveBeenCalled();
      expect(mockSqsConfig.getSecretAccessKey).toHaveBeenCalled();
    });

    it('should log configuration details during initialization', () => {
      // Spy is already set up, just verify it was called
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Initializing SQS client for region: us-east-1',
      );
    });
  });

  describe('sendStepMessage', () => {
    const basePayload: LambdaStepPayload = {
      jobId: 'job-123',
      stepId: 'step-456',
      stepValue: 'ValidateCustomer',
      jobType: JobType.DEFAULT,
      input: { customerId: 'CUST-1000' },
      callbackUrl: 'http://orchestrator:3000/callback',
    };

    it('should send message to SQS successfully', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-id-123' });

      // Act
      const result = await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-id-123');
      expect(result.error).toBeUndefined();
      expect(sqsMock.calls()).toHaveLength(1);
    });

    it('should include all required message attributes', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-id-456' });

      // Act
      await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      expect(input.MessageAttributes).toEqual({
        jobId: {
          DataType: 'String',
          StringValue: 'job-123',
        },
        stepId: {
          DataType: 'String',
          StringValue: 'step-456',
        },
        stepValue: {
          DataType: 'String',
          StringValue: 'ValidateCustomer',
        },
        jobType: {
          DataType: 'String',
          StringValue: JobType.DEFAULT,
        },
      });
    });

    it('should include correlationId in message attributes if provided', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-id-789' });
      const payloadWithCorrelationId: LambdaStepPayload = {
        ...basePayload,
        correlationId: 'correlation-abc-123',
      };

      // Act
      await service.sendStepMessage(payloadWithCorrelationId, 'http://queue-url');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      expect(input.MessageAttributes.correlationId).toEqual({
        DataType: 'String',
        StringValue: 'correlation-abc-123',
      });
    });

    it('should not include correlationId if not provided', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-id-no-corr' });

      // Act
      await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      expect(input.MessageAttributes.correlationId).toBeUndefined();
    });

    it('should serialize payload as JSON in message body', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-id-json' });

      // Act
      await service.sendStepMessage(basePayload, 'http://test-queue-url');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      expect(input.MessageBody).toBe(JSON.stringify(basePayload));
    });

    it('should send sourceConfig for source-querying workers', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-validate' });
      const validatePayload: LambdaStepPayload = {
        ...basePayload,
        sourceConfig: {
          sourceDatabase: 'ecommerce',
          sourceTable: 'dbo.entities',
          filterKey: 'entityId',
        },
      };

      // Act
      await service.sendStepMessage(validatePayload, 'http://validate-queue');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      const body = JSON.parse(input.MessageBody);
      expect(body.sourceConfig).toEqual({
        sourceDatabase: 'ecommerce',
        sourceTable: 'dbo.entities',
        filterKey: 'entityId',
      });
    });

    it('should send processingConfig for processing workers', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-submit' });
      const submitPayload: LambdaStepPayload = {
        ...basePayload,
        stepValue: 'SubmitCustomer',
        processingConfig: {
          inputDataType: 'entity',
          transformations: ['formatFullName', 'normalizeStatus'],
        },
      };

      // Act
      await service.sendStepMessage(submitPayload, 'http://submit-queue');

      // Assert
      const call = sqsMock.call(0);
      const input = call.args[0].input;
      const body = JSON.parse(input.MessageBody);
      expect(body.processingConfig).toEqual({
        inputDataType: 'entity',
        transformations: ['formatFullName', 'normalizeStatus'],
      });
    });

    it('should handle SQS errors gracefully', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).rejects(new Error('Queue does not exist'));

      // Act
      const result = await service.sendStepMessage(basePayload, 'http://invalid-queue');

      // Assert
      expect(result.success).toBe(false);
      expect(result.messageId).toBe('');
      expect(result.error).toBe('Queue does not exist');
    });

    it('should handle unknown error types', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).rejects('String error'); // Non-Error object

      // Act
      const result = await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('String error'); // String errors are passed through
    });

    it('should handle missing MessageId in response', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({}); // No MessageId

      // Act
      const result = await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('unknown');
    });

    it('should log successful sends', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-success' });

      // Act
      await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Sending step step-456 (ValidateCustomer) to queue: http://queue-url',
      );
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Successfully sent step step-456 to SQS. MessageId: msg-success',
      );
    });

    it('should log errors with stack trace', async () => {
      // Arrange
      const error = new Error('Connection timeout');
      error.stack = 'Error: Connection timeout\n  at <stack trace>';
      sqsMock.on(SendMessageCommand).rejects(error);

      // Act
      await service.sendStepMessage(basePayload, 'http://queue-url');

      // Assert
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        'Failed to send step step-456 to SQS: Connection timeout',
        error.stack,
      );
    });
  });

  describe('sendBulkStepMessages', () => {
    it('should send multiple messages successfully', async () => {
      // Arrange
      sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-bulk' });
      const payloads = [
        {
          jobId: 'job-1',
          stepId: 'step-1',
          stepValue: 'ValidateCustomer',
          jobType: JobType.DEFAULT,
          input: { data: 'test1' },
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-1',
        },
        {
          jobId: 'job-1',
          stepId: 'step-2',
          stepValue: 'SubmitCustomer',
          jobType: JobType.DEFAULT,
          input: { data: 'test2' },
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-2',
        },
      ];

      // Act
      const results = await service.sendBulkStepMessages(payloads);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].stepId).toBe('step-1');
      expect(results[0].success).toBe(true);
      expect(results[1].stepId).toBe('step-2');
      expect(results[1].success).toBe(true);
      expect(sqsMock.calls()).toHaveLength(2);
    });

    it('should handle partial failures in bulk send', async () => {
      // Arrange
      sqsMock
        .on(SendMessageCommand)
        .resolvesOnce({ MessageId: 'msg-success' })
        .rejectsOnce(new Error('Queue error'))
        .resolvesOnce({ MessageId: 'msg-success-2' });

      const payloads = [
        {
          jobId: 'job-1',
          stepId: 'step-1',
          stepValue: 'ValidateCustomer',
          jobType: JobType.DEFAULT,
          input: { data: 'test1' },
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-1',
        },
        {
          jobId: 'job-1',
          stepId: 'step-2',
          stepValue: 'SubmitCustomer',
          jobType: JobType.DEFAULT,
          input: { data: 'test2' },
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-2',
        },
        {
          jobId: 'job-1',
          stepId: 'step-3',
          stepValue: 'SubmitOrder',
          jobType: JobType.DEFAULT,
          input: { data: 'test3' },
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-3',
        },
      ];

      // Act
      const results = await service.sendBulkStepMessages(payloads);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Queue error');
      expect(results[2].success).toBe(true);
    });

    it('should process bulk messages in parallel', async () => {
      // Arrange
      let callCount = 0;
      sqsMock.on(SendMessageCommand).callsFake(() => {
        callCount++;
        return Promise.resolve({ MessageId: `msg-${callCount}` });
      });

      const payloads = Array.from({ length: 5 }, (_, i) => ({
        jobId: 'job-bulk',
        stepId: `step-${i}`,
        stepValue: 'ValidateCustomer',
        jobType: JobType.DEFAULT,
        input: { index: i },
        callbackUrl: 'http://callback',
        queueUrl: `http://queue-${i}`,
      }));

      // Act
      const start = Date.now();
      await service.sendBulkStepMessages(payloads);
      const duration = Date.now() - start;

      // Assert - Should be fast (parallel), not sequential
      expect(sqsMock.calls()).toHaveLength(5);
      expect(duration).toBeLessThan(500); // Should complete quickly in parallel
    });

    it('should log bulk send summary', async () => {
      // Arrange
      sqsMock
        .on(SendMessageCommand)
        .resolvesOnce({ MessageId: 'msg-1' })
        .rejectsOnce(new Error('Error'));

      const payloads = [
        {
          jobId: 'job-1',
          stepId: 'step-1',
          stepValue: 'ValidateCustomer',
          jobType: JobType.DEFAULT,
          input: {},
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-1',
        },
        {
          jobId: 'job-1',
          stepId: 'step-2',
          stepValue: 'SubmitCustomer',
          jobType: JobType.DEFAULT,
          input: {},
          callbackUrl: 'http://callback',
          queueUrl: 'http://queue-2',
        },
      ];

      // Act
      await service.sendBulkStepMessages(payloads);

      // Assert
      expect(Logger.prototype.log).toHaveBeenCalledWith('Sending bulk messages for 2 steps');
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        'Bulk send complete: 1 succeeded, 1 failed',
      );
    });

    it('should handle empty payloads array', async () => {
      // Act
      const results = await service.sendBulkStepMessages([]);

      // Assert
      expect(results).toHaveLength(0);
      expect(sqsMock.calls()).toHaveLength(0);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when client is configured', () => {
      // Act
      const result = service.healthCheck();

      // Assert
      expect(result.healthy).toBe(true);
      expect(result.message).toBe('SQS client is configured with 1 queues');
      expect(result.totalQueues).toBe(1);
    });

    it('should return queue count from config', () => {
      // Arrange
      mockSqsConfig.getAllQueueUrls.mockReturnValue([
        'http://queue-1',
        'http://queue-2',
        'http://queue-3',
      ]);

      // Re-create service to pick up new config
      const testModule = Test.createTestingModule({
        providers: [
          SqsService,
          {
            provide: SqsConfig,
            useValue: mockSqsConfig,
          },
        ],
      });

      testModule.compile().then((module) => {
        const testService = module.get<SqsService>(SqsService);

        // Act
        const result = testService.healthCheck();

        // Assert
        expect(result.totalQueues).toBe(3);
      });
    });
  });

});
