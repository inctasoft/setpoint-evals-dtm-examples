# SE-14: schema single source

**Category**: schema · **Isolation**: destructive · **Duration**: ~10s · **Timeout**: 120s

**MUST RUN SEQUENTIALLY** — this SE drops and rebuilds the ENTIRE `dtm` schema
(`scripts/init-clean-database.sh`), destroying any in-flight job/step rows every
other SE or a running orchestrator depends on. It must never run concurrently
with any other SE.

## Scenario
```gherkin
Feature: Migrations are the single schema source of truth (Phase 2a, D1)
  Scenario: bootstrap path and fresh migrate produce identical schemas
    Given a running dtm-db Postgres instance
    When "dtm" is rebuilt via the real bootstrap path (scripts/init-clean-database.sh)
    And an independent empty database is built via a bare `migration:run`
    Then their information_schema (tables, columns, indexes, non-CHECK constraints, enums) are byte-identical
    And no hand-written CREATE TABLE SQL exists anywhere in the bootstrap path
```

## Architecture
```mermaid
sequenceDiagram
    participant T as test.sh
    participant Boot as init-clean-database.sh
    participant M as migration:run (orchestrator dataSource)
    participant DB as dtm-db (Postgres)

    T->>Boot: bash scripts/init-clean-database.sh
    Boot->>DB: DROP SCHEMA public CASCADE, CREATE SCHEMA public
    Boot->>M: migration:run  (against "dtm")
    M->>DB: apply InitialSchema<ts> migration
    T->>DB: dump information_schema("dtm")  -> bootstrap.schema

    T->>DB: CREATE DATABASE dtm_se14_verify
    T->>M: migration:run  (against "dtm_se14_verify", independent invocation)
    M->>DB: apply InitialSchema<ts> migration
    T->>DB: dump information_schema("dtm_se14_verify")  -> migrate.schema

    T->>T: diff bootstrap.schema migrate.schema
    Note over T: diff must be EMPTY — same migration, two paths, one truth
    T->>DB: DROP DATABASE dtm_se14_verify (cleanup)
```

## Artifacts

### Input / payload
The SE runs the literal production entry points, no synthetic payload:
```bash
bash "$ROOT/scripts/init-clean-database.sh"                 # Path A: real bootstrap
# ...
npx typeorm-ts-node-commonjs migration:run -d dataSource.ts # Path B: fresh migrate (against dtm_se14_verify)
```

The comparison query (run against both databases via `psql -tA`):
```sql
SELECT 'TABLE|' || table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name <> 'migrations'
UNION ALL
SELECT 'COLUMN|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable
  || '|' || COALESCE(column_default,'') || '|' || COALESCE(character_maximum_length::text,'')
FROM information_schema.columns
WHERE table_schema='public' AND table_name <> 'migrations'
UNION ALL
SELECT 'INDEX|' || indexname || '|' || tablename || '|' || indexdef
FROM pg_indexes WHERE schemaname='public' AND tablename <> 'migrations'
UNION ALL
SELECT 'CONSTRAINT|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema='public' AND tc.table_name <> 'migrations' AND tc.constraint_type <> 'CHECK'
UNION ALL
SELECT 'ENUM|' || t.typname || '|' || e.enumlabel
FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY 1;
```
(`CHECK` constraints are excluded — Postgres auto-names unnamed NOT NULL checks from
internal `(schema_oid, table_oid, attnum)` numbers, which differ across any two
independently-created databases even from the byte-identical migration. NOT NULL-ness
is already covered deterministically via `information_schema.columns.is_nullable`.)

### Expected output (GREEN)
```
✓ bootstrap path (init-clean-database.sh) ran cleanly
✓ fresh migration:run against empty DB ran cleanly
✓ bootstrap-path schema dump is non-empty (sanity)
✓ fresh-migrate schema dump is non-empty (sanity)
✓ information_schema diff (bootstrap vs fresh migrate) is EMPTY
── assertions: 5 pass, 0 fail
```

### Negative-control proof (RED) — this SE can fail
Manually planted drift: added one extra line to `scripts/init-clean-database.sh`
right after `migration:run` — `ALTER TABLE dtm_jobs ADD COLUMN se14_drift_test
varchar(10);` — simulating the exact regression this SE exists to prevent
(hand-written SQL creeping back into the bootstrap path). Ran this SE unmodified
against that planted drift:
```
✓ bootstrap path (init-clean-database.sh) ran cleanly
✓ fresh migration:run against empty DB ran cleanly
✓ bootstrap-path schema dump is non-empty (sanity)
✓ fresh-migrate schema dump is non-empty (sanity)
✗ information_schema diff (bootstrap vs fresh migrate) is EMPTY  (cmd: test ! -s /tmp/tmp.NTaGDo4dME/schema.diff)
── schema drift detected ──────────────────────────────────────
--- /tmp/tmp.NTaGDo4dME/bootstrap.schema
+++ /tmp/tmp.NTaGDo4dME/migrate.schema
@@ -5,7 +5,6 @@
 COLUMN|dtm_jobs|payload|jsonb|NO||
 COLUMN|dtm_jobs|results|jsonb|YES||
 COLUMN|dtm_jobs|retry_count|integer|NO|0|
-COLUMN|dtm_jobs|se14_drift_test|character varying|YES||10
 COLUMN|dtm_jobs|started_at|timestamp without time zone|YES||
 COLUMN|dtm_jobs|status|USER-DEFINED|NO|'pending'::job_status_enum|
 COLUMN|dtm_jobs|submitted_at|timestamp without time zone|NO|CURRENT_TIMESTAMP|
────────────────────────────────────────────────────────────────
── assertions: 4 pass, 1 fail
```
Exit code: `1`. The drift line was removed immediately after capturing this
transcript and the SE was re-run to confirm GREEN again (5 pass, 0 fail) before
committing — `scripts/init-clean-database.sh` in this PR carries no such line.

## Assertions
<!-- one checkbox per ck call in test.sh — keep 1:1 -->
- [ ] bootstrap path (`scripts/init-clean-database.sh`) exits 0
- [ ] fresh `migration:run` against an independent empty database exits 0
- [ ] bootstrap-path information_schema dump is non-empty (sanity — didn't silently no-op)
- [ ] fresh-migrate information_schema dump is non-empty (sanity — didn't silently no-op)
- [ ] information_schema diff between the two paths is EMPTY (tables/columns/indexes/enums/FKs identical)

## Run
```bash
bash setpoint-evals/run-all.sh --se 14
```

Guards Phase 2a / decision D1 ("TypeORM migrations are the single schema
source of truth"): the moment anyone re-adds a parallel hand-written
`CREATE TABLE`/`ALTER TABLE` shortcut to the bootstrap path — the exact
mistake this repo used to make in `scripts/init-clean-database.sh` before
this PR — the two paths diverge and this SE goes red in CI, instead of the
drift being discovered later as a confusing runtime column-mismatch.
