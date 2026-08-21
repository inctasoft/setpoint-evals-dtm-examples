/**
 * Database Configuration Module
 *
 * Provides typed configuration for both the orchestrator DB and the source DB.
 * Automatically detects runtime mode and adjusts host/port accordingly.
 */

import { registerAs } from '@nestjs/config';
import { detectRuntime, getDatabaseHost, getDatabasePort } from './runtime.config';

/**
 * Orchestrator Database Configuration
 * This is the primary database for the orchestrator service.
 */
export const databaseConfig = registerAs('database', () => {
  const runtime = detectRuntime();
  const host = getDatabaseHost(process.env.DTM_DB_HOST, 'dtm-db', 'localhost');
  const port = getDatabasePort(
    process.env.DTM_DB_PORT,
    process.env.DTM_DB_PORT_HOST,
    5432, // Container internal port
    5448, // Host-mapped port
  );

  // Log resolved database config for debugging
  console.log(`[DatabaseConfig] Runtime: ${runtime}, Host: ${host}, Port: ${port}`);

  return {
    type: 'postgres' as const,
    host,
    port,
    username: process.env.DTM_DB_USER || 'dtm_user',
    password: process.env.DTM_DB_PASSWORD || 'your_password',
    database: process.env.DTM_DB_NAME || 'dtm',
    // SSL is only enabled in production (EKS)
    ssl: runtime === 'eks' ? { rejectUnauthorized: false } : false,
    // Synchronize should never be true in production
    synchronize: false,
    autoLoadEntities: true,
    // Connection pool settings
    poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
    // Logging
    logging: process.env.DB_LOGGING === 'true',
  };
});

/**
 * Database configuration type for TypeScript
 */
export interface DatabaseConfig {
  type: 'postgres';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: false | { rejectUnauthorized: boolean };
  synchronize: boolean;
  autoLoadEntities: boolean;
  poolSize: number;
  logging: boolean;
}

export default databaseConfig;
