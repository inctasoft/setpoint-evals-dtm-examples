#!/usr/bin/env bash
# validate-se-readmes.sh — closed-loop enforcement of the canonical Setpoint Eval layout:
# every SE carries a README.md that CONTAINS a mermaid diagram.
#
# WHY: the "per-SE README always" rule was open-loop (an instruction) and got dropped on
# server-config PR #148. This is the mechanical backstop so it can't silently happen again.
#
# CANONICAL SE = a directory  setpoint-evals/<suite>/SE-<n>-<name>/  containing:
#     test.sh      — the assertion (run-all.sh walks SE-*/test.sh)
#     README.md    — scenario (GIVEN/WHEN/THEN) + a ```mermaid block
# A flat  setpoint-evals/<suite>/se-*.sh  is the LEGACY form (no per-SE README possible).
#
# MODES:
#   (default, diff-scoped)  only checks SEs whose files are ADDED vs the base ref — so the large
#                           body of legacy flat suites is GRANDFATHERED; only new SEs are enforced.
#   --all [--root DIR]      full scan: every canonical SE-*/ dir under DIR must be well-formed;
#                           legacy flat se-*.sh are reported as debt (warn), never fail.
#   --files f1 f2 ...       treat exactly these paths as the "added" set (CI passes the PR diff;
#                           the SE fixtures pass synthetic paths). Implies diff-scoped rules.
#
#   --base <ref>            base ref for the diff (default: origin/main, else main).
#   --root <dir>            repo root to operate in (default: cwd).
#
# EXIT: 0 = compliant, 1 = violation(s) (prints them).
set -uo pipefail

BASE=""; ALL=0; ROOT="."; MODE="diff"; declare -a EXPLICIT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all)   ALL=1; MODE="all" ;;
    --base)  BASE="$2"; shift ;;
    --root)  ROOT="$2"; shift ;;
    --files) MODE="files"; shift; while [ $# -gt 0 ] && [ "$1" != "--" ]; do EXPLICIT+=("$1"); shift; done ;;
    --)      shift; while [ $# -gt 0 ]; do EXPLICIT+=("$1"); shift; done ;;
    *) echo "validate-se-readmes: unknown arg: $1" >&2; exit 2 ;;
  esac
  shift || true
done

ROOT="$(cd "$ROOT" 2>/dev/null && pwd)" || { echo "bad --root" >&2; exit 2; }

violations=0
warns=0
viol() { printf '  ✗ %s\n' "$1"; violations=$((violations + 1)); }
warn() { printf '  ⚠ %s\n' "$1"; warns=$((warns + 1)); }

# A README.md is compliant iff it exists and contains a fenced ```mermaid block.
readme_has_mermaid() { [ -f "$1" ] && grep -q '```mermaid' "$1"; }
# SE Conventions v2 (2026-07-05) meaning checks — applied to NEW SEs only:
# the mermaid fence must be NON-EMPTY, the scenario is a ```gherkin block with
# Given/When/Then, and Assertions is a checkbox list mapping 1:1 to test.sh checks.
readme_mermaid_nonempty() { awk '/```mermaid/{f=1;next} /```/{if(f){exit (n>0)?0:1}} f&&NF{n++} END{exit (n>0)?0:1}' "$1"; }
readme_has_gherkin() { grep -q '```gherkin' "$1" && grep -qE '^\s*Given ' "$1" && grep -qE '^\s*When ' "$1" && grep -qE '^\s*Then ' "$1"; }
readme_has_checkbox_assertions() { grep -qE '^\s*- \[ \] ' "$1"; }
# v2.1 (2026-07-06) — ## Artifacts: the raw payloads/schemas/seeds the SE actually runs on
# (operator complaint: gherkin+mermaid narrate behavior but hide the concrete data). WARN-ONLY in
# BOTH diff-scoped (new-SE) and --all modes — never a hard gate — because sibling repos still
# scaffold new SEs from a pre-v2.1 new-se.sh that doesn't emit this section yet; see
# docs/setpoint-eval-conventions.md "Artifacts section" for the full rationale + promotion path.
# Bounded to the Artifacts section itself (stops at the next `## ` heading) so a fenced block in a
# later section (e.g. ```bash under ## Run) can't false-satisfy an empty Artifacts stub.
readme_has_artifacts() {
  awk '
    /^## Artifacts/ {inart=1; next}
    inart && /^## /  {inart=0}
    inart && /```/   {found=1}
    END {exit found ? 0 : 1}
  ' "$1"
}

# Check ONE canonical SE directory. $3=1 → the SE is NEW (diff-scoped add): v2 meaning
# checks are VIOLATIONS. $3=0 (--all sweep over existing estate): v2 checks are WARNs only.
check_se_dir() {
  local d="$1" rel="$2" is_new="${3:-0}"
  [ -f "$d/test.sh" ] || { viol "$rel/ — canonical SE dir has no test.sh"; return; }
  if [ ! -f "$d/README.md" ]; then
    viol "$rel/ — missing README.md (every SE needs one)"; return
  fi
  if ! readme_has_mermaid "$d/README.md"; then
    viol "$rel/README.md — present but has no \`\`\`mermaid diagram"; return
  fi
  local v2=viol; [ "$is_new" -eq 0 ] && v2=warn
  readme_mermaid_nonempty "$d/README.md"       || $v2 "$rel/README.md — mermaid fence is EMPTY (v2: diagram must have content)"
  readme_has_gherkin "$d/README.md"            || $v2 "$rel/README.md — v2: missing \`\`\`gherkin Scenario block with Given/When/Then lines"
  readme_has_checkbox_assertions "$d/README.md" || $v2 "$rel/README.md — v2: missing '## Assertions' checkbox list (- [ ] ...)"
  # v2.1: WARN-ONLY in BOTH new and --all modes (never viol) — see readme_has_artifacts() above.
  readme_has_artifacts "$d/README.md"          || warn "$rel/README.md — v2.1: missing '## Artifacts' section (raw payload/schema/seed/expected-output) — see docs/setpoint-eval-conventions.md"
}

# Classify a single path (root-relative) and enforce the ADDED-file rules.
check_added_path() {
  local p="$1"
  case "$p" in
    */setpoint-evals/*) : ;;
    setpoint-evals/*)   : ;;
    *) return ;;            # not an SE path
  esac
  # canonical SE test.sh  →  enforce sibling README+mermaid
  if [[ "$p" =~ setpoint-evals/[^/]+/SE-[^/]+/test\.sh$ ]]; then
    local d; d="$(dirname "$ROOT/$p")"
    check_se_dir "$d" "$(dirname "$p")" 1
    return
  fi
  # canonical SE README.md  →  must carry a mermaid block
  if [[ "$p" =~ setpoint-evals/[^/]+/SE-[^/]+/README\.md$ ]]; then
    readme_has_mermaid "$ROOT/$p" || viol "$p — README.md has no \`\`\`mermaid diagram"
    readme_has_artifacts "$ROOT/$p" || warn "$p — v2.1: missing '## Artifacts' section (raw payload/schema/seed/expected-output) — see docs/setpoint-eval-conventions.md"
    return
  fi
  # NEW flat legacy script  →  not allowed going forward
  if [[ "$p" =~ setpoint-evals/[^/]+/se-[^/]+\.sh$ ]]; then
    viol "$p — new SEs must use canonical SE-<n>-<name>/{README.md,test.sh}, not a flat se-*.sh"
    return
  fi
}

echo "── validate-se-readmes (mode: $MODE) ──"

case "$MODE" in
  all)
    # full scan: every canonical SE-*/ dir must be well-formed; legacy flat = warn only.
    while IFS= read -r d; do
      rel="${d#"$ROOT"/}"
      check_se_dir "$d" "$rel" 0
    done < <(find "$ROOT" -type d -path '*/setpoint-evals/*/SE-*' -not -path '*/setpoint-evals/*/SE-*/*' 2>/dev/null | sort)
    legacy=$(find "$ROOT" -type f -path '*/setpoint-evals/*/se-*.sh' 2>/dev/null | wc -l | tr -d ' ')
    [ "$legacy" -gt 0 ] && warn "$legacy legacy flat se-*.sh script(s) — pre-existing debt (migrate to canonical layout; not failing)"
    ;;
  files)
    for p in "${EXPLICIT[@]}"; do check_added_path "${p#"$ROOT"/}"; done
    ;;
  diff)
    if [ -z "$BASE" ]; then
      git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1 && BASE="origin/main" || BASE="main"
    fi
    mapfile -t added < <(git -C "$ROOT" diff --name-only --diff-filter=A "$BASE"...HEAD 2>/dev/null)
    if [ "${#added[@]}" -eq 0 ]; then
      echo "  (no added files vs $BASE — nothing to check)"
    fi
    for p in "${added[@]}"; do check_added_path "$p"; done
    ;;
esac

wsuffix=""; [ "$warns" -gt 0 ] && wsuffix=", ${warns} warning(s)"
echo ""
if [ "$violations" -gt 0 ]; then
  echo "❌ SE README check: ${violations} violation(s)${wsuffix}."
  echo "   Fix: give each new SE a canonical SE-<n>-<name>/{README.md (+ \`\`\`mermaid), test.sh}."
  echo "   Scaffold one: bash server-config/scripts/new-se.sh <suite> <NN> <kebab-name> [--root <repo>]"
  echo "   Convention:  server-config/docs/setpoint-eval-conventions.md"
  exit 1
fi
gsuffix=""; [ "$warns" -gt 0 ] && gsuffix=" (${warns} legacy warning(s))"
echo "✅ SE README check passed${gsuffix}."
exit 0
