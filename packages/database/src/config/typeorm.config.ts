import { DataSource } from "typeorm";
import * as path from "path";
import { Job, Step, DeadLetter } from "../entities";

// Resolve migrations path relative to the database package.
// Clean single-migration approach: Only dtm_jobs and dtm_steps tables.
// Match the CURRENT module's own extension: when this config is loaded from
// the built dist/ (the path services/orchestrator/dataSource.ts and the
// init-typeorm Docker container use), __dirname is dist/config and sibling
// migrations are compiled *.js. When it's loaded directly via
// `typeorm-ts-node-commonjs -d src/config/typeorm.config.ts` (this
// package's own migration:run/show/generate scripts), __dirname is
// src/config and the migrations are still *.ts source — a hardcoded "*.js"
// glob would silently match zero files there (no error, just an empty
// migration list), which is exactly the kind of divergent-truth this
// package exists to prevent.
const migrationsExt = __filename.endsWith(".ts") ? "ts" : "js";
const migrationsPath = path.join(
  __dirname,
  "..",
  "migrations",
  `*.${migrationsExt}`,
);

export default new DataSource({
  type: "postgres",
  host: process.env.DTM_DB_HOST || "localhost",
  // Use DTM_DB_PORT for Docker internal (5432), DTM_DB_PORT_HOST for localhost (5448)
  port: parseInt(
    process.env.DTM_DB_PORT || process.env.DTM_DB_PORT_HOST || "5448",
  ),
  username: process.env.DTM_DB_USER || "dtm_user",
  password: process.env.DTM_DB_PASSWORD || "dtm",
  database: process.env.DTM_DB_NAME || "dtm",
  entities: [Job, Step, DeadLetter],
  migrations: [migrationsPath],
  // Always use migrations, not auto-sync (safer, production-like)
  synchronize: false,
  logging:
    process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});
