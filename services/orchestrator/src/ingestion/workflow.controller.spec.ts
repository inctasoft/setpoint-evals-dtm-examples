import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowController } from './workflow.controller';
import { WorkflowJobService } from './workflow-job.service';
import {
  InitiateWorkflowJobDto,
  InitiateWorkflowJobResponseDto,
} from './dto/initiate-workflow-job.dto';

/**
 * WorkflowController is now a thin HTTP wrapper over WorkflowJobService (see
 * workflow-job.service.spec.ts for the full validation/dedup/orchestration
 * behavior coverage — moved there verbatim when the logic was extracted so
 * it can be reused by EvalsRunService with zero drift). This spec only
 * proves the controller delegates correctly.
 */
describe('WorkflowController', () => {
  let controller: WorkflowController;
  let workflowJobService: jest.Mocked<Pick<WorkflowJobService, 'initiateWorkflowJob'>>;

  beforeEach(async () => {
    const mockWorkflowJobService = {
      initiateWorkflowJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [{ provide: WorkflowJobService, useValue: mockWorkflowJobService }],
    }).compile();

    controller = module.get<WorkflowController>(WorkflowController);
    workflowJobService = module.get(WorkflowJobService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('delegates initiateWorkflowJob to WorkflowJobService with the same workflowName and dto', async () => {
    const dto: InitiateWorkflowJobDto = { variant: 'quick-order', payload: { customerId: 1 } };
    const expected: InitiateWorkflowJobResponseDto = {
      jobId: 'job-1',
      workflowName: 'order-processing',
      variant: 'quick-order',
    };
    workflowJobService.initiateWorkflowJob.mockResolvedValue(expected);

    const result = await controller.initiateWorkflowJob('order-processing', dto);

    expect(workflowJobService.initiateWorkflowJob).toHaveBeenCalledWith('order-processing', dto);
    expect(result).toBe(expected);
  });

  it('propagates rejections from WorkflowJobService without swallowing them', async () => {
    const err = new Error('boom');
    workflowJobService.initiateWorkflowJob.mockRejectedValue(err);

    await expect(controller.initiateWorkflowJob('order-processing', {})).rejects.toThrow('boom');
  });
});
