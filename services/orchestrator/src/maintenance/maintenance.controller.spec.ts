import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceSchedulerService } from './scheduler/maintenance-scheduler.service';
import { MaintenanceTaskRegistry } from './registry/maintenance-task-registry';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('MaintenanceController', () => {
  let controller: MaintenanceController;

  const mockSchedulerService = {
    executeTaskManually: jest.fn(),
    executeCategory: jest.fn(),
    executeAllEnabled: jest.fn(),
    getExecutionHistory: jest.fn(),
    getTaskStats: jest.fn(),
    getAllExecutionHistory: jest.fn(),
    getSchedulerStats: jest.fn(),
  };

  const mockTaskRegistry = {
    getAllMetadata: jest.fn(),
    getTasksByCategory: jest.fn(),
    hasTask: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaintenanceController],
      providers: [
        { provide: MaintenanceSchedulerService, useValue: mockSchedulerService },
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
      ],
    }).compile();

    controller = module.get<MaintenanceController>(MaintenanceController);
    schedulerService = module.get<MaintenanceSchedulerService>(MaintenanceSchedulerService);
    taskRegistry = module.get<MaintenanceTaskRegistry>(MaintenanceTaskRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllTasks', () => {
    it('should return all task metadata', () => {
      const mockMetadata = [{ name: 'task1' }];
      mockTaskRegistry.getAllMetadata.mockReturnValue(mockMetadata);

      const result = controller.getAllTasks();
      expect(result).toBe(mockMetadata);
    });
  });

  describe('getTasksByCategory', () => {
    it('should return tasks for valid category', () => {
      const mockTasks = [{ getMetadata: () => ({ name: 'task1' }) }];
      mockTaskRegistry.getTasksByCategory.mockReturnValue(mockTasks);

      const result = controller.getTasksByCategory('cleanup');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('task1');
    });

    it('should throw BadRequestException for invalid category', () => {
      expect(() => controller.getTasksByCategory('invalid')).toThrow(BadRequestException);
    });
  });

  describe('executeTask', () => {
    it('should execute task successfully', async () => {
      mockTaskRegistry.hasTask.mockReturnValue(true);
      mockSchedulerService.executeTaskManually.mockResolvedValue({ success: true });

      const result = await controller.executeTask('task1', { option: 'value' });
      expect(result.success).toBe(true);
      expect(mockSchedulerService.executeTaskManually).toHaveBeenCalledWith('task1', {
        option: 'value',
      });
    });

    it('should throw NotFoundException if task does not exist', async () => {
      mockTaskRegistry.hasTask.mockReturnValue(false);
      await expect(controller.executeTask('task1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeCategory', () => {
    it('should execute all tasks in category', async () => {
      mockSchedulerService.executeCategory.mockResolvedValue(
        new Map([['task1', { success: true }]]),
      );

      const result = await controller.executeCategory('cleanup');
      expect(result['task1'].success).toBe(true);
    });

    it('should throw BadRequestException for invalid category', async () => {
      await expect(controller.executeCategory('invalid')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      mockTaskRegistry.getAllMetadata.mockReturnValue([
        { name: 'task1', enabled: true, category: 'cleanup' },
        { name: 'task2', enabled: false, category: 'recovery' },
      ]);
      mockSchedulerService.getSchedulerStats.mockReturnValue({
        schedulerEnabled: true,
        totalExecutions: 10,
      });

      const result = controller.getHealth();

      expect(result.status).toBe('healthy');
      expect(result.tasks.total).toBe(2);
      expect(result.tasks.enabled).toBe(1);
      expect(result.categories.cleanup).toBe(1);
    });
  });
});
