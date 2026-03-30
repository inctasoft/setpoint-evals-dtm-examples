import { DataSource } from "typeorm";
import * as path from "path";
import { Job, Step } from "../entities";

// Resolve migrations path relative to the database package
// Clean single-migration approach: Only dtm_jobs and dtm_steps tables
const migrationsPath = path.join(__dirname, "..", "migrations", "*.js");

export default new DataSource({
  type: "postgres",
  host: process.env.DTM_DB_HOST || "localhost",
  // Use DTM_DB_PORT for Docker internal (5432), DTM_DB_PORT_HOST for localhost (5448)
  port: parseInt(
    process.env.DTM_DB_PORT ||
      process.env.DTM_DB_PORT_HOST ||
      "5448",
  ),
  username: process.env.DTM_DB_USER || "dtm_user",
  password: process.env.DTM_DB_PASSWORD || "dtm",
  database: process.env.DTM_DB_NAME || "dtm",
  entities: [Job, Step],
  migrations: [migrationsPath],
  // Always use migrations, not auto-sync (safer, production-like)
  synchronize: false,
  logging:
    process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});
