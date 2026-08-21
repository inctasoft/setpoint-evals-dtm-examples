import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SqsConfig } from './sqs.config';
import { WorkflowRegistryService } from '../workflow-loader';

describe('SqsConfig', () => {
  let sqsConfig: SqsConfig;

  const mockConfigService = {
    get: jest.fn().mockReturnValue(undefined),
  };

  // The registry's getAllQueueNames() is the AGGREGATE across every
  // registered workflow — distinct from a single WorkflowConfigService's
  // own getAllQueueNames(), which only knows its own workflow's queues.
  const mockWorkflowRegistry = {
    getAllQueueNames: jest.fn().mockReturnValue(['order-queue', 'iot-queue', 'infra-queue']),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SqsConfig,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WorkflowRegistryService, useValue: mockWorkflowRegistry },
      ],
    }).compile();

    sqsConfig = module.get<SqsConfig>(SqsConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('DI-singleton sweep: getAllQueueUrls spans every registered workflow', () => {
    it('sources queue names from the WorkflowRegistryService aggregate, not a single default workflow', () => {
      // getAllQueueUrls()'s own docstring says "across all workflow types" —
      // that is only true if it asks the REGISTRY (which unions every
      // registered workflow's queues), not a single default-bound
      // WorkflowConfigService (which would silently omit iot/infra queues
      // from this health-check listing — a plausible-but-wrong fix that
      // still calls a single WorkflowConfigService.getAllQueueNames() would
      // return only 1 workflow's queues here instead of the union of 3).
      const urls = sqsConfig.getAllQueueUrls();

      expect(mockWorkflowRegistry.getAllQueueNames).toHaveBeenCalledTimes(1);
      expect(urls).toHaveLength(3);
      expect(urls.some((u) => u.includes('order-queue'))).toBe(true);
      expect(urls.some((u) => u.includes('iot-queue'))).toBe(true);
      expect(urls.some((u) => u.includes('infra-queue'))).toBe(true);
    });
  });
});
