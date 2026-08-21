import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EvalsRunService } from './evals-run.service';
import { EvalsDiscoveryService } from './evals-discovery.service';
import { WorkflowJobService } from '../ingestion/workflow-job.service';
import { EvalSummary } from './evals.types';

describe('EvalsRunService', () => {
  let service: EvalsRunService;
  let discovery: jest.Mocked<Pick<EvalsDiscoveryService, 'getEval'>>;
  let workflowJobService: jest.Mocked<Pick<WorkflowJobService, 'initiateWorkflowJob'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;

  const workflowSuiteEval: EvalSummary = {
    suite: 'order-processing',
    id: 'SE-01-happy-path',
    name: 'SE-01: happy path',
    hasReadme: true,
    readme: '# SE-01: happy path',
    payload: { raw: '{}', json: { variant: 'default', payload: { customerId: 1 } } },
  };

  const coreEvalWithToken: EvalSummary = {
    suite: 'core',
    id: 'SE-01-retry-transient-failure',
    name: 'SE-01: retry transient failure',
    hasReadme: true,
    readme: 'POSTed to `${ORCHESTRATOR_URL}/workflows/order-processing/jobs` via `initiate_job()`.',
    payload: {
      raw: '{}',
      json: { variant: 'quick-order', payload: { entityId: '<uuidgen per run>' } },
    },
  };

  beforeEach(async () => {
    const mockDiscovery = { getEval: jest.fn() };
    const mockWorkflowJobService = { initiateWorkflowJob: jest.fn() };
    const mockConfigService = { get: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvalsRunService,
        { provide: EvalsDiscoveryService, useValue: mockDiscovery },
        { provide: WorkflowJobService, useValue: mockWorkflowJobService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(EvalsRunService);
    discovery = module.get(EvalsDiscoveryService);
    workflowJobService = module.get(WorkflowJobService);
    configService = module.get(ConfigService);
  });

  afterEach(() => jest.clearAllMocks());

  it('resolves workflowName structurally for a workflow suite (no README parsing needed)', async () => {
    discovery.getEval.mockReturnValue(workflowSuiteEval);
    workflowJobService.initiateWorkflowJob.mockResolvedValue({
      jobId: 'job-1',
      workflowName: 'order-processing',
      variant: 'default',
    });

    const result = await service.run('order-processing', 'SE-01-happy-path');

    expect(workflowJobService.initiateWorkflowJob).toHaveBeenCalledWith(
      'order-processing',
      expect.objectContaining({ variant: 'default' }),
    );
    expect(result).toEqual({ jobId: 'job-1' });
  });

  it('resolves workflowName from the README /workflows/<name>/jobs token for the core suite', async () => {
    discovery.getEval.mockReturnValue(coreEvalWithToken);
    workflowJobService.initiateWorkflowJob.mockResolvedValue({
      jobId: 'job-2',
      workflowName: 'order-processing',
      variant: 'quick-order',
    });

    await service.run('core', 'SE-01-retry-transient-failure');

    expect(workflowJobService.initiateWorkflowJob).toHaveBeenCalledWith(
      'order-processing',
      expect.anything(),
    );
  });

  it('falls back to order-processing for a core eval with no explicit token', async () => {
    discovery.getEval.mockReturnValue({
      ...coreEvalWithToken,
      readme: '# SE-05: concurrent jobs\nno explicit workflows/.../jobs token here',
    });
    workflowJobService.initiateWorkflowJob.mockResolvedValue({
      jobId: 'job-3',
      workflowName: 'order-processing',
      variant: 'default',
    });

    await service.run('core', 'SE-05-concurrent-jobs');

    expect(workflowJobService.initiateWorkflowJob).toHaveBeenCalledWith(
      'order-processing',
      expect.anything(),
    );
  });

  it('freshens README template placeholders (e.g. "<uuidgen per run>") into a real uuid, never sends the literal placeholder', async () => {
    discovery.getEval.mockReturnValue(coreEvalWithToken);
    workflowJobService.initiateWorkflowJob.mockResolvedValue({
      jobId: 'job-4',
      workflowName: 'order-processing',
      variant: 'quick-order',
    });

    await service.run('core', 'SE-01-retry-transient-failure');

    const [, dto] = workflowJobService.initiateWorkflowJob.mock.calls[0];
    const entityId = (dto as any).payload.entityId;
    expect(entityId).not.toBe('<uuidgen per run>');
    // A real uuidv4 shape.
    expect(entityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('throws 404 for an unknown eval', async () => {
    discovery.getEval.mockReturnValue(undefined);
    await expect(service.run('core', 'SE-99-missing')).rejects.toThrow(NotFoundException);
  });

  it('throws 422 for an eval with no "## Payload" section (e.g. SE-14/SE-15)', async () => {
    discovery.getEval.mockReturnValue({
      suite: 'core',
      id: 'SE-14-schema-single-source',
      name: 'SE-14: schema single source',
      hasReadme: true,
      readme: '# SE-14: schema single source\nno payload section',
      payload: undefined,
    });

    await expect(service.run('core', 'SE-14-schema-single-source')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(workflowJobService.initiateWorkflowJob).not.toHaveBeenCalled();
  });

  it('throws 422 for an eval with a malformed Payload JSON block (not a crash)', async () => {
    discovery.getEval.mockReturnValue({
      suite: 'core',
      id: 'SE-18-malformed-payload',
      name: 'SE-18: malformed payload',
      hasReadme: true,
      readme: '# SE-18: malformed payload',
      payload: { raw: '{ broken', parseError: 'Unexpected token' },
    });

    await expect(service.run('core', 'SE-18-malformed-payload')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(workflowJobService.initiateWorkflowJob).not.toHaveBeenCalled();
  });

  it('throws 403 when ENABLE_EVAL_RUN_API is disabled, before even looking up the eval', async () => {
    configService.get.mockReturnValue(false);

    await expect(service.run('core', 'SE-01-retry-transient-failure')).rejects.toThrow(
      ForbiddenException,
    );
    expect(discovery.getEval).not.toHaveBeenCalled();
    expect(workflowJobService.initiateWorkflowJob).not.toHaveBeenCalled();
  });
});
