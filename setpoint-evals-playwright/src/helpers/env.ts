import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

export interface SteEnv {
  API_BASE_URL: string;
  ORCHESTRATOR_PORT: number;
  DTM_DB_HOST: string;
  DTM_DB_PORT: number;
  DTM_DB_USER: string;
  DTM_DB_PASSWORD: string;
  DTM_DB_NAME: string;
  COMPOSE_PROJECT_NAME: string;
  ADDITIONAL_TIMEOUT: number;
}

export function loadEnv(): SteEnv {
  const repoRoot = path.resolve(__dirname, '../../..');

  // Load .env.development first, fall back to .env
  const envDevPath = path.join(repoRoot, '.env.development');
  const envPath = path.join(repoRoot, '.env');

  if (fs.existsSync(envDevPath)) {
    dotenv.config({ path: envDevPath });
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const port = parseInt(process.env.ORCHESTRATOR_PORT_HOST ?? process.env.ORCHESTRATOR_PORT ?? '3002', 10);

  return {
    API_BASE_URL: process.env.API_BASE_URL ?? `http://localhost:${port}/api/v1`,
    ORCHESTRATOR_PORT: port,
    DTM_DB_HOST: process.env.DTM_DB_HOST_LOCAL ?? 'localhost',
    DTM_DB_PORT: parseInt(process.env.DTM_DB_PORT_HOST ?? '5448', 10),
    DTM_DB_USER: process.env.DTM_DB_USER ?? 'dtm_user',
    DTM_DB_PASSWORD: process.env.DTM_DB_PASSWORD ?? 'migration_pass',
    DTM_DB_NAME: process.env.DTM_DB_NAME ?? 'dtm',
    COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME ?? 'dtm',
    ADDITIONAL_TIMEOUT: parseInt(process.env.ADDITIONAL_TIMEOUT ?? '0', 10),
  };
}
