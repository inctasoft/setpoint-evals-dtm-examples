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
#   scan.sh --self-test          Prove the gate can actually fail (canary check)
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
  if [ "$STATUS" -eq 1 ] && printf '%s' "$OUTPUT" | grep -q "REDACTED token match"; then
    echo "✅ Self-test PASSED: canary was detected (gate can fail)."
    exit 0
  else
    echo "❌ Self-test FAILED: canary was NOT detected (gate is broken)." >&2
    printf '%s\n' "$OUTPUT" >&2
    exit 1
  fi
fi

if [ "$#" -gt 0 ]; then
  exec node "$ENGINE" --files "$@"
else
  exec node "$ENGINE" --diff
fi
