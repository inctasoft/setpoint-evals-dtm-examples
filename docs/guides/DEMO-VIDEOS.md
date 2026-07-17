# Demo Video Recordings

Three subtitled "story" recordings of the DTM Operations Dashboard (Phase 5) — each
drives the monitor's own Scenarios screen the way an operator would: open an eval,
read its README as the contract (gherkin + mermaid), click Run, follow the job live
on the Dashboard, then close back on the Assertions checklist that proves the
contract held. A top-anchored caption band narrates the business promise each
scenario keeps or breaks — never the mechanics (no queue/topic/enum jargon; the UI
itself already shows the status codes).

A fourth, unnarrated demo (`multi-job-demo.spec.ts`, all 3 workflows fired at once)
predates Phase 5 and is untouched — it is not part of the story set below.

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
5. **ffmpeg / ffprobe** on `PATH` (post-production step only).

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
   `test-results/`, not inside it).
2. Converts each `.webm` → `.mp4` (h264, no audio, faststart) into `docs/media/`.
3. Builds `docs/media/hero.gif` from the iot double-fan-out clip's most kinetic
   ~20s window (hardcoded `-ss 22 -t 20` — see caveat below).
4. Prints `ffprobe` duration/size for every artifact.

Per-workflow scripts also exist for iterating on a single demo without the other two:

```bash
pnpm se:playwright:demo:order    # order-processing partial payment failure
pnpm se:playwright:demo:iot      # iot-sensor-pipeline double fan-out
pnpm se:playwright:demo:infra    # infra-provisioning cascade failure
pnpm se:playwright:demo:story    # all three STORY demos, one invocation (no ffmpeg step)
pnpm se:playwright:demo:multi    # untouched pre-Phase-5 demo (not narrated)
```

**Hardcoded hero-gif window caveat:** the `-ss 22 -t 20` clip offset assumes the iot
demo's caption timing (holds are fixed `waitForTimeout` calls; only the UI's own
processing time varies run-to-run, and it has stayed well inside that window across
every observed run: 47-55s total). If the caption text or hold durations in
`iot-pipeline-demo.spec.ts` change, re-check the gif lands on the "DAG goes fully
green, step count lands" beat (grab a frame at t=0 and t=15 of the gif with
`ffmpeg -ss <t> -i hero.gif -frames:v 1 -update 1 out.png` and eyeball it) before
trusting the regenerated file.

## Output

| Artifact | Duration | Size |
|---|---|---|
| `docs/media/order-processing-partial-payment-failure.mp4` | ~91s | ~5 MB |
| `docs/media/iot-double-fan-out.mp4` | ~47s | ~3 MB |
| `docs/media/infra-cascade-failure.mp4` | ~91s | ~4 MB |
| `docs/media/hero.gif` | 20s | ~2.5 MB |

Total ~15 MB. **Committed in-repo, not as GitHub release assets** — every mp4 is
comfortably under 5 MB and the gif is under its own 5 MB budget; release assets
would add indirection (a separate upload step, a URL that isn't just a repo path)
for no size benefit at this scale. Re-evaluate if a future demo's recording grows
past a few tens of MB.

Raw `.webm` recordings land in `setpoint-evals-playwright/demo-recordings/`
(gitignored — post-production output in `docs/media/` is the artifact that matters).

## How each story demo works

1. **Scenarios screen** — click the workflow's suite tab, select the eval. Its
   README renders as the contract: gherkin `Scenario:` block + a mermaid diagram
   (certified rendering, not raw fence text).
2. **Run** — clicking `▶ Run` calls `POST /api/v1/evals/:suite/:id/run`, which
   re-issues that exact README's own `## Payload` JSON through the real
   `POST /api/v1/workflows/:name/jobs` endpoint (no shell exec, ever).
3. **Deep-link to Dashboard** — the run result's job-id link switches the view and
   selects the new job; clicking the matching workflow pill in the header filters
   the job list and lights up the per-workflow step-graph mini-viz.
4. **Watch the outcome land** — poll the job status text until it reaches its
   terminal state (verified against the live orchestrator DB for every recording
   below — no cross-lane contamination, no guessing).
5. **Close on the Assertions checklist** — back to Scenarios, same eval, scrolled to
   its `## Assertions` list (rendered as ☐/☑ glyphs, not interactive checkboxes).

### 1. Order Processing — `SE-04-partial-payment-failure` → `PARTIAL_SUCCESS`

Ada's Beans Cafe: Barbara Liskov's card never finishes processing (the payload's
`paymentId` is a reserved not-found sentinel). Customer, Order, and Shipment are
required cascades and complete regardless; only `SubmitPayment` is skipped because
its dependency `ValidatePayment` failed. The job lands `PARTIAL_SUCCESS`.

| # | Caption | Beat |
|---|---|---|
| 1 | "Ada's Beans Cafe promises: if a payment fails, your order still ships. Watch the engine keep that promise." | Open |
| 2 | "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs." | Scenarios screen |
| 3 | "Barbara's card on file never finishes processing — that's deliberate, not a bug." | Gherkin + mermaid read |
| 4 | "Clicking Run submits the real job the contract describes." | Pre-Run |
| 5 | "Following the job live on the operations dashboard." | Post-Run, pre deep-link |
| 6 | "The customer, the order, and the shipment are everything Ada's Beans Cafe owes this order — watch them land while the payment struggles." | Job processing |
| 7 | "The payment failed, and the engine skipped only what depended on it — everything else Barbara was promised still shipped." | Terminal state landed |
| 8 | "Here's the checklist proving the promise held, item by item." | Assertions close |

### 2. IoT Sensor Pipeline — `SE-03-double-fan-out` → `COMPLETED`

The README's own **"Demo pick"** annotation. Greenhouse 3 (the widest device in the
fleet) fans out to 3 sensors; each sensor's `DiscoverReadings` independently
triggers its OWN nested fan-out — 2 levels of fan-out from a single job, 18
`IngestReading` + 18 `PublishReading` child steps. The most visually kinetic run in
the estate (this is the hero gif's source clip). Job lands `COMPLETED`.

| # | Caption | Beat |
|---|---|---|
| 1 | "Greenhouse 3 is the widest device in the fleet — one sensor check can explode into dozens of readings." | Open |
| 2 | "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs." | Scenarios screen |
| 3 | "Three sensors, each independently checking its own history — nobody pre-declares that shape, the engine discovers it live." | Gherkin + mermaid read |
| 4 | "Clicking Run submits the real job the contract describes." | Pre-Run |
| 5 | "Following the job live on the operations dashboard." | Post-Run, pre deep-link |
| 6 | "Watch one job become a whole tree of work — every sensor, then every reading underneath it, each tracked on its own." | Job processing (fan-out) |
| 7 | "Every branch finished — the fleet's widest device, fully accounted for, without anyone hand-wiring the fan-out." | Terminal state landed |
| 8 | "The checklist confirms it — every sensor, every reading, done." | Assertions close |

### 3. Infra Provisioning — `SE-08-skipped-propagation-breadth` → `FAILED`

The prod-eu chain's compute stage fails permanently for every fanned-out instance.
Three sibling cascades that depend directly on compute — storage, dns, load
balancer — are skipped (breadth); dns's own dependent, certificate, is skipped two
hops deep (depth). Compute is a required cascade, so the job lands `FAILED` — "blast
radius as a picture," per the plan's own framing.

| # | Caption | Beat |
|---|---|---|
| 1 | "Provisioning an environment is a chain: network, then compute, then everything that sits on top of it. Break one link and watch what really depends on it." | Open |
| 2 | "Every scenario's README is a plain-language rule, illustrated as a diagram — before a line of code runs." | Scenarios screen |
| 3 | "This chain's compute stage is configured to fail permanently — on purpose, so we can watch the blast radius, not guess at it." | Gherkin + mermaid read |
| 4 | "Clicking Run submits the real job the contract describes." | Pre-Run |
| 5 | "Following the job live on the operations dashboard." | Post-Run, pre deep-link |
| 6 | "Storage, DNS, and the load balancer all sit directly on compute — three separate promises that all break the same way, at once." | Job processing |
| 7 | "The certificate depended on DNS, not on compute directly — two hops away, and still caught by the same failure. Nothing downstream was left guessing." | Terminal state landed |
| 8 | "The checklist confirms exactly what should have broken — and, just as important, what should not have." | Assertions close |

## Caption system

`setpoint-evals-playwright/src/demos/helpers.ts` exports `caption(page, text, holdMs)`:
a fixed-position band appended as a `document.body` child (a sibling of the Preact
root, so app re-renders never touch it), anchored to the **top** of the frame —
deliberate, since a video player's own scrub/nav chrome overlays the bottom, and a
bottom-anchored caption would get clipped or hidden while a viewer scrubs.
High-contrast (white on ~92%-opaque black, 3px accent underline) for legibility over
any part of the dashboard. Injected via `page.evaluate`, timed per demo beat — each
`caption()` call is one cue, held long enough to read before the next UI action
starts.

## Recording fixture

`setpoint-evals-playwright/src/fixtures/demo-recording.fixture.ts` — distinct from
the pre-existing `dashboard.fixture.ts` (still used by `multi-job-demo.spec.ts`,
which triggers workflows straight through the API rather than driving the Scenarios
screen). Each story spec names its own recording via `test.use({ demoSlug: '...' })`;
the fixture renames Playwright's autogenerated video hash to `<slug>.webm` on
teardown so the post-production step can find it deterministically, and writes into
`demo-recordings/` (not `test-results/`) so three separate invocations don't clobber
each other — see the caveat under "One command regenerates everything" above.

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
  │  opens
  ▼
apps/monitor/           ◄──── WebSocket ────── orchestrator:3000/ws/events
  (Vite dev)                                       │
                                                    │ broadcasts events
                                                    │
  Scenarios screen ──── POST /evals/:suite/:id/run ──► re-issues README Payload
                                                    │
                                                    ▼
                                          POST /workflows/:name/jobs
                                                    │
                                                    ▼
                                          SQS → Lambda workers → Callback
```

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `DASHBOARD_URL` | `http://localhost:5173` | Monitor dashboard URL — set explicitly if Vite auto-shifted ports |
| `DTM_DB_PASSWORD` | `migration_pass` (env.ts default) | Preflight DB check password — override to match your `.env` |
| `ORCHESTRATOR_PORT_HOST` | `3002` | Orchestrator host port |

## Running Evals + Demos Together

```bash
# Run all core evals first, then record demos
pnpm se:playwright:core && pnpm se:playwright:demos

# Run everything (core + workflow evals + demos)
pnpm se:playwright
```
