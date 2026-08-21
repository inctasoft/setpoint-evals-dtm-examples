#!/usr/bin/env bash
# validate-se-readmes.sh — closed-loop enforcement of the canonical Setpoint Eval layout:
# every SE carries a README.md that CONTAINS a mermaid diagram.
#
# WHY: the "per-SE README always" rule was open-loop (an instruction) and got dropped once
# without anyone noticing. This is the mechanical backstop so it can't silently happen again.
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
#   --base <ref>            base ref for the diff.
#                           GIVEN → must be non-empty AND resolve to a commit, and the diff
#                             itself must succeed, or the script REFUSES with exit 2. A caller
#                             that failed to resolve a base must not get a silent pass.
#                           OMITTED → legacy behavior, unchanged: defaults to origin/main (else
#                             main) and stays lenient if that default does not resolve.
#                           Unspecified ≠ specified-as-nothing. The asymmetry is deliberate:
#                           fail-closed is scoped to callers that PASS a base (CI, which gates
#                           main), so the flag-omitting callers — the /plan and /docs-update
#                           skills, akb-evals, new-se, preflight-authoring-gates, and the copies
#                           sync-se-tooling.sh pushes into sibling repos — are untouched.
#   --root <dir>            repo root to operate in (default: cwd).
#
# EXIT: 0 = compliant, 1 = violation(s) (prints them).
set -uo pipefail

BASE=""; BASE_GIVEN=0; ALL=0; ROOT="."; MODE="diff"; declare -a EXPLICIT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all)   ALL=1; MODE="all" ;;
    --base)  BASE="$2"; BASE_GIVEN=1; shift ;;
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
    # AN EXPLICIT --base MUST RESOLVE — an unresolvable one is an ERROR, never "nothing changed".
    # Measured specimens this closes (fold-3 lane, 2026-08-04):
    #   --base ''       → fell through to the origin/main default, i.e. SILENTLY SUBSTITUTED a
    #                     base the caller never asked for and reported the substitute as its own.
    #   --base deadbeef… → the diff failed, its stderr was swallowed by 2>/dev/null, the file list
    #                     came back empty, and this gate printed "nothing to check" + EXIT 0 while
    #                     naming the bogus sha. A VACUOUS PASS: a required check validating nothing.
    # Reachable from any caller that fails to resolve a base — ci.yml's merge_group expansion is
    # just the first one found. OMITTING --base entirely keeps the origin/main default: that is a
    # deliberate local-dev convenience, and the distinction between "unspecified" and "specified
    # as nothing" is the whole point of BASE_GIVEN.
    if [ "$BASE_GIVEN" -eq 1 ]; then
      if [ -z "$BASE" ]; then
        echo "❌ --base was given but is EMPTY. Refusing: an empty base silently becomes origin/main," >&2
        echo "   so the gate would validate a diff nobody asked for and call it a pass." >&2
        exit 2
      fi
      if ! git -C "$ROOT" rev-parse --verify -q "${BASE}^{commit}" >/dev/null 2>&1; then
        echo "❌ --base '$BASE' does not resolve to a commit in $ROOT. Refusing rather than" >&2
        echo "   reporting 'nothing to check': an unresolvable base makes this gate pass vacuously." >&2
        exit 2
      fi
      # Explicit path only: the diff's own exit status is a hard error too. With the base verified
      # above it should not fail — but swallowing it is exactly how the vacuous pass was built.
      if ! diff_out="$(git -C "$ROOT" diff --name-only --diff-filter=A "$BASE"...HEAD 2>&1)"; then
        echo "❌ git diff against base '$BASE' FAILED: $diff_out" >&2
        exit 2
      fi
    else
      # LEGACY DEFAULT PATH — byte-for-byte the pre-2026-08-04 behavior, deliberately.
      # The fail-closed change above is scoped to callers that PASS a base (CI, which is what
      # gates main). Extending it here would change behavior for every caller that omits the flag
      # — the /plan and /docs-update skills, akb-evals, new-se, preflight, and the copies
      # sync-se-tooling.sh pushes into sibling repos — in situations that have nothing to do with
      # merge_group. CI caught the overreach: on a runner whose `git init` defaults to `master`,
      # neither origin/main nor main resolves, and the stricter version exited 2 on a path whose
      # documented contract is "fall back to a default". An unresolvable DEFAULT is still a latent
      # vacuous pass; it is filed as the wider finding on #758, not fixed inside this lane.
      [ -z "$BASE" ] && { git -C "$ROOT" rev-parse --verify -q origin/main >/dev/null 2>&1 && BASE="origin/main" || BASE="main"; }
      diff_out="$(git -C "$ROOT" diff --name-only --diff-filter=A "$BASE"...HEAD 2>/dev/null)" || true
    fi
    added=(); while IFS= read -r _l; do [ -n "$_l" ] && added+=("$_l"); done <<< "$diff_out"
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
  echo "   Scaffold one: copy an existing canonical SE-<n>-<name>/ directory as a starting point."
  echo "   Convention:  mirror the header fields (Timeout, Isolation, Expected outcome) of an existing SE README."
  exit 1
fi
gsuffix=""; [ "$warns" -gt 0 ] && gsuffix=" (${warns} legacy warning(s))"
echo "✅ SE README check passed${gsuffix}."
exit 0
