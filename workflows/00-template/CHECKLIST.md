# New Workflow Checklist

Follow these steps to create a new DTM workflow. See `CLAUDE.md` → "Adding a New Workflow" for full details.

## 1. Workflow Definition

- [ ] Copy this template: `cp -r workflows/00-template workflows/my-workflow`
- [ ] Edit `package.json` — set name to `@dtm-workflows/my-workflow`
- [ ] Edit `workflow.config.ts` — define steps, dependencies, DAG, cascades
- [ ] Edit `workflow.config.ts` — define entity criticality and outcome rules
- [ ] Export workflow config as a named variable (e.g., `export const myWorkflow: WorkflowDefinition = { ... }`)

## 2. Workers

- [ ] Implement handlers in `workers/src/handlers/` — one per step
- [ ] Each handler must use `getMyTestOptions()` from `@dtm/worker-sdk`
- [ ] Each handler must always callback (success OR failure) — never silently drop
- [ ] Export `handlerMap: Record<string, handler>` from `workers/src/index.ts`
- [ ] Update `workers/package.json` — set name to `@dtm-workflows/my-workflow-workers`
- [ ] Update `workers/esbuild.config.js` — list all handler entry points

## 3. Source Database

- [ ] Define TypeORM entities in `source-db/src/entities/` (use `dbo` schema)
- [ ] Create barrel exports in `source-db/src/entities/index.ts` and `source-db/src/index.ts`
- [ ] Create datasource config in `source-db/src/config/datasource.ts`
- [ ] Create init SQL in `source-db/init-scripts/01-schema-and-seed.sql`
- [ ] Update `source-db/package.json` — set name to `@dtm-workflows/my-workflow-typeorm`

## 4. Docker Compose

- [ ] Create `docker-compose.my-workflow.yml` with PostgreSQL service
- [ ] **CRITICAL**: Include `networks: dtm: external: true` (or DB won't be reachable)
- [ ] Use container name: `dtm-my-workflow-source-db`
- [ ] Use unique host port (next available after 5451)

## 5. Dev Tools

- [ ] Create `dev-tools/ack-defaults.ts` with ACK payload generators per entity

## 6. SEs

- [ ] Create `setpoint-evals/shared/helpers.sh` — set `WORKFLOW_NAME`, override helpers
- [ ] Create `setpoint-evals/run-all.sh` — iterate all test directories
- [ ] Write `setpoint-evals/01-happy-path/test.sh` — full end-to-end test
- [ ] Write additional SEs for error cases, fan-out, etc.
- [ ] Make all scripts executable: `chmod +x setpoint-evals/**/*.sh`

## 7. Integration (REQUIRED — or workflow won't be discovered)

- [ ] `tools/sqs-poller/src/queue-discovery.ts` — import config, add to `WORKFLOW_CONFIGS`
- [ ] `tools/sqs-poller/src/handler-registry.ts` — import and spread `handlerMap`
- [ ] `tools/sqs-poller/package.json` — add 3 optionalDependencies
- [ ] `tools/sqs-poller/tsconfig.json` — add path mappings (config, workers, typeorm)
- [ ] `scripts/local-env.sh` — add compose var, update start/stop/clean/debug-server/URLs

## 8. Documentation

- [ ] Create `README.md` — domain model, step DAG, capabilities showcased
- [ ] Update `CLAUDE.md` — Registered Workflows table, Source DBs, Container Inventory, Workflow Directory, SEs
