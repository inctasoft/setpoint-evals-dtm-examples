import { loadEnv } from './env';

export default async function globalSetup(): Promise<void> {
  const env = loadEnv();
  const healthUrl = env.API_BASE_URL.replace('/api/v1', '') + '/api/v1/health';

  // 1. Check orchestrator is reachable
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Health check returned HTTP ${res.status}`);
    }
    console.log(`[Preflight] Orchestrator reachable at ${healthUrl}`);
  } catch (err) {
    throw new Error(
      `[Preflight] Orchestrator not reachable at ${healthUrl}.\n` +
        `  Start services: ./scripts/local-env.sh start --standalone --orchestrator\n` +
        `  Then deploy workers: ./scripts/local-env.sh deploy-workers\n` +
        `  Error: ${err}`,
    );
  }

  // 2. Check core DB is reachable
  const { Pool } = await import('pg');
  const pool = new Pool({
    host: env.DTM_DB_HOST,
    port: env.DTM_DB_PORT,
    user: env.DTM_DB_USER,
    password: env.DTM_DB_PASSWORD,
    database: env.DTM_DB_NAME,
    connectionTimeoutMillis: 5000,
  });
  try {
    await pool.query('SELECT 1');
    console.log(`[Preflight] Database connected at ${env.DTM_DB_HOST}:${env.DTM_DB_PORT}`);
  } catch (err) {
    throw new Error(
      `[Preflight] Cannot connect to DTM database at ${env.DTM_DB_HOST}:${env.DTM_DB_PORT}.\n` +
        `  Ensure dtm-db container is running.\n` +
        `  Error: ${err}`,
    );
  } finally {
    await pool.end();
  }

  console.log('[Preflight] All checks passed. Ready to run STEs.');
}
