/**
 * DataSource for Orchestrator Migrations
 *
 * This file imports the shared DataSource from @dtm/database package.
 * All database configuration is centralized in the database package
 * using DTM_DB_* environment variables.
 *
 * Note: Environment variables are loaded by the migration script via the .env file,
 * so we don't need to import 'dotenv/config' here.
 *
 * @see packages/database/src/config/typeorm.config.ts
 */
import dataSource from '@dtm/database/dist/config/typeorm.config';

export default dataSource;
