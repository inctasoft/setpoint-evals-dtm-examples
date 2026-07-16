# Open Issues & Questions

> Live issue tracker. Only UNRESOLVED items belong here.
> Resolved items are deleted — git history serves as the changelog.

---

### Feature-flag 3-layer contract (docs) vs. live step-gating code is actually 2-layer, unguarded
**Severity:** Medium (architecture drift — flagship-documented capability doesn't match runtime)
**Status:** Open — decision needed, not fixed (found while building
`workflows/iot-sensor-pipeline/setpoint-evals/SE-07-feature-flag-layering`, which is anchored
`EXPECTED-FAIL` to keep the gap visible; see that SE's README for the full write-up)

`CLAUDE.md` § "Feature Flags" documents: `Layer 1 defaults < Layer 2 env var
(FEATURE_FLAG_{KEY}) < Layer 3 per-request (gated by ENABLE_REQUEST_FEATURE_FLAGS +
clientOverridable allowlist)`. `FeatureFlagService.resolveFlags()`
(`services/orchestrator/src/workflow-loader/feature-flag.service.ts`) correctly implements all
three layers and the gate — but a repo-wide grep for `resolveFlags`/`getFlag`/`getBooleanFlag`
shows it has **zero callers** outside its own file and DI registration. It is dead code.

The code that actually decides whether a step gets `SKIPPED` for a disabled flag is
`orchestration.service.ts`'s "1b. Feature gate" block (~line 690): it does its own inline
`resolvedFlags = { ...defaultFlags, ...jobFlags }` — Layer 1 and Layer 3 only. It never reads
`process.env.FEATURE_FLAG_*` (no Layer 2) and never checks `clientOverridable` or
`ENABLE_REQUEST_FEATURE_FLAGS` (no gate) — any flag can be overridden per-request today,
allowlisted or not.

Confirmed live: setting `FEATURE_FLAG_ENABLE_ALERT_GENERATION=false` on the orchestrator
container (verified present via `docker exec dtm-orchestrator env`) has no effect —
`EvaluateAlert`/`DispatchAlert` still run.

An earlier commit (89b1f9e, reverted in a later commit on the same branch) fixed a real but
separate bug in `FeatureFlagService.toScreamingSnake()` (mangled already-SCREAMING_SNAKE_CASE
keys), on the mistaken assumption that this dead function was the live gating path. It wasn't —
the fix was correct but changed no observable behavior, so it was reverted to avoid leaving a
misleading "this fixes Layer 2" narrative in the repo.

**Decision needed:** either wire `orchestration.service.ts` to call
`FeatureFlagService.resolveFlags()` (real feature work — implements the missing env-var layer
and the allowlist gate, touches the core step-gating path used by every workflow) or rewrite the
docs to describe the 2-layer, unguarded reality. Left open rather than fixed unilaterally: this
is a public example repo, the "correct" behavior isn't a one-liner, and the fix has blast radius
across all three workflows' step-gating.

---

### Orchestrator Unit Tests — 4 Suites / 22 Tests Failing (STALE — already resolved upstream)
**Severity:** Medium (test quality)
**Status:** Fixed (confirmed 2026-07-16, resolved by an earlier unrelated PR that never updated this entry)
Previously logged: `acknowledgement.handler.spec.ts` / `orchestration.service.spec.ts` /
`delegation.service.spec.ts` / `callback.service.spec.ts` behavioral assertions out of sync with
post-engine-generalization behavior (17 PASS, 4 FAIL, 251/301). Re-verified on `master` @ #19
(2026-07-16): `pnpm test` → **21/21 suites PASS, 272 passed + 28 skipped = 300/300, 0 FAIL**. The
fix landed silently in one of the intervening merged PRs (#16 se-tooling-v2 / #17 story-seeds / #18
schema-single-source) without this entry being deleted per this file's own "resolved items are
deleted" rule. Deleting now — see git history (PRs #16–#18) for the actual behavioral-assertion
changes if reconstructing what fixed it.

### system-architecture.md describes steps that do not exist (stale ETL-era section)
**Severity:** Low
**Status:** Fixed (2026-07-15)
`docs/guides/system-architecture.md` Section 7.1 ("Extended Multi-Cascade Example", including "Data Flow Between Steps" / "How Dependency Outputs Are Injected") used a 'SubmitBenefits' example depending on 'SubmitProduct'/'SubmitCustomer' with targetCustomerId/targetProductId fields and Extract/Transform ETL terminology — none of which exist in the real order-processing workflow.config.ts (Product is validate-only, no submit step). Rewrote the section against the real `default`-variant DAG (all 13 steps, fan-out LineItem cascade, parallel Payment/Shipment, fan-in ArchiveProcessedOrder) with real code references (`submit-order.ts`, `archive-processed-order.ts`, `collectDependencyOutputs()`, `LambdaStepPayload`). Also swept and fixed the same class of drift in Sections 3, 5, 6, 6.1, and 7 (nonexistent `sqsQueueName`/`lambdaFunctionName`/`ORDER_PROCESSING_STEPS` fields and export, `SubmitProduct` references, `forename`/`surname` field names, wrong Kafka topic names, stale FK-injection examples, duplicate `ValidateOrder`/`SubmitOrder` mermaid node labels, stale "6 steps" counts). See PR against `fix/system-architecture-real-dag`.

### THE runner (setpoint-evals/run-all.sh) never dropped a self-gitignore into .results/
**Severity:** Low
**Status:** Fixed (2026-07-16)
The vendored-but-unused `scripts/se-run-suite.sh` (SE Conventions v2 shared runner) already
self-gitignores its results dir (`printf '*\n' > "$SUITE/.results/.gitignore"`), but **no suite
in this repo actually delegates to it** — every `run-all.sh` (core + all 3 workflow suites) goes
through the real, hand-written `setpoint-evals/run-all.sh`, whose `RESULTS_DIR` setup
(`mkdir -p "$RESULTS_DIR"`) never wrote a `.gitignore` at all. A fresh suite's `.results/` dir (or
one whose `.gitignore` was never committed) would surface every future run's logs/`results.json`
as untracked-and-dirty. Fixed by writing `*\n` into `<suite>/.results/.gitignore` **only if
absent** (`[ -f ... ] || printf ...`) right after `mkdir -p "$RESULTS_DIR"` — the "only if absent"
guard is deliberate: the already-committed `.results/.gitignore` files (core + all 3 workflows,
added by PR #17) carry a richer hand-authored form (`# comment` + `*` + `!.gitignore`); writing
unconditionally on every run would silently clobber that back down to the bare form on every SE
run, a self-inflicted predicate-drift/dirty-tree trap.

### tools/sqs-poller tsconfig.json missing @dtm/worker-sdk path mapping
**Severity:** Low
**Status:** Fixed (2026-07-16)
`tools/sqs-poller/package.json` declares `@dtm/worker-sdk` as an `optionalDependency` (alongside
the `@dtm-workflows/*` packages, which DO have path mappings), but `tsconfig.json`'s `paths` never
mapped it — a latent tsconfig↔package.json drift. `pnpm run build:tools` was already green (no
`tools/sqs-poller/src/*.ts` file imports `@dtm/worker-sdk` directly today — only the Docker
simulator build stage references it, per `tools/sqs-poller/Dockerfile.simulator`), so this was
not an active build break, but the missing mapping meant a same-project source file importing
`@dtm/worker-sdk` would resolve inconsistently vs. every other workspace package. Added
`"@dtm/worker-sdk": ["packages/worker-sdk/src/index.ts"]` and the `/*` wildcard variant, mirroring
the existing `@dtm/core` entries. `pnpm run build:tools` verified green before and after.

### Dockerfile.db-init bakes .env at build time — stale image ignores current .env
**Severity:** Medium
**Status:** Fixed (2026-07-16)
`services/orchestrator/Dockerfile.db-init` did `COPY .env ./.env` at **build time**. The
`"migrate"` script (`services/orchestrator/package.json`) runs
`env $(cat ../../.env | grep -v '^#' ...) npm run migration:run` — it re-reads the `.env` **file**
directly off disk inside the container at run time, rather than trusting `docker-compose.yml`'s
`env_file: - .env` (which only seeds the container's initial process env, not this file). Net
effect: editing the host's `.env` and re-running `docker compose up` (without `--build` /
`--force-recreate` of `init-typeorm`) silently ran migrations against the **stale baked-in .env**
from whenever the image was last built — most dangerous for `DTM_DB_*` vars, where a moved DB host
would migrate the wrong (or previous) database with zero error. Fixed by dropping the `COPY .env
./.env` from the Dockerfile and mounting it at **runtime** instead
(`docker-compose.yml` `init-typeorm.volumes: - ./.env:/app/.env:ro`), so a stale image always reads
the current host `.env`. Proven: built the image once with `DTM_DB_HOST=A` baked in (pre-fix
behavior), changed `.env` to `DTM_DB_HOST=B` with no rebuild, re-ran the container — post-fix it
picks up `B` (see PR evidence).
