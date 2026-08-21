# Re-publicization of setpoint-evals-dtm-examples — fresh-history relaunch

> **Status:** PREP (Phase 0 landed via this PR; flip phases are CLASS B, operator-word-gated)
> **Date:** 2026-08-21 · **Owner lane:** dtm-examples-republicization (batch-1, 2026-08-21 dispatch)
> **Setpoint anchor:** ruling `q-dtm-examples-republicization-2026-08-21` = **fresh-history-relaunch**, ruled 2026-08-21T06:02:23Z (sitting item S4, operator live). This ruling is the acceptance gate for this plan.

## Goal

Re-publicize this repository to **popularize the term SETPOINT EVAL** — the public-uplift
content is the product, NOT the internal DTM visualization. The repo returns to public as a
showcase of the setpoint-eval methodology (per-SE README + mermaid + harness, fake-green
defenses, CI enforcement), with DTM serving only as the worked example it runs against.

## Mechanism (ruled — do not re-litigate)

- At re-publication the repo is **squashed to a FRESH ORPHAN HISTORY**: a new root commit
  carrying the hygiene-green tree, with **REAL publication dates** (the dates of the actual
  relaunch actions).
- **Backdating was DECLINED on the record** (flagged as fabricated provenance at the
  2026-08-21 sitting). No step of this plan may propose or perform commit-date manipulation.
- The ruling **supersedes-by-narrowing** the archived uplift plan's "no history rewrite" Key
  Decision **for the RELAUNCH ONLY** (history: `plans/_archive/dtm-examples-public-uplift.md`
  in server-config). A fresh orphan history is not a rewrite of published history — the old
  public history is retired wholesale, which also retires the token-in-public-history risk
  class.
- The private-side deny-list, the `public_repo_hygiene` runbook, and the salted-hash CI job
  **STAY** as standing defenses.

## Evidence base (measured 2026-08-21, this lane)

### State census

| Property | Value |
|---|---|
| Visibility | PRIVATE (isArchived: false) |
| Default branch | `master` |
| Commits | 62, spanning 2026-03-30 (`d6cbcd0`, initial) .. 2026-08-04 (`7109189`) |
| Last push | 2026-08-16T10:02:17Z |
| Tracked files | 926 |
| Local checkout | clean, HEAD == origin/master |

Top-level tracked inventory (files per top-level path): workflows 233 · services 195 ·
setpoint-evals 112 · packages 89 · docs 59 · tools 52 · apps 51 · scripts 41 ·
setpoint-evals-playwright 28 · .cursor 13 · .claude 11 · .github 5 · plus root configs
(compose files, package/pnpm files, CLAUDE.md, README.md, logs, LICENSE).

Secrets posture: only `.env.example` and `.env.local.example` are tracked; all live `.env*`
files are gitignored and therefore outside the publish set by definition.

Internal-reference candidates found in the tracked set (for Phase 1 disposition):

1. `CLAUDE.md:391` and `.github/workflows/ci.yml:36` — comments referencing the self-hosted
   CI runner's LAN host. Low sensitivity, but scrub-or-keep must be decided before the flip.
2. `README.md:74-75` — inctasoft.com blog cross-links. Intentional and public; KEEP (they are
   the popularization funnel).
3. `10.0.x.x` addresses in `workflows/infra-provisioning/**` SE fixtures and seed SQL —
   synthetic demo data (`example.com` hosts, fake AMI ids). Benign; KEEP.

### Hygiene scan (public-repo-hygiene-scan.sh, private deny-list, tracked-mode)

- Initial run 2026-08-21: **DIRTY — 1 hit** at
  `setpoint-evals/SE-23-workflow-detail-exposes-step-dependencies/README.md:46` (a
  deny-listed term appearing in generic prose; token identity lives only in the private
  registry, deliberately not reproduced here).
- Remediated in this same PR by rewording the sentence (no semantic change to the SE).
- Post-remediation run against this branch: recorded in the PR body — required **CLEAN** to merge.

## Phases

### Phase 0 — census + hygiene + plan (THIS PR) ✅
Everything above, delivered on branch `chore/republicization-prep`.

### Phase 1 — pre-flip content uplift (CLASS A, agent-runnable, worktree→PR)
1. README/docs pass oriented to the goal: lead with what a setpoint eval IS, the per-SE
   canonical layout, fake-green defenses, and how to adopt the pattern; demote DTM internals
   to "the example system".
2. Disposition of internal-reference candidate (1) above: scrub or keep the runner-host
   comments (recommend: reword to "a self-hosted runner" without the address).
3. Decide the public-snapshot exclusion set for the orphan commit (recommend excluding
   internal process dirs: `plans/`, `.claude/`, `.cursor/`, `DIFFICULTIES-LOG.md`,
   `IDEAS-LOG.md` — final list is a flip-time input, confirmed by the operator).
4. Re-run `public-repo-hygiene-scan.sh` → must be CLEAN; verify the salted-hash hygiene CI
   job is present and green on the branch that will seed the snapshot.

### Phase 2 — the flip (CLASS B — OPERATOR WORD REQUIRED; never agent-initiated)
> Every step below is outward-facing publish. Executes only after Phase 1 hygiene is green
> AND the operator gives the word. Marked CLASS B per the ruling.
1. [CLASS B] Build the fresh orphan root commit from the hygiene-green tree (real current
   date, minus the Phase-1 exclusion set).
2. [CLASS B] Replace `master` with the orphan history on the remote.
3. [CLASS B] Set repository visibility to PUBLIC.
4. [CLASS B] Verify the public view: single-root history, no pre-relaunch commits reachable,
   hygiene CI job green on the public repo.

### Phase 3 — post-flip
- Confirm public CI (including the salted-hash hygiene job) green on the public repo.
- Cross-link the blog articles and the repo both ways; announce per the operator's channel
  of choice.

## Non-goals / fences

- Nothing public before the operator word — no visibility change, no push to any public
  remote, no archive/unarchive, no history rewrite before Phase 2 authorization.
- No backdating, ever (declined on the record).
- No weakening of the standing hygiene defenses (deny-list, runbook, salted-hash CI job).
