# Open Issues & Questions

> Live issue tracker. Only UNRESOLVED items belong here.
> Resolved items are deleted — git history serves as the changelog.

---

### Parallel-delegated Apply* steps intermittently get ack_metadata=NULL (infra-provisioning, ~50% repro)
**Severity:** Medium (real, reproducible engine bug — not a test artifact)
**Status:** Fixed (2026-07-16, RC5 — see `docs/guides/race-condition-prevention.md`)

Running `infra-provisioning/setpoint-evals/run-all.sh --se 07` repeatedly against the SAME
freshly-built stack was non-deterministic: PASS, FAIL, PASS, FAIL across 4 consecutive runs
(~50%). Not a timing artifact in the SE's own verification query — on a failing run the job still
reached `COMPLETED` with `stepsFailed: 0`, but `ApplyDNS`/`ApplyStorage`/`ApplyLoadBalancer` (the
3 steps `OrchestrationService` delegates in parallel right after `ApplyNetwork`+`ApplyCompute`
complete) ended up with `ack_metadata: NULL` — and, traced via correlated container logs this
time, `kafka_published_at: NULL` too: **their own ACK payload was never published to Kafka at
all**, not merely lost/overwritten after landing.

**Root cause** (statistically confirmed: 15-run loop reproduced ~50% FAIL, correlated
`dtm-orchestrator` + `dtm-dev-ack-simulator` logs by timestamp for the first failure): each
sibling's own Lambda-completion callback checks `areCascadeDependenciesMet()` at the instant it
fires — a legitimate, expected race against its parents' (`network`, fan-out `compute`) ACKs
still landing. Losing that race is correct-by-design (`callback.service.ts` logs `"requires
acknowledgement but parent cascade dependencies not yet met. Deferring publish."` and defers).
The bug is that the recovery hook meant to retry deferred publishes once the last parent ACK
lands — `AcknowledgementHandler` → `CascadePublishService.checkAndExecutePendingPublishSteps()`,
gated by `hasDependentCascades(cascadeName)` — **never fired, in any run, pass or fail** (proven
by grepping orchestrator logs for `"🔗 Checking for cascade publishing after"`, which never
appeared even once across 15 runs). `hasDependentCascades()` defaults its optional `wfConfig` arg
to the DI-injected `WorkflowConfigService` singleton, which is bound at bootstrap to the
first-registered workflow (`order-processing`) — `AcknowledgementHandler` already resolves the
CORRECT per-topic `WorkflowConfigService` via `WorkflowRegistryService.getByAckTopic()` but never
passed it through. `order-processing`'s cascade config has no `network`/`compute`/`dns`/etc.
cascades, so the gate silently always returned `false` for every `infra-provisioning` (and
`iot-sensor-pipeline`) job — permanently disabling the retry for 2 of the 3 shipped workflows.
Same anti-pattern as the same-day feature-flag-layering fix (T1): a DI singleton correct only for
the default workflow.

**Fix**: `services/orchestrator/src/kafka/handlers/acknowledgement.handler.ts` — thread
`resolved.config` (already computed, previously discarded) through `processAcknowledgement()` and
into `hasDependentCascades(cascadeName, wfConfig)`. Full narrative + before/after diagrams: RC5 in
`docs/guides/race-condition-prevention.md`. Regression test in
`acknowledgement.handler.spec.ts` (reproduces red against the pre-fix code). Statistical
verification: `SE-07-cascade-fk-every-hop` un-quarantined (`se_skip` removed), 10/10 consecutive
PASS on the fixed build; the previously-dead cascade-publishing log lines now fire on every run.

---

### Feature-flag 3-layer contract (docs) vs. live step-gating code is actually 2-layer, unguarded
**Severity:** Medium (architecture drift — flagship-documented capability doesn't match runtime)
**Status:** Fixed (2026-07-16)

`CLAUDE.md` § "Feature Flags" documents: `Layer 1 defaults < Layer 2 env var
(FEATURE_FLAG_{KEY}) < Layer 3 per-request (gated by ENABLE_REQUEST_FEATURE_FLAGS +
clientOverridable allowlist)`. `FeatureFlagService.resolveFlags()`
(`services/orchestrator/src/workflow-loader/feature-flag.service.ts`) correctly implemented all
three layers and the gate — but had **zero callers** outside its own file and DI registration; it
was dead code. The code that actually decided whether a step got `SKIPPED` for a disabled flag was
`orchestration.service.ts`'s "1b. Feature gate" block: its own inline
`resolvedFlags = { ...defaultFlags, ...jobFlags }` (Layer 1 + Layer 3 only, no env var, no
allowlist gate).

Fixed by wiring `orchestration.service.ts` to call `FeatureFlagService.resolveFlags(wfDef,
jobFlags)` instead of duplicating the merge — the service is now the single source of the 3-layer
contract. Refactored the service to be **stateless** (`resolveFlags(workflow, requestFlags)`
instead of DI-injecting one `WORKFLOW_DEFINITION`): the orchestrator registers multiple workflows
via `WorkflowRegistryService`, each with its own `featureFlags` config, so a DI-bound singleton
would only ever have been correct for the default workflow (order-processing) and silently wrong
for iot-sensor-pipeline / infra-provisioning.

Two more findings surfaced and fixed in the same pass:
1. `toScreamingSnake()`'s SCREAMING_SNAKE_CASE-key bug (previously found and fixed in 89b1f9e, then
   reverted since the dead service made the fix a no-op) — re-applied with an idempotency guard.
   All three shipped workflows' `featureFlags.defaults` keys are already SCREAMING_SNAKE_CASE, so
   without the guard the env-var layer would have been a silent no-op for every workflow, not just
   the one originally suspected.
2. `ENABLE_REQUEST_FEATURE_FLAGS=true` was missing from `.env.example` despite already being
   documented in `CLAUDE.md` as the dev default — would have silently closed the Layer 3 gate for
   every SE relying on per-request overrides (e.g. iot-sensor-pipeline SE-04) the moment the real
   gate went live. Added to `.env.example` and `config.validation.ts`.

Verification: `iot-sensor-pipeline/setpoint-evals/SE-07-feature-flag-layering` (previously anchored
`EXPECTED-FAIL` for exactly this gap) now passes all layers for real, plus a new GATE sub-test
(non-allowlisted per-request flag has no effect, asserted via the orchestrator's rejection log —
restored/made-real version of the sub-test PR #23 had dropped as vacuous). Unit tests in
`feature-flag.service.spec.ts` cover layer precedence and allowlist enforcement directly.
`pnpm test`: 22/22 suites green. See PR against `fix/feature-flag-layering`.

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
