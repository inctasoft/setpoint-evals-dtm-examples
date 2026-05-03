import { test as base, expect } from '@playwright/test';
import { loadEnv, type SteEnv } from '../helpers/env';
import type { JobStatusResponse, InitiateJobResponse } from '../helpers/types';

export interface DtmApiClient {
  /**
   * POST /api/v1/workflows/{workflowName}/jobs
   * Returns jobId from response body.
   */
  initiateJob(
    payload: Record<string, unknown>,
    workflowName: string,
  ): Promise<{ jobId: string }>;

  /**
   * POST /api/v1/workflows/{workflowName}/jobs with raw response access.
   * Returns the full HTTP response for status code assertions (e.g., 409 Conflict).
   */
  initiateJobRaw(
    payload: Record<string, unknown>,
    workflowName: string,
  ): Promise<{ status: number; body: Record<string, unknown> }>;

  /**
   * GET /api/v1/jobs/{jobId}
   * Returns full job JSON with steps, result, etc.
   */
  getJobStatus(jobId: string): Promise<JobStatusResponse>;

  /**
   * POST /api/v1/maintenance/tasks/{taskName}/execute
   */
  triggerMaintenanceTask(
    taskName: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export const test = base.extend<{
  dtmApi: DtmApiClient;
  env: SteEnv;
}>({
  env: async ({}, use) => {
    await use(loadEnv());
  },

  dtmApi: async ({ request, env }, use) => {
    const api: DtmApiClient = {
      async initiateJob(payload, workflowName) {
        const response = await request.post(
          `${env.API_BASE_URL}/workflows/${workflowName}/jobs`,
          { data: payload },
        );
        expect(response.status(), `Expected 201 from POST /workflows/${workflowName}/jobs`).toBe(201);
        const body = (await response.json()) as InitiateJobResponse;
        return { jobId: body.jobId };
      },

      async initiateJobRaw(payload, workflowName) {
        const response = await request.post(
          `${env.API_BASE_URL}/workflows/${workflowName}/jobs`,
          { data: payload },
        );
        const body = await response.json();
        return { status: response.status(), body };
      },

      async getJobStatus(jobId) {
        const response = await request.get(
          `${env.API_BASE_URL}/jobs/${jobId}`,
        );
        expect(response.ok(), `GET /jobs/${jobId} failed with ${response.status()}`).toBeTruthy();
        return response.json() as Promise<JobStatusResponse>;
      },

      async triggerMaintenanceTask(taskName, body = {}) {
        const response = await request.post(
          `${env.API_BASE_URL}/maintenance/tasks/${taskName}/execute`,
          { data: body },
        );
        return response.json();
      },
    };

    await use(api);
  },
});

export { expect };
