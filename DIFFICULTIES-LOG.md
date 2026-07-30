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
### .results/ dirs are not self-gitignoring
**Severity:** Low
**Status:** Open
The v2 SE convention says `.results/` is self-gitignoring (runner drops a `.gitignore` inside), but runs leave untracked `setpoint-evals/.results/` + per-workflow `.results/` noise (observed during PR #16 acceptance). Make the vendored runner create `.results/.gitignore` (`*`) on first write, or add the four paths to the repo .gitignore. Fold into the Phase 3 SE-estate PR.

### tools/sqs-poller tsc build red on master (missing @dtm/worker-sdk path mappings)
**Severity:** Medium
**Status:** Open
`pnpm run build:tools` fails on master: tools/sqs-poller tsconfig lacks path mappings for @dtm/worker-sdk (package added to the workspace after the poller's tsconfig was written). Runtime is unaffected (poller runs via tsx; lambda bundling resolves through pnpm links post-install), so the stack and all 28 SEs stay green — but the advertised build command is broken. Found during PR #16 verification (out of scope there). Fix: add the three path mappings mirroring the existing @dtm-workflows/* entries; candidate for the Phase 3 estate PR or a standalone quick fix.

### Dockerfile.db-init bakes .env at build time — stale image silently runs outdated migrations
**Severity:** Medium
**Status:** Open
`services/orchestrator/Dockerfile.db-init` (and likely the main Dockerfile) does `COPY .env ./.env` at build time. A cached dtm-init-typeorm image (a) auth-fails with Postgres 28P01 against a fresh DB if .env changed since build, and (b) silently applies an OUTDATED migration set while exiting 0 if migration source changed since the last build. CI always builds fresh; LOCAL runs after any .env/migration change need `--build` (bit the schema-fin lane on first stack start, PR #18). Proper fix: mount .env at runtime instead of baking, or make the init container always rebuild. Candidate for Phase 3 estate PR or standalone fix.

### local-env.sh workspace-build-check never fires (templating bug)
**Severity:** Low
**Status:** Open
scripts/local-env.sh ~lines 201-216: the auto-build-on-start check renders $d/$NEEDS_BUILD as empty strings, so the "workspace needs build" detection silently never fires — fresh clones/worktrees hit stale-dist crashloops the check was meant to prevent (dev-ack-simulator bind-mounts dist/). Found during the T2 ack-race lane (PR #25), deliberately out of scope there.

### stuck-in-progress.task auto-fail has the LEADER-2-class bare-id UPDATE race
**Severity:** Medium
**Status:** Fixed (Phase 4a, feat/eval-scenarios-screen)
services/orchestrator/src/maintenance/tasks/stuck-in-progress.task.ts (autoFailEnabled branch): bare id-keyed update — a step completing between the task's SELECT and UPDATE gets clobbered back to FAILED, the exact race LEADER-2 fixed in stuck-acknowledgement.task (PR #27). Fix = conditional UPDATE (`WHERE id=? AND status=?`, pinned on the *observed* status — `IN_PROGRESS` or `IN_PROGRESS_RETRYING`, whichever the SELECT actually read — not a hardcoded `'in_progress'`) + a regression test pinning the WHERE criteria (mirrors PR #27's LEADER-2 test in `stuck-acknowledgement.task.spec.ts`). On `affected === 0` the task now skips `continueJob` and logs an alert action instead of double-triggering orchestration for a step a real callback already moved forward. New tests: `stuck-in-progress.task.spec.ts` → "LEADER-2-style conditional UPDATE guards a racing callback (auto-fail path)" (2 cases: normal auto-fail + the race-loses case, both RED against the old bare-id `update(step.id, {...})` and GREEN after the fix). Flagged by the PR #27 lane, deliberately out of its scope. Assigned to the Phase 4a backend lane.

### setpoint-evals-playwright demo-videos fixture has no headless auth path (monitor SuperTokens gate)
**Severity:** Medium
**Status:** Open
`setpoint-evals-playwright/src/fixtures/dashboard.fixture.ts` (`demo-videos` project) does `chromium.launch()` — a fresh, cookie-less browser context — then `page.goto(dashboardUrl)` and waits for `.header`. In a real run this hits `apps/monitor`'s SuperTokens gate (`app.tsx`'s `Session.doesSessionExist()`), which redirects a session-less browser to `/auth` before `.header` ever renders — the fixture's `waitForSelector('.header', { timeout: 10_000 })` would time out. The backend's `DISABLE_AUTH=true` does NOT reach this: it only bypasses `auth.guard.ts` (the API), not the frontend's own independent SuperTokens check. No interactive Google OAuth path exists for an automated/headless run (registered redirect URIs are pinned to known dev ports; an ad-hoc port fails with "Something went wrong" — confirmed live during the Phase 4a evals-module lane, 2026-07-16). Found while building the Scenarios-screen UI coverage (Phase 4a), which needed the SAME headless-monitor-auth problem solved and added a dedicated frontend bypass (`VITE_DISABLE_AUTH`, `apps/monitor/src/app.tsx`) plus its own hermetic fixture (`scenarios-dashboard.fixture.ts`, boots a throwaway `VITE_DISABLE_AUTH=true` dev server per test) rather than reusing/fixing `dashboard.fixture.ts` — out of scope there. Fix: point `dashboard.fixture.ts` at a `VITE_DISABLE_AUTH=true` dev server the same way, or extend `scenarios-dashboard.fixture.ts` to serve both use cases.

### SE-19-evals-run-api-disabled-403 unreliable under back-to-back `--force-recreate` (env-flip settle bug, cause NOT confirmed)
**Severity:** Medium
**Status:** Open — investigated at length, root cause NOT confirmed; do not re-attempt without new evidence
`setpoint-evals/SE-19-evals-run-api-disabled-403/test.sh` flips `ENABLE_EVAL_RUN_API` in `.env` TWICE per run (off, then back on), each via `docker compose ... up -d --no-deps --force-recreate orchestrator` + poll `/health`. Found FAILING (both standalone and inside `run-all.sh --all-workflows`) during the Phase 4b (feat/multiworkflow-dashboard) verification pass, 2026-07-16 — the specific assertion that fails is NOT stable: one run failed the "flag off → 403" leg (got 201), a later run failed the "flag restored → 201" leg instead (got 403, stuck on the OFF value). Extensive isolated debugging (`docker exec printenv` right after each recreate, `docker compose config` to check resolved substitution, a manual step-by-step replica outside the script, a rewritten health-wait requiring 2 consecutive successes, and finally rewriting the assertion itself as a poll-until-the-expected-code loop with a 10s budget) **all failed to make it reliable** — the poll-the-real-endpoint version still saw the SECOND recreate's env not "stick" for the full 10s budget, ruling out a few seconds' settle race as the sole cause. What's confirmed: (a) `.env` is correctly written and `docker compose config` correctly resolves the intended value each time; (b) the orchestrator's `command:` is `nest start --watch` (TypeScript watch-compile boot, ~15-30s cold-start after `--force-recreate`, not a prebuilt `node dist/main.js`); (c) the asymmetry (first recreate-in-a-run reliable, second one unreliable) held across multiple repro attempts, suggesting something about TWO `--force-recreate` calls close together on the SAME `container_name` — not a single recreate's settle time — but the exact mechanism (Docker-level async container teardown, a `docker compose` internal cache, host contention from concurrent agent sessions sharing this same `dtm-*` stack, or something else) was NOT pinned down. Entirely within Phase 4a's evals module test estate (`setpoint-evals/SE-19-*`, exercising `services/orchestrator/src/evals/*`) — this Phase 4b PR touches none of those files. SE-07-feature-flag-layering (a DIFFERENT workflow SE using the same env-flip+single-recreate-per-transition pattern, but not two recreates back-to-back inside one script the way SE-19 does) passes reliably in the same run. All other 41 core+workflow SEs — including the 4 new Phase 4b ones, SE-20..23 — pass clean in the same `run-all.sh --all-workflows` execution this was found in. `.env`/`ENABLE_EVAL_RUN_API` and the orchestrator container were left in the correct `true`/201 state after this investigation (verified). Next step for whoever picks this up: instrument `EvalsRunService`/`evals.config.ts` with a boot-time log of the resolved `enableRunApi` value and correlate against `docker inspect`'s container start timestamp, across several BACK-TO-BACK `--force-recreate` cycles in isolation (no other SEs/agents running) — the isolated-vs-in-script asymmetry observed here means the bug needs to be chased with the EXACT two-recreates-per-script shape, not a single recreate.

### SE-01/SE-04 (core, Phase-1 parallel-safe) intermittently fail under host CPU contention — fixed-budget timing, not an engine bug
**Severity:** Low (test-environment artifact, not a functional defect)
**Status:** Open — documented, no code fix needed; re-run standalone to confirm before treating as a regression
Observed during the 4c-fix2 newcomer-path verification (2026-07-17, run 2 of 2): `SE-01-retry-transient-failure` failed one retry short of the expected count (`ValidateCustomer retry_count = 2`, expected 3), and `SE-04-ack-delays` timed out its 45s ACK poll with steps still `pending`/`in_progress`. Both are Phase-1 "parallel-safe" core SEs, run concurrently (default `--max-parallel=6`) alongside several siblings sharing the same LocalStack Lambda emulator. At the time, the host had 93 containers running total (load average 4.34, ~37 other concurrent Claude/build processes from unrelated projects), with `dtm-localstack` alone at 35% CPU in a snapshot. Re-ran both standalone (`--se 01 --se 04 --se 19 --in-band`, no sibling contention) immediately after on the same still-up stack: SE-01 and SE-04 both PASS clean. SE-19 failed again even in isolation — that one is the separate, already-documented settle-race bug above, not contention. Conclusion: SE-01/SE-04 are fixed-wall-clock-budget SEs (45s poll, exact-retry-count timing) that can miss their window under heavy host CPU contention from LocalStack's Lambda emulation competing with unrelated concurrent workloads — not a DTM engine defect. No fix applied; if this recurs reliably on a quiet host (not just under observed multi-tenant contention), escalate to a real investigation.

---

### Monitor SPA bounces to SuperTokens /auth even with backend DISABLE_AUTH=true
**Severity:** Low
**Status:** Open
Frontend auth gating is a SEPARATE flag: the vite dev server must be started with `VITE_DISABLE_AUTH=true` (build-time env, read by `apps/monitor/src/app.tsx`) or the SPA redirects to the SuperTokens sign-in regardless of the orchestrator's `DISABLE_AUTH=true`. `.env` carries `VITE_DISABLE_AUTH=false` and vite does NOT read it from the repo root automatically — pass it inline: `cd apps/monitor && VITE_DISABLE_AUTH=true npx vite --config vite-dev.config.ts`. Bit the Phase-4c scraper cert 2026-07-17 (curl 200 on the shell masked the SPA-level bounce). Fix idea: dev-mode banner in the /auth screen hinting at the flag, or have vite-dev.config.ts load the root .env.

---

### SqsStatusService bypasses QueueTransport — latent DI coupling under any non-SQS profile
**Severity:** Medium
**Status:** Fixed (2026-07-22, PR fix/phase0-transport-di-honesty)
`SqsStatusService` (websocket SQS panel feed) injected `SqsService` directly instead of going through the `QueueTransport` abstraction. **Precise shape (verified by execution):** it does NOT fail DI boot *today* — `app.module.ts` imports `AwsModule` unconditionally, so `SqsService` is always resolvable and the app boots green. The break is *latent coupling*: it only surfaces in the AWS-free DI graph a non-SQS profile (cloud-tasks / zmq) produces once `AwsModule` is dropped — which is the entire point of the bus-agnosticism work. Found during the 2026-07-22 bus-agnosticism seam analysis.
**Fix:** introduced `TaskTransportCapabilities { stats: 'native' | 'none' }` on `QueueTransport`; the panel feed now goes through a capability-gated `QueueTransport.getQueueStatuses()` (SQS returns live rows; a stats-less transport declares `stats: 'none'` and returns `[]` instead of fabricated zeros). `SqsStatusService` injects `QueueTransport` (not `SqsService`); `WebSocketModule` imports `TransportModule` (not `AwsModule`). Removed the dead `sendBulkTasks` and the now-redundant abstract `getQueueStats` from the interface (zero production callers — `DelegationService` uses only `sendTask`/`getWorkerEndpointUrl`). RED-first proof + capability rendering in `services/orchestrator/src/transport/transport-capabilities.spec.ts` (the AWS-free-graph compile was RED pre-fix). Confound noted: a full-app boot under `QUEUE_TRANSPORT=cloud-tasks` also fails on the un-installed `@google-cloud/tasks` dep (separate branch `fix/cloud-tasks-missing-dep`), unrelated to this DI issue — the SE isolates SqsStatusService resolution via a TestingModule rather than a full boot.

---

### zmq-transport.service.spec leaves one zeromq handle open — jest "force exited" warning (benign)
**Severity:** Low (test-teardown cosmetics, not a functional defect)
**Status:** Open — documented, no fix applied
The Phase 2 zmq specs run a REAL in-process zeromq ROUTER/DEALER pair per test (bind `tcp://127.0.0.1:*`, wildcard port). All 6 tests pass and every socket is closed in `afterEach` (`transport.onModuleDestroy()` → `router.close()` + dealers closed), yet jest reports exactly one open `Router` handle per worker process ("A worker process has failed to exit gracefully... force exited") — `--testPathIgnorePatterns=zmq-transport` confirms the warning appears only with this spec. Attempted: explicit dealer-iterator cleanup — rejected, zeromq.js's socket async iterator exposes no `.return()`. Root cause not pinned (likely a zeromq.js internal context/GC cadence outliving the last closed socket by a few ms). Impact: none on correctness — the run is green; the warning costs a forced worker exit. If it ever masks a REAL leak, re-run with `--detectOpenHandles` (already verified: the only handle traces to `new Router` in the spec's `beforeEach`).

---

### gh-pr-merge.sh worktree removal dangles the running stack's bind mounts (+ monitor vite zombie)
**Severity:** Medium
**Status:** Open (2026-07-29)
The merge script removes the PR's worktree on success. If the dtm stack was started from that worktree, the orchestrator's bind-mounted `src`/package dists now point at deleted inodes — the container keeps "running" until its next watch-reload, then goes unhealthy (25 tsc errors against ghost paths), and the monitor's vite process survives as a zombie holding its port and serving 404s from the deleted tree. Hit at every one of 5 phase boundaries during the bus-agnosticism lane. Procedure (works every time): from the MAIN checkout (or the next phase's worktree) — `pnpm install && pnpm run build:packages && pnpm run build:workflows && (cd tools/dev-ack-simulator && pnpm build)`, then `local-env.sh stop && local-env.sh start --standalone --orchestrator && local-env.sh deploy-workers`; kill the zombie vite by port (`ss -tlnp | grep 5183`, check `/proc/<pid>/cwd` shows `(deleted)`) before restarting the monitor. Automating the relocation into the merge script is possible but the script is repo-agnostic — unresolved.
