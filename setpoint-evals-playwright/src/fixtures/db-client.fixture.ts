import { Pool } from 'pg';
import { test as apiTest, expect } from './api-client.fixture';
import { loadEnv } from '../helpers/env';
import type { StepRow } from '../helpers/types';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new Pool({
      host: env.DTM_DB_HOST,
      port: env.DTM_DB_PORT,
      user: env.DTM_DB_USER,
      password: env.DTM_DB_PASSWORD,
      database: env.DTM_DB_NAME,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export interface DtmDbClient {
  /** Run a parameterized query */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Get all steps for a job */
  getStepsByJobId(jobId: string): Promise<StepRow[]>;

  /** Get retry_count for a specific step (attempt number, 1-based) */
  getStepRetryCount(jobId: string, stepValue: string): Promise<number>;

  /** Get execution_history array length for a step */
  getExecutionHistoryLength(jobId: string, stepValue: string): Promise<number>;

  /** Check if error field is NULL for a step */
  isStepErrorCleared(jobId: string, stepValue: string): Promise<boolean>;

  /** Check if kafka_published_at is set for a step */
  wasKafkaPublished(jobId: string, stepValue: string): Promise<boolean>;

  /** Check if ack_received_at is set for a step */
  wasAckReceived(jobId: string, stepValue: string): Promise<boolean>;

  /** Get ack delay in seconds (ack_received_at - kafka_published_at) */
  getAckDelaySeconds(jobId: string, stepValue: string): Promise<number>;

  /** Get total job duration in seconds (completed_at - submitted_at) */
  getJobDurationSeconds(jobId: string): Promise<number>;

  /** Delete jobs by deduplicationKey (for deduplication pre-test cleanup) */
  deleteJobsByDeduplicationKey(deduplicationKey: string): Promise<number>;
}

export const test = apiTest.extend<{ dtmDb: DtmDbClient }>({
  dtmDb: async ({}, use) => {
    const db: DtmDbClient = {
      async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        const result = await getPool().query(sql, params);
        return result.rows as T[];
      },

      async getStepsByJobId(jobId) {
        return db.query<StepRow>(
          'SELECT * FROM dtm_steps WHERE job_id = $1 ORDER BY step_value',
          [jobId],
        );
      },

      async getStepRetryCount(jobId, stepValue) {
        const rows = await db.query<{ retry_count: number }>(
          'SELECT retry_count FROM dtm_steps WHERE job_id = $1 AND step_value = $2',
          [jobId, stepValue],
        );
        return rows[0]?.retry_count ?? 0;
      },

      async getExecutionHistoryLength(jobId, stepValue) {
        const rows = await db.query<{ count: number }>(
          'SELECT jsonb_array_length(execution_history) as count FROM dtm_steps WHERE job_id = $1 AND step_value = $2',
          [jobId, stepValue],
        );
        return rows[0]?.count ?? 0;
      },

      async isStepErrorCleared(jobId, stepValue) {
        const rows = await db.query<{ error: string | null }>(
          'SELECT error FROM dtm_steps WHERE job_id = $1 AND step_value = $2',
          [jobId, stepValue],
        );
        return rows[0]?.error === null;
      },

      async wasKafkaPublished(jobId, stepValue) {
        const rows = await db.query<{ published: boolean }>(
          'SELECT kafka_published_at IS NOT NULL as published FROM dtm_steps WHERE job_id = $1 AND step_value = $2',
          [jobId, stepValue],
        );
        return rows[0]?.published ?? false;
      },

      async wasAckReceived(jobId, stepValue) {
        const rows = await db.query<{ received: boolean }>(
          'SELECT ack_received_at IS NOT NULL as received FROM dtm_steps WHERE job_id = $1 AND step_value = $2',
          [jobId, stepValue],
        );
        return rows[0]?.received ?? false;
      },

      async getAckDelaySeconds(jobId, stepValue) {
        const rows = await db.query<{ delay: number }>(
          `SELECT ROUND(EXTRACT(EPOCH FROM (ack_received_at - kafka_published_at))::numeric, 1) as delay
           FROM dtm_steps WHERE job_id = $1 AND step_value = $2`,
          [jobId, stepValue],
        );
        return parseFloat(String(rows[0]?.delay ?? 0));
      },

      async getJobDurationSeconds(jobId) {
        const rows = await db.query<{ duration: number }>(
          `SELECT ROUND(EXTRACT(EPOCH FROM (completed_at - submitted_at))::numeric, 1) as duration
           FROM dtm_jobs WHERE id = $1`,
          [jobId],
        );
        return parseFloat(String(rows[0]?.duration ?? 0));
      },

      async deleteJobsByDeduplicationKey(deduplicationKey) {
        const rows = await db.query<{ id: string }>(
          "DELETE FROM dtm_jobs WHERE payload->>'deduplicationKey' = $1 RETURNING id",
          [deduplicationKey],
        );
        return rows.length;
      },
    };

    await use(db);
  },
});

export { expect };

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
