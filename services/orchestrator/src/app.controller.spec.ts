import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiInfoDto } from './app.dto';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    // Mock AppService (even though getInfo doesn't use it, it's injected in constructor)
    const mockAppService = {
      getHello: jest.fn().mockReturnValue('DTM - Distributed Task Manager - Orchestrator API'),
      getHealth: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: mockAppService }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('getInfo', () => {
    it('should return API information with correct type', () => {
      const result: ApiInfoDto = appController.getInfo();

      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('documentation');
      expect(result).toHaveProperty('dashboard');
      expect(result.message).toBe('Welcome to DTM Orchestrator API');
      expect(result.version).toBe('1.0');
      expect(result.documentation).toBe('/api-docs');
      expect(result.dashboard).toBe('http://localhost:5173');
    });
  });
});
