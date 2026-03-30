import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceSchedulerService } from './maintenance-scheduler.service';
import { MaintenanceTaskRegistry } from '../registry/maintenance-task-registry';
import { ConfigService } from '@nestjs/config';

describe('MaintenanceSchedulerService', () => {
  let service: MaintenanceSchedulerService;

  const mockTaskRegistry = {
    getTask: jest.fn(),
    getTasksByCategory: jest.fn(),
    getEnabledTasks: jest.fn(),
    getAllMetadata: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceSchedulerService,
        { provide: MaintenanceTaskRegistry, useValue: mockTaskRegistry },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MaintenanceSchedulerService>(MaintenanceSchedulerService);
    taskRegistry = module.get<MaintenanceTaskRegistry>(MaintenanceTaskRegistry);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeTaskManually', () => {
    it('should execute task manually', async () => {
      const mockTask = { execute: jest.fn().mockResolvedValue({ success: true }) };
      mockTaskRegistry.getTask.mockReturnValue(mockTask);

      // Mock ENABLE_REQUESTS_FOR_SIMULATED_DELAYS check
      mockConfigService.get.mockImplementation((key, defaultVal) => {
        if (key === 'ENABLE_REQUESTS_FOR_SIMULATED_DELAYS') return 'true';
        return defaultVal;
      });

      const result = await service.executeTaskManually('task1', { option: 'value' });

      expect(result.success).toBe(true);
      expect(mockTask.execute).toHaveBeenCalledWith({ option: 'value' });
    });

    it('should ignore options if overrides disabled', async () => {
      const mockTask = { execute: jest.fn().mockResolvedValue({ success: true }) };
      mockTaskRegistry.getTask.mockReturnValue(mockTask);

      // Mock ENABLE_REQUESTS_FOR_SIMULATED_DELAYS check
      mockConfigService.get.mockImplementation((key, defaultVal) => {
        if (key === 'ENABLE_REQUESTS_FOR_SIMULATED_DELAYS') return 'false';
        return defaultVal;
      });

      await service.executeTaskManually('task1', { option: 'value' });

      expect(mockTask.execute).toHaveBeenCalledWith(undefined);
    });

    it('should throw error if task not found', async () => {
      mockTaskRegistry.getTask.mockReturnValue(undefined);
      await expect(service.executeTaskManually('task1')).rejects.toThrow('Task not found: task1');
    });
  });

  describe('executeCategory', () => {
    it('should execute all tasks in category', async () => {
      const mockTask = {
        execute: jest.fn().mockResolvedValue({ success: true }),
        getMetadata: jest.fn().mockReturnValue({ name: 'task1', priority: 1 }),
      };
      mockTaskRegistry.getTasksByCategory.mockReturnValue([mockTask]);

      const result = await service.executeCategory('cleanup');

      expect(result.size).toBe(1);
      expect(result.get('task1').success).toBe(true);
    });
  });

  describe('getSchedulerStats', () => {
    it('should return scheduler stats', () => {
      mockTaskRegistry.getAllMetadata.mockReturnValue([
        { name: 'task1', enabled: true, category: 'cleanup' },
      ]);

      const result = service.getSchedulerStats();

      expect(result.totalTasks).toBe(1);
      expect(result.enabledTasks).toBe(1);
      expect(result.tasksByCategory.cleanup).toBe(1);
    });
  });
});
