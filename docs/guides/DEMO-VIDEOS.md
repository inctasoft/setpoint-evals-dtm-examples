# Demo Video Recordings

Three subtitled "story" recordings of the DTM Operations Dashboard (dtm-video-v2) —
each drives the monitor's own Scenarios screen the way an operator would: open an
eval, read its README as the contract (gherkin + a mermaid diagram **actually
scrolled into view**, not just present-in-the-DOM), a spotlighted click on **Run**,
follow the job live on the Dashboard, expand the **full-screen DAG** on camera,
**drill into a node's real activity** (retry timeline / fan-out list), scope the
**console** to that node, watch the terminal state land, then close on the
**Assertions checklist**. A top-anchored caption band narrates the business promise
each scenario keeps or breaks — never the mechanics (no queue/topic/enum jargon; the
UI itself already shows the status codes).

A fourth, unnarrated demo (`multi-job-demo.spec.ts`, all 3 workflows fired at once)
predates this rework and is untouched — it is not part of the story set below, and
note it still uses the pre-Phase-4b `.job-item` selector convention (job-list.tsx
was rewritten to a `<table class="job-table">`/`tr.job-row` in Phase 4b — the story
demos never hit this because they deep-link via the Scenarios "Run" result, not by
clicking a job-list row; `multi-job-demo.spec.ts`'s own `waitForJobInUI`/
`selectJobInUI` helper calls are consequently stale selectors — a pre-existing bug,
out of this rework's scope since that demo isn't one of the three story videos).

## v2 rework (dtm-video-v2 Lane C) — what changed and why

The v1 recordings (see `git log` for the Phase 5 originals) had five structural
failures documented in `server-config/plans/dtm-video-v2/ux-storyboards.md` §1:
the contract diagram was never actually on screen (an off-viewport SVG passed
`toBeVisible()`), the Run click was an invisible programmatic click, the DAG was a
~250px illegible strip, captions froze for 40-56s over a progress bar during the
real retry/cascade wait, and every video opened on a leftover job from a prior
recording. Lane A (backend: activity/history endpoints, status-vocabulary
collapse) and Lane B (monitor UI: full-screen DAG, node drill-down, console
pairing, skipped/partial rendering, `?demo=1`) fixed the underlying product
surface; this rework (Lane C) rebuilds the three demo specs to actually use it,
plus the recording/tooling changes below.

- **`spotlightClick(page, selector)`** (`src/demos/helpers.ts`) — a fake cursor dot
  glides to the target, hover-glows for ~1.5s, ripples on click. Every on-camera
  click (Run, the DAG's `⛶ Expand`, a node) uses it — replaces v1's invisible
  `.locator(sel).click()`.
- **Beat-synced captions — `captionBeat(page, text, { label, mark, waitFor, minMs,
  maxMs })`** replaces the fixed-`holdMs` `caption()` for every beat that has a real
  UI condition to key off (a node turning `.dagActive`, a drill-down panel opening,
  the terminal status landing). It shows the caption, holds a minimum dwell so a
  viewer can start reading, then races the real condition against a hard ceiling —
  never hangs a take on a selector that doesn't show up. `caption()` still exists
  for pure narration beats with no UI condition (e.g. the opening line).
- **Beat->timestamp manifest** — every `captionBeat`/explicit `beat(label)` call
  writes to a `<slug>.beats.json` sidecar (via the `beat` fixture in
  `demo-recording.fixture.ts`, timed from the same `recordingStart` the video
  itself starts from). One source of truth consumed four ways: the ffmpeg
  speed-ramp windows below, the hero-gif window, frame-verification input, and
  this doc's beat-map tables.
- **`?demo=1`** is now appended to the fixture's `page.goto()` — was previously
  only a monitor-side feature (app.tsx, Lane B) with no caller. Scopes the job list
  to jobs created after page load and suppresses the DLQ banner — kills the "opens
  on a leftover job" contradiction without any DB truncation.
- **`demo:reset`** (`scripts/demo-reset.sh`, `pnpm demo:reset`) — an opt-in,
  `--yes`-gated `TRUNCATE dtm_jobs CASCADE`. NOT load-bearing for correctness
  (`?demo=1`'s pageLoadTime filter + the full-screen dock's job-scoping already
  handle it) — a convenience for a genuinely empty `All Jobs (0)` table before a
  manual walkthrough or screenshot.
- **ffmpeg speed-ramp, keyed to beat labels** — see "Speed-ramp map" below.
- **Hero gif v2** — the infra recording's cascade-landing beat window (full-screen
  DAG, the amber flip), replacing the old hardcoded iot `-ss 22 -t 20` window.

## Prerequisites

1. **Infrastructure running** — `pnpm infra` (orchestrator + workers + DB + Kafka + SQS)
2. **Monitor dashboard running**, with the frontend auth bypass on (`DISABLE_AUTH=true`
   alone does NOT bypass the monitor's own SuperTokens redirect — see `app.tsx`):
   ```bash
   cd apps/monitor && VITE_DISABLE_AUTH=true npx vite --port 5173 --strictPort
   ```
   If ports 5173-5182 are all busy (common in a multi-agent workspace), Vite
   auto-shifts to the next free port — note whatever it picks and pass it as
   `DASHBOARD_URL` below.
3. **Chromium installed** — `npx playwright install chromium` (one-time per machine;
   not carried by a hardlinked-`node_modules` worktree — check
   `~/.cache/ms-playwright/` for a `chromium-*` dir before assuming it's there).
4. **`.env` present** — a fresh worktree has no `.env` (gitignored). `env.ts`'s own
   default DB password (`migration_pass`) will NOT match a standard local bring-up
   (`dtm_dev_password_2026` in `.env`) — pass `DTM_DB_PASSWORD` explicitly (see
   below) rather than copying `.env` into the worktree.
5. **ffmpeg / ffprobe / jq** on `PATH` (post-production step only — `jq` reads the
   beat manifests).

## One command regenerates everything

```bash
DASHBOARD_URL=http://localhost:5173 DTM_DB_PASSWORD=dtm_dev_password_2026 \
  bash scripts/generate-demo-media.sh
```

This is copy-pasteable as written against a stock local bring-up — adjust
`DASHBOARD_URL`'s port to match whatever Vite actually bound, and
`DTM_DB_PASSWORD` to your own `.env` if it differs. It:

1. Runs the three `STORY`-tagged Playwright specs in **one** invocation, sequentially
   (single worker, single stack — never parallel, and never split across separate
   `playwright test` calls: Playwright wipes its `outputDir` at the start of *every*
   invocation, which would delete an earlier run's renamed webm before ffmpeg saw
   it — this is why raw recordings live in `demo-recordings/`, a sibling of
   `test-results/`, not inside it). Each spec also writes `<slug>.beats.json` next
   to its webm.
2. Converts each `.webm` → a RAW `.mp4` (h264, no audio) into
   `demo-recordings/.raw-mp4/` (gitignored intermediate — the beat manifest's
   timestamps are relative to THIS file, not the final ramped one).
3. Builds `docs/media/hero.gif` from the infra recording's `cascade-landed` beat
   (raw/unramped timestamps) — see "Hero gif" below.
4. Speed-ramps the order-processing and infra recordings over their real SQS-retry
   dead-air span, writes the final `docs/media/*.mp4` — see "Speed-ramp map" below.
   Set `SPEED_RAMP=off` to publish the raw 1:1 recordings unramped instead (useful
   when debugging a beat regression — the ramped cut can hide a missing beat behind
   the "WARNING: falling back to unramped" message, so check the script's stdout).
5. Prints `ffprobe` duration/size for every artifact.

Per-workflow scripts also exist for iterating on a single demo without the other two
(they do NOT run the post-production steps — use these while iterating on a spec,
then run the full script above to publish):

```bash
pnpm se:playwright:demo:order    # order-processing partial payment failure
pnpm se:playwright:demo:iot      # iot-sensor-pipeline double fan-out
pnpm se:playwright:demo:infra    # infra-provisioning cascade failure
pnpm se:playwright:demo:story    # all three STORY demos, one invocation (no ffmpeg step)
pnpm se:playwright:demo:multi    # untouched pre-rework demo (not narrated)
pnpm demo:reset                  # optional: TRUNCATE dtm_jobs before a take (see above)
pnpm demo:media                  # alias for scripts/generate-demo-media.sh
```

## Speed-ramp map

Both the order-processing and infra recordings have a real, honest ~50-60s span
where the UI is genuinely waiting on SQS-visibility-timeout-driven retries (the
product's own retry cadence, not an artifact of the recording) — beat-synced
captions narrate through it live (never freeze), but the PUBLISHED cut still
compresses it 3x with a baked "×3" corner tag so the raw ~90-100s recording reads
as an ~80s edited video, matching `ux-storyboards.md` §2's target runtimes. The
ramp window is looked up from each recording's own `<slug>.beats.json` by LABEL,
never a hardcoded second offset — if a spec's beat sequence changes, the ramp
follows automatically (or the script warns and falls back to unramped rather than
silently ramping the wrong span).

| Video | Ramp window (beat labels) | Factor | What's inside the window |
|---|---|---|---|
| `order-processing-partial-payment-failure` | `drilldown-open` → `terminal-landed` | 3x | ValidatePayment's 2nd/3rd retry attempts landing (~30s apart), the console-scope beat |
| `infra-cascade-failure` | `drilldown-open` → `cascade-landed` | 5x | ApplyCompute's 6 PARALLEL instances × 3 attempts each failing out (~30s apart, but 6-wide — a longer dead-air span than order's single ValidatePayment, hence the higher factor), the console-scope beat |
| `iot-double-fan-out` | *(none)* | 1x | No comparable dead-air span — the double fan-out completes in seconds; published unramped |

The cascade FLIP itself (`cascade-landed` → the certificate-zoom beat → the
"network/environment untouched" beat) and the retry-attempt drill-down's OPEN
moment stay at 1x on both sides of the ramp — only the actual waiting is
compressed, never the kinetic moments.

## Hero gif

`docs/media/hero.gif` is built from the **infra** recording's `cascade-landed` beat
window (`t - 4s` .. `t + 14s`, raw/unramped timestamps) — the full-screen DAG with
ApplyCompute red and storage/DNS/load-balancer/certificate flipping to dashed amber
in one frame, "blast radius as a picture" with zero words. This replaces the v1
gif (iot double-fan-out, hardcoded `-ss 22 -t 20`) — the storyboard's own
recommendation (`ux-storyboards.md` §2, "Hero gif v2").

If the infra spec's beat sequence changes and `cascade-landed` goes missing, the
script warns and falls back to a fixed `-ss 45` offset — check the script's stdout
for the warning and re-verify the gif lands on the right frame (`ffmpeg -ss <t> -i
hero.gif -frames:v 1 -update 1 out.png` and eyeball it) before trusting it.

## Output

| Artifact | Duration | Size |
|---|---|---|
| `docs/media/order-processing-partial-payment-failure.mp4` | ~63s (ramped 3x from ~96s raw; verified across 2 runs: 63.0-63.7s) | ~3 MB |
| `docs/media/iot-double-fan-out.mp4` | ~48s (unramped; verified across 2 runs: 47.7-48.0s) | ~4 MB |
| `docs/media/infra-cascade-failure.mp4` | ~87s (ramped 5x from ~173s raw; verified across 2 runs: 87.0-87.2s) | ~3 MB |
| `docs/media/hero.gif` | ~18s | ~2 MB |

Committed in-repo, not as GitHub release assets — every mp4 is comfortably under a
few MB and the gif is under its own 5 MB budget; release assets would add
indirection for no size benefit at this scale. Re-evaluate if a future demo's
recording grows past a few tens of MB.

Raw `.webm` recordings and their `.raw-mp4`/`.beats.json` intermediates land in
`setpoint-evals-playwright/demo-recordings/` (gitignored — `docs/media/` is the
artifact that matters).

## How each story demo works (ACT structure per `ux-storyboards.md` §2)

**ACT I — read the contract.** Scenarios screen, suite tab, select the eval. The
gherkin block, then the README's mermaid diagram — scrolled into view and asserted
**`toBeInViewport()`** (not merely `toBeVisible()` — an off-viewport SVG passes
`toBeVisible()` in Playwright, which is exactly how v1's diagram silently never
appeared on screen for 6 seconds of "look at this diagram" caption. `toBeInViewport`
checks real intersection with the viewport rectangle below the fixed caption band).

**ACT II — run it.** `spotlightClick(page, '.run-button')` — a fake cursor glides,
glows, ripples, THEN clicks; re-issues the README's own `## Payload` JSON through
`POST /api/v1/evals/:suite/:id/run` → the real `POST /api/v1/workflows/:name/jobs`
endpoint (no shell exec, ever). The result link deep-links to the Dashboard with the
new job selected; the header's workflow pill filters the job list and lights up the
per-workflow DAG.

**ACT III — watch the graph.** `spotlightClick(page, '.dag-expand-btn')` opens the
full-screen DAG **on camera** (not a silent pre-condition). A node is clicked
(spotlighted) to open its drill-down — the real activity data (retry timeline for a
primary step like ValidatePayment, or a fan-out instance list for an aggregate step
like ApplyCompute/IngestReading — see each spec's own header comment for which shape
applies and why). The console dock is scoped to that node
(`.drilldown-scope-events-btn`). The terminal state lands live via WebSocket,
verified against the DB independently (below) — no cross-lane contamination, no
guessing. A two-level Esc (drill-down first, then full-screen) exits on camera.

**ACT IV — close on the contract's own checklist.** Back to Scenarios, same eval,
scrolled to and asserted `toBeInViewport()` on the `## Assertions` heading (rendered
as ☐/☑ glyphs, not interactive checkboxes — `lib/markdown.ts`). The README's
`Artifacts`/`Run` sections (raw shell, `verify_step_status` calls) never appear —
`eval-detail.tsx`'s own D4 disclosure (`ux-storyboards.md` §3.5, shipped in Lane B)
collapses them behind a closed-by-default "Technical verification ▸" `<details>`;
this spec never expands it.

### 1. Order Processing — `SE-04-partial-payment-failure` → `PARTIAL_SUCCESS`

Ada's Beans Cafe: Barbara Liskov's card never finishes processing (the payload's
`paymentId` is a reserved not-found sentinel). Customer, Order, and Shipment are
required cascades and complete regardless; only `SubmitPayment` (and, one hop
further, `ArchiveProcessedOrder` — see spec-writing note below) are skipped because
their dependency `ValidatePayment` failed. **Ground truth, verified live**:
`ValidatePayment` is genuinely SQS-redelivery-retried 3 times (~30s apart,
`retryCount=3` on the terminal row) — the "attempt two, attempt three" beat is an
honest claim about a real product behavior, not narrative embellishment.

| Beat label | Caption | What's on screen |
|---|---|---|
| `open` | "Ada's Beans Cafe made a promise: a failed payment must never sink the order." | Scenarios screen loading |
| `scenarios` | "The rule is written in plain language — business and engineering read the same page." | Gherkin block |
| `mermaid-visible` | "And the same rule as a picture: payment is optional, shipment is not." | README mermaid, IN VIEWPORT |
| — | "This is what we're about to prove — live, not on a slide." | Panned toward the failure branch |
| — | "One click runs the real thing." | Spotlighted Run button |
| `run-click`/`job-created` | "A real order, entering the real engine." | Job-created link |
| `workflow-filtered` | "Customer, order, shipment — everything Ada's Beans Cafe owes this order." | Dashboard, workflow filtered |
| `fullscreen-open` | "The whole promise, as a living map." | Full-screen DAG entered on camera |
| — | "Green is kept. Blue is in flight. Watch the payment corner." | ValidatePayment turns `.dagActive` |
| `drilldown-open` | "The engine isn't giving up — attempt two, attempt three, on its own." | Drill-down: ValidatePayment's real attempt timeline |
| `console-scoped` | "Every attempt is on the record — nothing hidden in a log file." | Console dock scoped to ValidatePayment |
| `terminal-landed` | "The payment lost. The order won." | ValidatePayment red, SubmitPayment amber/skipped |
| `fullscreen-exit` | "PARTIAL SUCCESS — the engine failed exactly as designed." | Job Detail, PARTIAL_SUCCESS badge |
| `assertions` | "Here's the checklist proving the promise held, item by item." / "Contracts you can watch being kept." | Assertions checklist, IN VIEWPORT |

**Note on ArchiveProcessedOrder:** the SE-04 README's own mermaid diagram claims
`SubmitPayment`'s SKIPPED state "still unblocks Archive" (a dotted line). Verified
live this is NOT what the actual dependency graph does —
`workflow.config.ts`'s `ArchiveProcessedOrder` step lists `SubmitPayment` as a hard
dependency, so a real run skips `ArchiveProcessedOrder` too. This is consistent with
(not a contradiction of) the demo's own promise — "the engine skipped only what
depended on it" — but it means the README's diagram is itself slightly aspirational
on this one dotted edge. Not fixed here (a workflow-config/README-diagram
correction, out of this rework's scope) — flagged for whichever lane owns
`workflow.config.ts` next. The demo's captions never assert on Archive's status, so
this doesn't affect what's said on screen.

### 2. IoT Sensor Pipeline — `SE-03-double-fan-out` → `COMPLETED`

The README's own **"Demo pick"** — greenhouse-3 (the widest device in the fleet)
fans out to 3 sensors; each sensor's `DiscoverReadings` independently triggers its
OWN nested fan-out (18 `IngestReading` + 18 `PublishReading` child steps, verified
live post-#36-dedupe-fix: `DiscoverReadings=3`, `IngestReading=18` — the doubled
`6`/`36` counts from the pre-#36 race are gone). Job lands `COMPLETED`.

**Deviation from `ux-storyboards.md`'s literal node choice** (documented in the
spec's own header comment, verified live before scripting): the storyboard's 0:45
beat says "click DiscoverReadings → eighteen children." This is wrong —
`DiscoverReadings` is ITSELF a 3-instance fan-out (one per sensor); its own
drill-down shows `Fan-out (3)`. The honest 18-instance surface is `IngestReading`
(`GET .../steps/IngestReading/activity` → `instanceCount: 18`, confirmed live). This
demo drills into `IngestReading` instead.

**Also avoided:** the DAG's own fan-out badge (the "n/m" corner label on a discovery
node, e.g. `DiscoverSensors`) has a known, unfixed bug (documented as a follow-up in
PR #36's body — sums ALL descendant chain rows against the node's own `childCount`,
producing something like `24/3`). No caption in this demo quotes a badge ratio — the
verified-correct surfaces are the drill-down's own `Fan-out (N)` count (independent
computation, straight from `/activity`) and the job's total step count.

| Beat label | Caption | What's on screen |
|---|---|---|
| `open` | "Greenhouse 3 has three sensors. Nobody knows in advance how much work one health check becomes." | Scenarios screen loading |
| `scenarios` | "The contract doesn't list the work — it describes how work is discovered." | Gherkin block |
| `mermaid-visible` | "One box becomes three, becomes eighteen — the tree is the promise." | README fan-out tree, IN VIEWPORT |
| — | "Run it. No batch file, no pre-wiring." | Spotlighted Run button |
| `run-click`/`job-created` | "The engine starts with six steps. Watch what it finds." | Job-created link |
| `workflow-filtered` | *(dashboard filtered)* | Dashboard, workflow filtered |
| `fullscreen-open` | "Discovery in progress — the map grows as the engine learns the fleet, one sensor at a time." | Full-screen DAG entered on camera |
| — | "Every branch is tracked on its own — from discovery to the last reading." | IngestReading turns active/done |
| `drilldown-open` | "Eighteen individual readings, each with its own status and duration — on its own row." | Drill-down: IngestReading's 18-instance fan-out list |
| `console-scoped` | "Every step change is on the record — nothing hidden in a log file." | Console dock scoped to IngestReading |
| `terminal-landed` | "Every branch finished. The tree closed itself." | Whole DAG green |
| `fullscreen-exit` | "COMPLETED — the fleet's widest device, fully accounted for." | Job Detail, COMPLETED badge |
| `assertions` | "Every sensor, every reading — checked." | Assertions checklist, IN VIEWPORT |

### 3. Infra Provisioning — `SE-08-skipped-propagation-breadth` → `FAILED`

The prod-eu chain's compute stage fails permanently for every fanned-out instance.
Three sibling cascades that depend directly on compute — storage, dns, load
balancer — are skipped (breadth); dns's own dependent, certificate, is skipped two
hops deep (depth); network and environment (no compute dependency) stay
**untouched, green** — the storyboard's "blast radius as a picture" pitch, verified
live via a full-screen DAG screenshot exactly matching this description (see PR
body). Compute is a required cascade, so the job lands `FAILED`.

**Ground truth, verified live**: `ApplyCompute` fans out to 6 instances, each
retried 3 times (18 real attempts total, `retryCount=3` on every terminal FAILED
row). Because `ApplyCompute` is a fanned-out (aggregate) step, its drill-down does
NOT render a per-instance attempt-by-attempt timeline the way `ValidatePayment`
does in the order-processing demo (that detail only exists for PRIMARY steps) — but
the drill-down HEADER's own `attempt 3` chip, and the flat Job Detail step list's
`↳ SIMULATED FAILURE [Attempt 3/3]: Apply Compute` line under each of the 6 failed
rows, both render live and both back the caption's "each tried three times" claim.

| Beat label | Caption | What's on screen |
|---|---|---|
| `open` | "An environment is a chain: network, compute, and everything that sits on top." | Scenarios screen loading |
| `scenarios` | "Today compute is rigged to fail — on purpose. We want to see the blast radius, not guess it." | Gherkin block |
| `mermaid-visible` | "The contract predicts the damage: three direct casualties, one two hops away — and two survivors." | README mermaid, IN VIEWPORT |
| — | "Break it. Deliberately. On the record." | Spotlighted Run button |
| `run-click`/`job-created` | "Provisioning starts healthy — environment green, network green." | Job-created link |
| `workflow-filtered` | *(dashboard filtered)* | Dashboard, workflow filtered |
| `fullscreen-open` | "Now compute starts failing. The engine retries before it condemns." | Full-screen DAG, ApplyCompute turns active |
| `drilldown-open` | "Six instances, each tried three times before the verdict. Patience, then honesty." | Drill-down: ApplyCompute's 6-instance fan-out list + `attempt 3` chip |
| `console-scoped` | "Every skip has a reason attached — no downstream team left guessing." | Console dock scoped to ApplyCompute |
| `cascade-landed` | "Verdict in. Watch the failure travel the map." | ApplyCompute red; storage/DNS/LB flip to dashed amber |
| — | "The certificate never touched compute — but it needed DNS. Two hops away, still caught." | Certificate node flips amber |
| `terminal-landed` | "And network and environment stand untouched. Damage contained, not smeared." | Full-screen DAG: red core, amber ring, 2 green survivors |
| `fullscreen-exit` | "FAILED — with a map of exactly what that means." | Job Detail, FAILED badge |
| `assertions` | "What should break, broke. What shouldn't, didn't. Checked." | Assertions checklist, IN VIEWPORT |

## Caption system

`setpoint-evals-playwright/src/demos/helpers.ts` exports:

- **`caption(page, text, holdMs)`** — the original fixed-hold cue, still used for
  pure narration beats with no UI condition to key off (e.g. the opening line
  before anything is on screen). A fixed-position band appended as a
  `document.body` child (a sibling of the Preact root, so app re-renders never
  touch it), anchored to the **top** of the frame — deliberate, since a video
  player's own scrub/nav chrome overlays the bottom. High-contrast (white on
  ~92%-opaque black, 3px accent underline).
- **`captionBeat(page, text, { label, mark, waitFor, minMs, maxMs })`** — the v2
  default for any beat with a real UI condition. Shows the caption, holds `minMs`,
  then races `waitFor()` against the `maxMs` ceiling — never hangs a take on a
  selector that doesn't appear (a flaky run just proceeds at the ceiling). If
  `label`+`mark` (the `beat` fixture) are passed, logs `{label, t}` to the beat
  manifest.
- **`spotlightClick(page, selector, { hoverMs, postClickMs })`** — fake cursor dot
  (injected DOM + CSS keyframes) glides to the target's bounding-box center via
  real `page.mouse.move` (so the app's own `:hover` states engage too), glows for
  `hoverMs` (default 1.5s), ripples, then clicks. Every on-camera click uses this.

## Recording fixture

`setpoint-evals-playwright/src/fixtures/demo-recording.fixture.ts` — distinct from
the pre-existing `dashboard.fixture.ts` (still used by `multi-job-demo.spec.ts`,
which triggers workflows straight through the API rather than driving the Scenarios
screen). Each story spec names its own recording via `test.use({ demoSlug: '...' })`;
the fixture renames Playwright's autogenerated video hash to `<slug>.webm` on
teardown so the post-production step can find it deterministically, and writes into
`demo-recordings/` (not `test-results/`) so three separate invocations don't clobber
each other. v2 additions: appends `?demo=1` to the `goto` URL, and a `beat` fixture
(shares a `recordingStart` timestamp with `dashboardPage`) that writes
`<slug>.beats.json` at teardown.

## Verifying outcomes independently

Every recording's terminal status is checkable directly against the orchestrator DB
(no need to trust the UI screenshot alone):

```bash
psql -h localhost -p 5448 -U dtm_user -d dtm -c \
  "select workflow_name, status, submitted_at from dtm_jobs order by submitted_at desc limit 5;"
```

## Architecture

```
Playwright (browser, recordVideo on)
  │  opens ?demo=1
  ▼
apps/monitor/           ◄──── WebSocket ────── orchestrator:3000/ws/events
  (Vite dev)                                       │
                                                    │ broadcasts events (incl. step_retrying,
                                                    │ step_skipped)
  Scenarios screen ──── POST /evals/:suite/:id/run ──► re-issues README Payload
                                                    │
                                                    ▼
                                          POST /workflows/:name/jobs
                                                    │
                                                    ▼
                                          SQS → Lambda workers → Callback
                                                    │
  Full-screen DAG ◄──── GET /jobs/:jobId/steps/:step/activity (drill-down data)
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DASHBOARD_URL` | `http://localhost:5173` | Monitor dashboard URL — set explicitly if Vite auto-shifted ports |
| `DTM_DB_PASSWORD` | `migration_pass` (env.ts default) | Preflight DB check password — override to match your `.env` |
| `SPEED_RAMP` | `on` | Set to `off` to publish raw 1:1 recordings unramped |
| `ORCHESTRATOR_PORT_HOST` | `3002` | Orchestrator host port |

## Running Evals + Demos Together

```bash
# Run all core evals first, then record demos
pnpm se:playwright:core && pnpm se:playwright:demos

# Run everything (core + workflow evals + demos)
pnpm se:playwright
```
