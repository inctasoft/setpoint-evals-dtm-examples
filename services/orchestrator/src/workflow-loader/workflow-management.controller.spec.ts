import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { WorkflowManagementController } from './workflow-management.controller';
import { WorkflowRegistryService } from './workflow-registry.service';

describe('WorkflowManagementController', () => {
  let controller: WorkflowManagementController;
  let workflowRegistry: jest.Mocked<
    Pick<
      WorkflowRegistryService,
      | 'has'
      | 'get'
      | 'isEnabled'
      | 'enable'
      | 'disable'
      | 'getDefaultVariant'
      | 'getWorkflowSummaries'
    >
  >;

  const mockWorkflowConfig = {
    getWorkflow: jest.fn().mockReturnValue({
      name: 'order-processing',
      description: 'E-commerce order processing pipeline',
      variants: {
        default: { isDefault: true, description: 'Default variant' },
        'quick-order': { isDefault: false, description: 'Quick order variant' },
      },
      cascades: [
        {
          cascadeName: 'customer',
          outputStep: 'SubmitCustomer',
          inputStep: 'ValidateCustomer',
          kafkaTopic: 'order-processing.customer.completed',
          ackTopic: 'order-processing.customer.ack',
          dependsOn: [],
        },
        {
          cascadeName: 'order',
          outputStep: 'SubmitOrder',
          inputStep: 'ValidateOrder',
          kafkaTopic: 'order-processing.order.completed',
          ackTopic: 'order-processing.order.ack',
          dependsOn: ['customer'],
          fkExtractor: ({ customer }: Record<string, Record<string, unknown> | undefined>) => ({
            ext_customer_id: (customer?.externalId as string) ?? '',
          }),
        },
      ],
      outcomeRules: [
        {
          id: 'all-complete',
          description: 'All entities completed successfully',
          priority: 10,
          condition: () => true,
          outcome: () => ({ status: 'COMPLETED' }),
        },
      ],
      featureFlags: {
        enableDeduplication: { default: true },
      },
    }),
    getStepDefinitions: jest.fn().mockReturnValue([
      {
        step: 'ValidateCustomer',
        description: 'Validate customer exists and fetch account profile',
        dependencies: [],
        requiresAcknowledgement: false,
        isChildStep: false,
      },
      {
        step: 'SubmitCustomer',
        description: 'Submit customer record to CRM/ERP',
        dependencies: ['ValidateCustomer'],
        requiresAcknowledgement: true,
        isChildStep: false,
      },
      {
        step: 'ValidateOrder',
        description: 'Validate order exists and fetch order details',
        dependencies: ['ValidateCustomer'],
        requiresAcknowledgement: false,
        isChildStep: false,
        fanOut: { childStepChain: ['ValidateLineItem', 'SubmitLineItem'] },
      },
    ]),
  };

  beforeEach(async () => {
    const mockWorkflowRegistry = {
      has: jest.fn(),
      get: jest.fn(),
      isEnabled: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      getDefaultVariant: jest.fn(),
      getWorkflowSummaries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowManagementController],
      providers: [{ provide: WorkflowRegistryService, useValue: mockWorkflowRegistry }],
    }).compile();

    controller = module.get<WorkflowManagementController>(WorkflowManagementController);
    workflowRegistry = module.get(WorkflowRegistryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listWorkflows', () => {
    it('should return all registered workflows', () => {
      // Arrange
      const summaries = [
        {
          name: 'order-processing',
          description: 'E-commerce order processing',
          enabled: true,
          variants: ['default'],
          cascadeCount: 6,
          stepCount: 12,
        },
        {
          name: 'iot-sensor-pipeline',
          description: 'IoT data ingestion and processing',
          enabled: true,
          variants: ['default'],
          cascadeCount: 3,
          stepCount: 6,
        },
      ];
      workflowRegistry.getWorkflowSummaries.mockReturnValue(summaries);

      // Act
      const result = controller.listWorkflows();

      // Assert
      expect(result.workflows).toEqual(summaries);
      expect(result.total).toBe(2);
    });

    it('should return empty list when no workflows registered', () => {
      // Arrange
      workflowRegistry.getWorkflowSummaries.mockReturnValue([]);

      // Act
      const result = controller.listWorkflows();

      // Assert
      expect(result.workflows).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getWorkflowDetails', () => {
    it('should return detailed workflow info', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');

      // Act
      const result = controller.getWorkflowDetails('order-processing');

      // Assert
      expect(result.name).toBe('order-processing');
      expect(result.description).toBe('E-commerce order processing pipeline');
      expect(result.enabled).toBe(true);
      expect(result.defaultVariant).toBe('default');
      expect(result.variants).toHaveLength(2);
      expect(result.variants[0]).toEqual({
        name: 'default',
        isDefault: true,
        description: 'Default variant',
      });
      expect(result.cascades).toHaveLength(2);
      expect(result.cascades[0].cascadeName).toBe('customer');
      expect(result.cascades[1].dependsOn).toEqual(['customer']);
      expect(result.outcomeRules).toHaveLength(1);
      expect(result.outcomeRules[0].id).toBe('all-complete');
    });

    it('should include step definitions per variant', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.get.mockReturnValue(mockWorkflowConfig as any);
      workflowRegistry.isEnabled.mockReturnValue(true);
      workflowRegistry.getDefaultVariant.mockReturnValue('default');

      // Act
      const result = controller.getWorkflowDetails('order-processing');

      // Assert
      expect(result.stepsByVariant).toBeDefined();
      expect(result.stepsByVariant['default']).toHaveLength(3);
      expect(result.stepsByVariant['default'][0]).toEqual({
        step: 'ValidateCustomer',
        description: 'Validate customer exists and fetch account profile',
        dependencies: [],
        requiresAcknowledgement: false,
        isChildStep: false,
        isFanOutStep: false,
      });
      expect(result.stepsByVariant['default'][2].isFanOutStep).toBe(true);
    });

    it('should throw NotFoundException for unknown workflow', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(false);

      // Act & Assert
      expect(() => controller.getWorkflowDetails('unknown')).toThrow(NotFoundException);
    });
  });

  describe('enableWorkflow', () => {
    it('should enable a workflow', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.enable.mockReturnValue(true);

      // Act
      const result = controller.enableWorkflow('order-processing');

      // Assert
      expect(result.name).toBe('order-processing');
      expect(result.enabled).toBe(true);
      expect(workflowRegistry.enable).toHaveBeenCalledWith('order-processing');
    });

    it('should throw NotFoundException for unknown workflow', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(false);

      // Act & Assert
      expect(() => controller.enableWorkflow('unknown')).toThrow(NotFoundException);
    });
  });

  describe('disableWorkflow', () => {
    it('should disable a workflow', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(true);
      workflowRegistry.disable.mockReturnValue(true);

      // Act
      const result = controller.disableWorkflow('order-processing');

      // Assert
      expect(result.name).toBe('order-processing');
      expect(result.enabled).toBe(false);
      expect(workflowRegistry.disable).toHaveBeenCalledWith('order-processing');
    });

    it('should throw NotFoundException for unknown workflow', () => {
      // Arrange
      workflowRegistry.has.mockReturnValue(false);

      // Act & Assert
      expect(() => controller.disableWorkflow('unknown')).toThrow(NotFoundException);
    });
  });
});
