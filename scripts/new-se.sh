#!/usr/bin/env bash
# new-se.sh — scaffold a canonical Setpoint Eval so the right layout is the DEFAULT output
# (not a memory check). Creates  <root>/setpoint-evals/<suite>/SE-<NN>-<name>/{README.md, test.sh}
# (or SE-<ABBR>-<NN>-<name>/ with --infix) pre-filled with a GIVEN/WHEN/THEN README + a mermaid
# stub + an ## Artifacts stub (v2.1, warn-only — raw payload/schema/seed/expected-output) and the
# standard test harness.
#
# Usage:  new-se.sh <suite> <NN> <kebab-name> [--root <repo-or-worktree>] [--infix <ABBR>]
#   e.g.  new-se.sh doc-upload 03 rejects-oversize-pdf --root /path/to/your/worktree
#   e.g.  new-se.sh tab-watcher 04 two-real-tabs-survive --infix TW   # -> SE-TW-04-two-real-tabs-survive
# Default --root = current directory (cd into your worktree first).
#
# --infix <ABBR>: some suites use a suite-abbreviation infix (SE-TW-*, SE-HCB-*, SE-DP-*) instead
# of a bare SE-<NN>-*. Without this flag the scaffold produces SE-<NN>-<name> and the infix must be
# added by a manual post-scaffold rename — a step that has been skipped in practice (see
# DIFFICULTIES-LOG.md "new-se.sh does not add a suite-abbreviation infix"), producing an un-prefixed
# dir that a suite's own infix-only glob/convention silently excludes from its run. --infix scaffolds
# the correctly-named dir directly, no rename step. ABBR must be uppercase letters/digits (e.g. TW,
# HCB, DP) — it is uppercased automatically. The shared runner (se-run-suite.sh) already discovers
# SE-<ABBR>-<NN>-<name>/test.sh via its generic SE-* glob (verified: non-numeric ids sort after
# numeric ones, nothing is excluded) — no change needed there; this flag only closes the scaffold-side
# gap that led to a naming mismatch.
#
# Refuses to overwrite an existing SE. After scaffolding, fill in the README scenario + mermaid
# and the test.sh assertions, then `bash setpoint-evals/<suite>/run-all.sh`.
set -uo pipefail

ROOT="."; INFIX=""; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift ;;
    --infix) INFIX="$2"; shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
[ "${#ARGS[@]}" -eq 3 ] || { echo "usage: new-se.sh <suite> <NN> <kebab-name> [--root <repo>] [--infix <ABBR>]" >&2; exit 2; }
suite="${ARGS[0]}"; nn="${ARGS[1]}"; name="${ARGS[2]}"
ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "bad --root" >&2; exit 2; }

# normalize: NN zero-padded numeric, name kebab-case, infix (if given) uppercase alnum
[[ "$nn" =~ ^[0-9]+$ ]] || { echo "NN must be numeric (e.g. 03)" >&2; exit 2; }
printf -v nn '%02d' "$((10#$nn))"
[[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "name must be kebab-case (a-z0-9-)" >&2; exit 2; }
if [ -n "$INFIX" ]; then
  INFIX="${INFIX^^}"
  [[ "$INFIX" =~ ^[A-Z][A-Z0-9]*$ ]] || { echo "--infix must be uppercase letters/digits (e.g. TW, HCB, DP)" >&2; exit 2; }
fi

se_name="SE-${nn}-${name}"; se_sel="$nn"
if [ -n "$INFIX" ]; then se_name="SE-${INFIX}-${nn}-${name}"; se_sel="${INFIX}-${nn}"; fi
se_dir="$ROOT/setpoint-evals/$suite/$se_name"
[ -e "$se_dir" ] && { echo "refusing to overwrite existing $se_dir" >&2; exit 1; }
mkdir -p "$se_dir"

if [ -n "$INFIX" ]; then
  title="SE-${INFIX}-${nn}: ${name//-/ }"
else
  title="SE-${nn}: ${name//-/ }"
fi
cat > "$se_dir/README.md" <<README
# ${title}
**Category**: ${suite} · **Duration**: ~5s · **Timeout**: 120s

## Scenario
\`\`\`gherkin
Feature: <the feature this SE pins>
  Scenario: <one behavior>
    Given <concrete precondition / fixture state>
    When <the action under test, with params>
    Then <the observable outcome that must hold>
    And <secondary outcome>
\`\`\`

## Architecture
\`\`\`mermaid
sequenceDiagram
    participant T as test.sh
    participant S as <system under test>
    T->>S: <action>
    S-->>T: <observable result>
    Note over S: <state that must hold>
\`\`\`

## Artifacts
<!-- v2.1: the raw data the behavior above runs on — copy-paste from the real test.sh/helper/
     fixture, never paraphrase or invent. Menu of OPTIONAL blocks, include only what applies
     (see docs/setpoint-eval-conventions.md "Artifacts section" for the full sizing rule):
       - Input / payload   — the literal request (GraphQL mutation, JS object, CLI invocation, curl body)
       - Schema / SDL      — the JSON-Schema/GraphQL SDL fragment of the specific type under test
       - Seed / fixture    — the rows/counter/table created in arrange
       - Expected output   — the asserted response / golden fragment / real stdout markers
     Inline in full if ≤ ~40 lines and it IS the thing under test; otherwise a real representative
     excerpt + explicit truncation marker + path to the full committed artifact. -->

### Input / payload
\`\`\`
<literal request/payload/invocation fed to the code under test — from test.sh, not invented>
\`\`\`

### Expected output
\`\`\`
<the asserted stdout markers / response fields — 1:1 with Assertions below>
\`\`\`

## Assertions
<!-- one checkbox per ck/ck_eq/ck_has call in test.sh — keep 1:1 -->
- [ ] <binary check 1>
- [ ] <binary check 2>

## Run
\`\`\`bash
bash setpoint-evals/${suite}/run-all.sh --se ${se_sel}
\`\`\`

<why this matters — what regression it would catch>.
README

cat > "$se_dir/test.sh" <<'TEST'
#!/usr/bin/env bash
# <one-line: what this SE asserts>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has/ck_file_has/ck_absent (pipefail-safe, mutate counters — never call in $()),
# se_skip (exit 77 sentinel), se_summary, se_start_bg/se_stop_bg (setsid+pgid — hermetic servers),
# se_wait_http (poll-for-ready, no fixed sleeps), free_port.
. "$HERE/../../../scripts/se-lib.sh"
ROOT="$(se_root)"

# --- arrange ---------------------------------------------------------------
# tmp="$(mktemp -d)"; trap 'se_stop_bg; rm -rf "$tmp"' EXIT
# Self-booting server? BE HERMETIC:
#   port="$(free_port)";  se_port_free "$port" || se_skip "port busy — stale instance"
#   se_start_bg "$tmp/srv.log" env FOO=1 node server.js --port "$port"
#   se_wait_http "http://127.0.0.1:$port/health" || { log_fail "boot"; exit 1; }

# --- act -------------------------------------------------------------------

# --- assert (1:1 with the README checkbox list) ------------------------------
# ck      "label" test -f "$ROOT/some/file"
# ck_eq   "label" "$actual" "expected"
# ck_file_has "label" "$file" "regex"        # pipefail-safe
# ck_absent   "label" "$file" "regex"        # executed negative control

se_summary
TEST
chmod +x "$se_dir/test.sh"

rel="${se_dir#"$ROOT"/}"
echo "✓ scaffolded $rel/  (SE Conventions v2)"
echo "  - $rel/README.md   (fill: gherkin Scenario, mermaid, Artifacts (real payload/expected), Assertions checkboxes 1:1 with test.sh)"
echo "  - $rel/test.sh     (fill: arrange/act + ck_* assertions; se-lib sourced)"
echo "Next: edit both, then  bash setpoint-evals/$suite/run-all.sh"
