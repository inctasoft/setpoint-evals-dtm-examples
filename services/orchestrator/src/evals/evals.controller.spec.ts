import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EvalsController } from './evals.controller';
import { EvalsDiscoveryService } from './evals-discovery.service';
import { EvalsRunService } from './evals-run.service';
import { EvalSummary } from './evals.types';

describe('EvalsController', () => {
  let controller: EvalsController;
  let discovery: jest.Mocked<Pick<EvalsDiscoveryService, 'listEvals' | 'getEval'>>;
  let runService: jest.Mocked<Pick<EvalsRunService, 'run'>>;

  const evalItem: EvalSummary = {
    suite: 'core',
    id: 'SE-01-x',
    name: 'SE-01: x',
    hasReadme: true,
  };

  beforeEach(async () => {
    const mockDiscovery = { listEvals: jest.fn(), getEval: jest.fn() };
    const mockRunService = { run: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EvalsController],
      providers: [
        { provide: EvalsDiscoveryService, useValue: mockDiscovery },
        { provide: EvalsRunService, useValue: mockRunService },
      ],
    }).compile();

    controller = module.get(EvalsController);
    discovery = module.get(EvalsDiscoveryService);
    runService = module.get(EvalsRunService);
  });

  afterEach(() => jest.clearAllMocks());

  it('GET /evals delegates to discovery.listEvals()', () => {
    discovery.listEvals.mockReturnValue([evalItem]);
    expect(controller.list()).toEqual([evalItem]);
  });

  it('GET /evals/:suite/:id returns the eval', () => {
    discovery.getEval.mockReturnValue(evalItem);
    expect(controller.getOne('core', 'SE-01-x')).toEqual(evalItem);
    expect(discovery.getEval).toHaveBeenCalledWith('core', 'SE-01-x');
  });

  it('GET /evals/:suite/:id throws 404 for an unknown eval', () => {
    discovery.getEval.mockReturnValue(undefined);
    expect(() => controller.getOne('core', 'SE-99-missing')).toThrow(NotFoundException);
  });

  it('POST /evals/:suite/:id/run delegates to runService.run()', async () => {
    runService.run.mockResolvedValue({ jobId: 'job-1' });
    const result = await controller.run('core', 'SE-01-x');
    expect(result).toEqual({ jobId: 'job-1' });
    expect(runService.run).toHaveBeenCalledWith('core', 'SE-01-x');
  });
});
