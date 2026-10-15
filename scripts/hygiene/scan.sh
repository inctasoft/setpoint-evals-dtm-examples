#!/bin/bash
# scripts/hygiene/scan.sh — public-repo vocabulary hygiene gate.
#
# Detects denylisted (private, client-identifying) vocabulary in new content
# without ever storing or printing the plaintext tokens themselves. The
# denylist lives ONLY as salted sha256 hashes in scripts/hygiene/denylist.sha256
# (a private repo is the source of truth for the plaintext list). The actual
# extraction + hashing engine is scripts/hygiene/scan.js (Node) — hashing
# every candidate token via a forked `sha256sum` process does not scale past
# a handful of files, so the hot path runs in-process instead.
#
# Usage:
#   scan.sh --self-test          Prove the gate can actually fail (canary check), in file, diff
#                                and tree modes
#   scan.sh --tree               Scan every git-tracked file of the repo in the cwd (full content)
#   scan.sh                      Read a unified diff from stdin, scan added lines
#   scan.sh <file> [<file> ...]  Scan the full content of each given file
#
# Exit codes:
#   0 - clean (or self-test passed)
#   1 - denylisted token found (or self-test failed to detect the canary)
#   2 - usage / setup error (missing hash file, bad hash file format, no node)
#
# IMPORTANT: this script's own source contains the literal string
# "hygiene-canary-x7q3" (in the --self-test fixture below). That string is
# baked into scripts/hygiene/denylist.sha256 BY DESIGN so --self-test can
# prove detection works. It is the ONLY place outside the hash file where
# that literal may exist. Because of that, the scan engine (scan.js) MUST
# exclude scan.sh's own path when scanning a diff or file list — otherwise
# every CI run on a PR that touches this file would flag itself.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/scan.js"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to run the hygiene scan engine ($ENGINE)" >&2
  exit 2
fi

if [ ! -f "$ENGINE" ]; then
  echo "ERROR: hygiene scan engine not found at $ENGINE" >&2
  exit 2
fi

if [ "${1:-}" = "--self-test" ]; then
  echo "Running hygiene scan self-test (canary detection)..."
  # This literal is intentionally the only place outside denylist.sha256
  # (as a hash) where the canary string may appear in this repo.
  FIXTURE_LINE="const canary = 'hygiene-canary-x7q3'; // must be detected"
  TMP_FIXTURE="$(mktemp -d)/self-test-fixture.txt"
  printf '%s\n' "$FIXTURE_LINE" > "$TMP_FIXTURE"
  set +e
  OUTPUT="$(node "$ENGINE" --files "$TMP_FIXTURE" 2>&1)"
  STATUS=$?
  set -e
  rm -rf "$(dirname "$TMP_FIXTURE")"
  if ! { [ "$STATUS" -eq 1 ] && printf '%s' "$OUTPUT" | grep -q "REDACTED token match"; }; then
    echo "❌ Self-test FAILED: canary was NOT detected (gate is broken)." >&2
    printf '%s\n' "$OUTPUT" >&2
    exit 1
  fi
  echo "✅ file mode: canary was detected (gate can fail)."

  # Tree mode must-fail control. A throwaway git repo plants the canary where ONLY a full scan finds
  # it, and each is asserted by its exact location: a scanner that reads partial content, skips
  # nested directories or ignores paths cannot pass. (A canary on line 1 of a top-level file
  # alone would pass a scanner that reads just the first line of each file.)
  #   - top-level line 1, a DEEP line (350) of a nested file, and a canary in a file NAME only.
  # The same repo holding only a clean file must PASS (a gate that always fails proves nothing).
  TREE_DIR="$(mktemp -d)"
  CANARY_WORD="${FIXTURE_LINE#*\'}"; CANARY_WORD="${CANARY_WORD%%\'*}"
  git -C "$TREE_DIR" init -q
  printf '%s\n' "$FIXTURE_LINE" > "$TREE_DIR/planted.txt"
  mkdir -p "$TREE_DIR/a/b/c"
  { for _i in $(seq 1 349); do echo "filler line $_i"; done; printf '%s\n' "$FIXTURE_LINE"; } > "$TREE_DIR/a/b/c/deep.txt"
  printf 'innocent content\n' > "$TREE_DIR/$CANARY_WORD.txt"
  git -C "$TREE_DIR" add -A
  set +e
  OUTPUT="$(cd "$TREE_DIR" && node "$ENGINE" --tree 2>&1)"
  STATUS=$?
  set -e
  TREE_OK=1
  [ "$STATUS" -eq 1 ] || TREE_OK=0
  for want in "planted.txt:1: REDACTED token match" \
              "a/b/c/deep.txt:350: REDACTED token match" \
              "$CANARY_WORD.txt (path): REDACTED token match"; do
    printf '%s\n' "$OUTPUT" | grep -qF -- "$want" || { TREE_OK=0; echo "   missing expected report: $want" >&2; }
  done
  if [ "$TREE_OK" -ne 1 ]; then
    echo "❌ Self-test FAILED: tree mode did NOT flag every planted fixture (gate is broken)." >&2
    printf '%s\n' "$OUTPUT" >&2
    rm -rf "${TREE_DIR:?}"
    exit 1
  fi
  echo "✅ tree mode: top-level line 1, nested deep line 350 and path-only canaries all detected."
  git -C "$TREE_DIR" rm -q -r -f --cached . 
  printf 'nothing to see here\n' > "$TREE_DIR/clean.txt"
  git -C "$TREE_DIR" add clean.txt
  set +e
  OUTPUT="$(cd "$TREE_DIR" && node "$ENGINE" --tree 2>&1)"
  STATUS=$?
  set -e
  rm -rf "${TREE_DIR:?}"
  if [ "$STATUS" -ne 0 ]; then
    echo "❌ Self-test FAILED: tree mode flagged a clean tree (gate is stuck red)." >&2
    printf '%s\n' "$OUTPUT" >&2
    exit 1
  fi
  echo "✅ tree mode: clean tree passes."
  echo "✅ Self-test PASSED."
  exit 0
fi

if [ "${1:-}" = "--tree" ]; then
  exec node "$ENGINE" --tree
fi

if [ "$#" -gt 0 ]; then
  exec node "$ENGINE" --files "$@"
else
  exec node "$ENGINE" --diff
fi
