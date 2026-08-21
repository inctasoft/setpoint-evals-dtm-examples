/**
 * E2E Test Helpers for DTM Orchestrator
 *
 * Utility functions for end-to-end testing of the workflow orchestration flow.
 * Provides helpers for database queries, service health checks, and assertions.
 *
 * Adapted for DTM schema:
 * - dtm_jobs (not tracker)
 * - dtm_steps (not data_entity)
 * - Steps use stepValue (e.g., "ValidateCustomer", "SubmitOrder")
 */

import { Client, QueryResult, QueryResultRow } from 'pg';
import axios, { AxiosInstance } from 'axios';

// ============================================================================
// Configuration
// ============================================================================

const getDtmDbConfig = () => ({
  host: process.env.DTM_DB_HOST || 'localhost',
  port: parseInt(process.env.DTM_DB_PORT_HOST || '5438', 10),
  user: process.env.DTM_DB_USER || 'dtm_user',
  password: process.env.DTM_DB_PASSWORD || 'your_password',
  database: process.env.DTM_DB_NAME || 'dtm',
  connectionTimeoutMillis: 10000,
});

const getWorkflowSourceDbConfig = () => ({
  host: process.env.ORDER_PROCESSING_DB_HOST || 'localhost',
  port: parseInt(process.env.ORDER_PROCESSING_DB_PORT || '5448', 10),
  user: process.env.ORDER_PROCESSING_DB_USER || 'order_user',
  password: process.env.ORDER_PROCESSING_DB_PASSWORD || 'order_pass',
  database: process.env.ORDER_PROCESSING_DB_NAME || 'order_processing_db',
  connectionTimeoutMillis: 10000,
});

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3002';

// ============================================================================
// Database Helpers
// ============================================================================

export class DatabaseHelper {
  async queryDtmDB<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const config = getDtmDbConfig();
    const client = new Client(config);
    try {
      await client.connect();
      const result: QueryResult<T> = await client.query<T>(sql, params);
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      console.error('DTM DB query error:', {
        message: err.message,
        code: err.code,
        config: { ...config, password: '***' },
      });
      throw error;
    } finally {
      await client.end().catch(() => {
        /* ignore */
      });
    }
  }

  async queryWorkflowSourceDB<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const config = getWorkflowSourceDbConfig();
    const client = new Client(config);
    try {
      await client.connect();
      const result: QueryResult<T> = await client.query<T>(sql, params);
      return result;
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      console.error('Workflow source DB query error:', err.message, err.code);
      throw error;
    } finally {
      await client.end().catch(() => {
        /* ignore */
      });
    }
  }

  async close(): Promise<void> {
    // No pools to close - we use individual clients
  }

  /**
   * Get job by ID from dtm_jobs table
   */
  async getJob(
    jobId: string,
  ): Promise<{ id: string; status: string; type: string; payload: unknown } | null> {
    const result = await this.queryDtmDB<{
      id: string;
      status: string;
      type: string;
      payload: unknown;
    }>(`SELECT id, status, type, payload FROM dtm_jobs WHERE id = $1`, [jobId]);
    return result.rows[0] || null;
  }

  /**
   * Get all steps for a job
   */
  async getJobSteps(jobId: string): Promise<
    Array<{
      id: string;
      stepValue: string;
      status: string;
      input: unknown;
      output: unknown;
      error: string | null;
    }>
  > {
    const result = await this.queryDtmDB<{
      id: string;
      stepValue: string;
      status: string;
      input: unknown;
      output: unknown;
      error: string | null;
    }>(
      `SELECT id, step_value as "stepValue", status, input, output, error 
       FROM dtm_steps 
       WHERE job_id = $1 
       ORDER BY started_at ASC`,
      [jobId],
    );
    return result.rows;
  }

  /**
   * Get a specific step by job ID and step name
   */
  async getStep(
    jobId: string,
    stepValue: string,
  ): Promise<{
    id: string;
    stepValue: string;
    status: string;
    input: unknown;
    output: unknown;
    error: string | null;
  } | null> {
    const result = await this.queryDtmDB<{
      id: string;
      stepValue: string;
      status: string;
      input: unknown;
      output: unknown;
      error: string | null;
    }>(
      `SELECT id, step_value as "stepValue", status, input, output, error 
       FROM dtm_steps 
       WHERE job_id = $1 AND step_value = $2
       LIMIT 1`,
      [jobId, stepValue],
    );
    return result.rows[0] || null;
  }

  /**
   * Wait for a step to reach a specific status
   */
  async waitForStepStatus(
    jobId: string,
    stepValue: string,
    targetStatus: string | string[],
    timeoutMs = 60000,
    pollIntervalMs = 500,
  ): Promise<{
    id: string;
    stepValue: string;
    status: string;
    input: unknown;
    output: unknown;
  }> {
    const startTime = Date.now();
    const targetStatuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];

    while (Date.now() - startTime < timeoutMs) {
      const step = await this.getStep(jobId, stepValue);
      if (step && targetStatuses.includes(step.status)) {
        return step;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Step ${stepValue} did not reach status ${targetStatuses.join('/')} within ${timeoutMs}ms`,
    );
  }

  /**
   * Wait for job to reach a specific status
   */
  async waitForJobStatus(
    jobId: string,
    targetStatus: string | string[],
    timeoutMs = 120000,
    pollIntervalMs = 500,
  ): Promise<{ id: string; status: string }> {
    const startTime = Date.now();
    const targetStatuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];

    while (Date.now() - startTime < timeoutMs) {
      const job = await this.getJob(jobId);
      if (job && targetStatuses.includes(job.status)) {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Job ${jobId} did not reach status ${targetStatuses.join('/')} within ${timeoutMs}ms`,
    );
  }

  /**
   * Clean test data from DTM database
   */
  async cleanTestData(jobId: string): Promise<void> {
    await this.queryDtmDB(`DELETE FROM dtm_steps WHERE job_id = $1`, [jobId]);
    await this.queryDtmDB(`DELETE FROM dtm_jobs WHERE id = $1`, [jobId]);
  }

  /**
   * Get customer from workflow source DB by customer_id
   */
  async getWorkflowCustomer(customerId: number): Promise<Record<string, unknown> | null> {
    const result = await this.queryWorkflowSourceDB<Record<string, unknown>>(
      `SELECT * FROM ecommerce.customers WHERE customer_id = $1 LIMIT 1`,
      [customerId],
    );
    return result.rows[0] || null;
  }

  /**
   * Get order from workflow source DB by order_id
   */
  async getWorkflowOrder(orderId: string): Promise<Record<string, unknown> | null> {
    const result = await this.queryWorkflowSourceDB<Record<string, unknown>>(
      `SELECT * FROM orders WHERE order_id = $1 LIMIT 1`,
      [orderId],
    );
    return result.rows[0] || null;
  }

  /**
   * Get line items count from workflow source DB for an order
   */
  async getWorkflowLineItemsCount(orderId: string): Promise<number> {
    const result = await this.queryWorkflowSourceDB<{ count: string }>(
      `SELECT COUNT(*) as count FROM order_items WHERE order_id = $1`,
      [orderId],
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }

  /**
   * Get payment count from workflow source DB for an order
   */
  async getWorkflowPaymentCount(orderId: string): Promise<number> {
    const result = await this.queryWorkflowSourceDB<{ count: string }>(
      `SELECT COUNT(*) as count FROM payments WHERE order_id = $1`,
      [orderId],
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  }
}

// ============================================================================
// Service Helpers
// ============================================================================

export class ServiceHelper {
  private orchestratorClient: AxiosInstance;

  constructor() {
    this.orchestratorClient = axios.create({
      baseURL: ORCHESTRATOR_URL,
      timeout: 10000,
    });
  }

  /**
   * Wait for service to be healthy
   */
  async waitForServiceHealth(url?: string, maxRetries = 30, delayMs = 1000): Promise<void> {
    const client = url ? axios.create({ baseURL: url, timeout: 5000 }) : this.orchestratorClient;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await client.get('/api/v1/health/ready');
        return;
      } catch {
        if (i === maxRetries - 1) {
          throw new Error(`Service did not become healthy after ${maxRetries} retries`);
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Trigger job via Orchestrator API
   * POST /api/v1/workflows/order-processing/jobs
   *
   * NOTE: No testOptions with delays - we want fast happy path execution
   */
  async triggerJob(
    customerId: string,
    options?: {
      orderId?: string;
      jobType?: string;
    },
  ): Promise<{ jobId: string }> {
    // Use unique order ID per test run to avoid deduplication conflicts
    const timestamp = Date.now();
    const orderId = options?.orderId || `e2e-jest-${timestamp}`;

    const response = await this.orchestratorClient.post<{ jobId: string }>(
      `/api/v1/workflows/order-processing/jobs`,
      {
        customerId,
        orderId,
        jobType: options?.jobType,
        // Fast execution settings - no delays, deduplication disabled
        testOptions: {
          // Disable deduplication for tests
          enableDeduplication: false,
          // Override default delays to 0 for fast tests
          ValidateCustomer: { simDelay: 0 },
          SubmitCustomer: { simDelay: 0 },
          ValidateProduct: { simDelay: 0 },
          ValidateOrder: { simDelay: 0 },
          SubmitOrder: { simDelay: 0 },
          DiscoverLineItems: { simDelay: 0 },
          ValidateLineItem: { simDelay: 0 },
          SubmitLineItem: { simDelay: 0 },
          ValidatePayment: { simDelay: 0 },
          SubmitPayment: { simDelay: 0 },
          ValidateShipment: { simDelay: 0 },
          SubmitShipment: { simDelay: 0 },
        },
      },
    );

    const jobId = response.data?.jobId;
    if (!jobId || typeof jobId !== 'string') {
      throw new Error('Job creation response missing jobId');
    }
    return { jobId };
  }

  /**
   * Get job status via API
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    result?: {
      totalSteps: number;
      stepsCompleted: number;
      stepsFailed: number;
    };
    steps?: Array<{
      stepNumber: string;
      status: string;
    }>;
  }> {
    const response = await this.orchestratorClient.get(`/api/v1/jobs/${jobId}`);
    return response.data;
  }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

export class AssertionHelper {
  /**
   * Assert step completed successfully with output
   */
  async assertStepCompleted(
    db: DatabaseHelper,
    jobId: string,
    stepValue: string,
  ): Promise<{ output: unknown }> {
    const step = await db.waitForStepStatus(jobId, stepValue, 'completed', 60000);
    expect(step.status).toBe('completed');
    expect(step.output).toBeDefined();
    console.log(`✅ ${stepValue} completed`);
    return { output: step.output };
  }

  /**
   * Assert job completed successfully
   */
  async assertJobCompleted(db: DatabaseHelper, jobId: string): Promise<void> {
    const job = await db.waitForJobStatus(jobId, 'completed', 120000);
    expect(job.status).toBe('completed');
    console.log(`✅ Job ${jobId} completed`);
  }

  /**
   * Assert all expected steps exist and completed
   */
  async assertAllStepsCompleted(
    db: DatabaseHelper,
    jobId: string,
    expectedSteps: string[],
  ): Promise<void> {
    const steps = await db.getJobSteps(jobId);
    const completedSteps = steps.filter((s) => s.status === 'completed');

    for (const expectedStep of expectedSteps) {
      const found = completedSteps.find((s) => s.stepValue === expectedStep);
      expect(found).toBeDefined();
      console.log(`✅ ${expectedStep}: completed`);
    }
  }

  /**
   * Assert step output contains expected data
   */
  assertOutputContains(output: unknown, expectedKeys: string[]): void {
    expect(output).toBeDefined();
    const outputObj = output as Record<string, unknown>;
    for (const key of expectedKeys) {
      expect(outputObj).toHaveProperty(key);
    }
  }

  /**
   * Assert output data is an array with expected length
   */
  assertOutputArrayLength(output: unknown, key: string, expectedLength: number): void {
    expect(output).toBeDefined();
    const outputObj = output as Record<string, unknown>;
    expect(outputObj).toHaveProperty(key);
    const arr = outputObj[key];
    expect(Array.isArray(arr)).toBe(true);
    expect((arr as unknown[]).length).toBe(expectedLength);
  }
}
