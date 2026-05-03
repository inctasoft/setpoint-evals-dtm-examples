# @dtm/database

Shared TypeORM entities, migrations, and database configuration for DTM (Distributed Task Manager).

## Overview

This package contains:
- **Entities**: TypeORM entities shared across the monorepo (dtm_jobs, dtm_steps)
- **Migrations**: Database migration files (currently: 1 clean migration)
- **Data Source**: TypeORM DataSource configuration

**POC Mode**: We maintain a single clean migration that creates the complete schema.

## Installation

This package is part of the pnpm workspace and is automatically installed when you run `pnpm install` from the project root.

```bash
# From project root
pnpm install
```

## Building

```bash
# From packages/database directory
pnpm run build

# Or from project root
pnpm --filter @dtm/database run build
```

## Database Migrations

### Current State (POC Mode)

We maintain **ONE clean migration** that creates the entire schema:
- `1765443716000-InitialMigrationSchema.ts` - Creates dtm_jobs and dtm_steps tables

**All legacy migrations have been permanently removed.**

### After clean:all

If you run `./scripts/local-env.sh clean` and the database is wiped, restore the clean state:

```bash
./scripts/init-clean-database.sh
```

This script:
1. Drops all tables and recreates the schema
2. Creates ONLY dtm_jobs and dtm_steps tables
3. Adds the migration history record
4. Verifies the clean state

### Prerequisites

Before running migrations, ensure:
1. The database service is running: `./scripts/local-env.sh start --standalone --db`
2. Environment variables are configured in `.env` at the project root

### Available Scripts

#### Show Migration Status
```bash
cd packages/database
pnpm run migration:show
```

Shows which migrations have been executed ([X]) and which are pending ([ ]).

#### Run Migrations
```bash
cd packages/database
pnpm run migration:run
```

Executes all pending migrations in order.

#### Revert Last Migration
```bash
cd packages/database
pnpm run migration:revert
```

Reverts the most recently executed migration.

#### Create New Migration (Empty)
```bash
cd packages/database
pnpm run migration:create MigrationName
```

Creates an empty migration file with `up()` and `down()` methods that you need to implement manually.

**Example:**
```bash
pnpm run migration:create AddUserEmailIndex
```

This will create: `migrations/1234567890-AddUserEmailIndex.ts`

#### Generate Migration (From Entity Changes)
```bash
cd packages/database
pnpm run migration:generate MigrationName
```

Automatically generates a migration by comparing your entities with the current database schema.

**Example:**
```bash
pnpm run migration:generate UpdateTrackerTable
```

**Note:** This requires:
- A running database connection
- Your entities to be properly defined
- The database package to be built (`pnpm run build`)

### Migration Workflow

#### 1. Creating a New Entity

1. Create your entity in `src/entities/` or `src/entities-example/`
2. Export it from `src/index.ts`
3. Add it to the DataSource entities array in `src/config/typeorm.config.ts`
4. Build the package: `pnpm run build`
5. Generate migration: `pnpm run migration:generate AddNewEntity`
6. Review the generated migration file
7. Run the migration: `pnpm run migration:run`

#### 2. Modifying an Existing Entity

1. Update the entity file
2. Build the package: `pnpm run build`
3. Generate migration: `pnpm run migration:generate UpdateEntityName`
4. Review the generated migration to ensure it matches your intentions
5. Run the migration: `pnpm run migration:run`

#### 3. Custom Migration (e.g., Data Migration)

1. Create empty migration: `pnpm run migration:create MigrateExistingData`
2. Implement the `up()` and `down()` methods manually
3. Run the migration: `pnpm run migration:run`

### Running Migrations from Orchestrator

```bash
cd services/orchestrator
pnpm run migrate
```

This is a convenience script that runs migrations from the orchestrator package directory.

### Docker Container Migrations

#### Production Mode

In production mode, migrations are handled by a separate **init container** that runs before the orchestrator starts:

1. **migration-init** container starts and waits for the database to be healthy
2. Migrations are executed via `pnpm run migration:run`
3. Init container completes successfully
4. **orchestrator** container starts only after migrations complete

This separation ensures:
- Clean separation of concerns
- Migrations run once before app startup
- Orchestrator image is production-ready (no migration code)
- Proper startup ordering with Docker Compose dependencies

**Start production mode:**
```bash
./scripts/local-env.sh start --standalone --db --orchestrator
```

The orchestrator uses a multi-stage Docker build for optimized production images.

#### Development Mode

In development mode, the orchestrator runs with hot reload enabled:

```bash
./scripts/local-env.sh start --standalone --db --orchestrator --dev
```

This mode:
- Mounts source code for live reloading
- Uses `Dockerfile.dev` instead of the production `Dockerfile`
- Still relies on the init container for migrations
- Allows you to edit code without rebuilding

## Entities

### Production Entities

- **Job** (`src/entities/job.entity.ts`) - Job tracking
- **Step** (`src/entities/step.entity.ts`) - Step tracking with retry logic

### Example/Development Entities

- **Example** (`src/entities-example/example.entity.ts`)

## Using in Other Packages

```typescript
import { Job, MigrationStep } from '@dtm/database';
import { JobStatus, StepStatus } from '@dtm/database';
```

## Environment Variables

The following environment variables are required (set in `.env` at project root):

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=pp_admin
DATABASE_PASSWORD=your_password
DATABASE_NAME=pp_db
NODE_ENV=development
```

**Note:** When running migrations locally, `DATABASE_HOST=localhost` is automatically set by the migration scripts to ensure they connect to the local database rather than the Docker container.

## Troubleshooting

### Migration Generation Issues

**Problem:** `migration:generate` says "No changes detected" even though you modified entities.

**Solution:**
1. Ensure the package is built: `pnpm run build`
2. Verify your entity is exported from `src/index.ts`
3. Verify your entity is in the DataSource entities array
4. Check that the database is running and accessible

### Connection Issues

**Problem:** Cannot connect to database when running migrations.

**Solution:**
1. Ensure the database is running: `docker compose ps db`
2. Check your `.env` file has the correct credentials
3. Verify the database is accessible: `docker compose exec db psql -U pp_admin -d pp_db -c "SELECT 1;"`

### Migration Execution Order

Migrations are executed in alphabetical order by their timestamp prefix. Never modify a migration file that has already been executed in production.

If you need to make changes:
1. Revert the migration locally: `pnpm run migration:revert`
2. Delete the migration file
3. Make your changes
4. Generate a new migration
5. Run the new migration

## Development

### File Structure

```
packages/database/
├── src/
│   ├── entities/              # Production entities
│   ├── entities-example/      # Example/development entities
│   ├── enums/                 # Shared enumerations
│   ├── config/                # Configuration files
│   │   └── typeorm.config.ts  # TypeORM DataSource configuration
│   └── index.ts               # Package exports
├── migrations/                # Migration files (generated)
├── scripts/                   # Helper scripts for migrations
│   ├── migration-create.sh    # Create empty migration
│   └── migration-generate.sh  # Generate from entity changes
├── dist/                      # Compiled output (gitignored)
├── Dockerfile                 # Init container for running migrations
├── package.json
├── tsconfig.json
└── README.md (this file)
```

### Adding a New Entity

1. Create the entity file in `src/entities/`
2. Use TypeORM decorators (`@Entity`, `@Column`, etc.)
3. Export from `src/entities/index.ts`:
   ```typescript
   export * from './your-entity.entity';
   ```
4. Add to DataSource in `src/config/typeorm.config.ts`:
   ```typescript
   entities: [Job, MigrationStep, YourEntity],
   ```
5. Build and generate migration

## TypeScript Configuration

The package uses strict TypeScript settings with one exception:
- `strictPropertyInitialization: false` - Required for TypeORM decorators

This allows TypeORM to initialize entity properties without requiring explicit constructors.

## License

UNLICENSED
