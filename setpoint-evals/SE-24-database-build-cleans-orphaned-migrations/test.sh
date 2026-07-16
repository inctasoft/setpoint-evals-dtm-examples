#!/usr/bin/env bash
# Asserts packages/database's build script cannot leave ORPHANED compiled
# migration files behind in dist/migrations/ — the exact bug that broke a
# fresh bring-up on an aged checkout (Fix 4c, 2026-07-17): dist/ is
# gitignored and `"build": "tsc"` alone never deletes stale outputs, so 11
# compiled .js files from the pre-consolidation multi-migration history
# (packages/database/dist/migrations/1765443716000-InitialMigrationSchema.js
# .. 1765443726000-RenameChildEntityIdToChildItemId.js) survived the Phase 2a
# "single schema source of truth" consolidation down to one
# InitialSchema1784147958000.ts. typeorm.config.ts's migrations glob
# (`dist/migrations/*.js`) picked up ALL 12 files and ran them in timestamp
# order — the old ones sort first (smaller epoch), recreate job_status_enum
# etc, then the real InitialSchema migration tries to CREATE TYPE again and
# Postgres 42710s (DefineEnum, "type already exists"). SE-14 cannot catch
# this itself: both its Path A (bootstrap) and Path B (fresh migrate) read
# the SAME dist/migrations/*.js glob, so stale dist corrupts them
# identically — there is no differential signal. This SE guards the build
# step directly instead, in an isolated scratch copy (never touches the
# real packages/database/dist any other SE or the running stack depends on).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

DB_PKG="$ROOT/packages/database"
# Scratch copy lives INSIDE packages/ (same nesting depth as packages/database)
# so tsc's node resolution still walks up to the repo's hoisted root
# node_modules (.npmrc: node-linker=hoisted) — packages/database's own
# tsconfig.json has no "extends", so a same-depth sibling copy is safe.
SCRATCH="$ROOT/packages/.se24-scratch-$$"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

[ -d "$DB_PKG/src" ] || se_skip "packages/database/src not found"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cp -r "$DB_PKG/src" "$DB_PKG/tsconfig.json" "$DB_PKG/package.json" "$SCRATCH/"

# Seed dist/migrations with a REAL orphan artifact (a genuine pre-consolidation
# compiled migration, byte-identical to what the Phase 2a refactor actually
# left behind) plus an unrelated stray file, simulating the aged-checkout
# state a plain `tsc` re-compile would never clean up.
mkdir -p "$SCRATCH/dist/migrations"
cat > "$SCRATCH/dist/migrations/1765443716000-InitialMigrationSchema.js" <<'ORPHAN_EOF'
"use strict";
// Minimal stand-in for the real pre-consolidation compiled migration this SE
// guards against — only needs to exist as a file under dist/migrations/ for
// the orphan-survival assertion; its content is never executed by this SE.
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitialMigrationSchema1765443716000 = class {};
ORPHAN_EOF
touch "$SCRATCH/dist/migrations/.stray-marker"

BUILD_CMD="$(node -e "console.log(require('$SCRATCH/package.json').scripts.build)")"

# --- act: run the REAL build script (as defined in package.json TODAY) -----
# PATH must put the WORKSPACE-local node_modules/.bin (pnpm's own tsc, the
# pinned version) ahead of any global tsc — pnpm's own script runner does
# this automatically; a bare `npx tsc`/eval from a scratch dir does not, and
# a different global tsc version can report unrelated false errors that have
# nothing to do with the orphan-cleanup behavior this SE actually guards.
( cd "$SCRATCH" && PATH="$ROOT/node_modules/.bin:$PATH" eval "$BUILD_CMD" ) >"$SCRATCH.buildlog" 2>&1
BUILD_RC=$?
[ "$BUILD_RC" -eq 0 ] || { log_fail "build exited $BUILD_RC — see below"; tail -n 30 "$SCRATCH.buildlog"; }

ORPHAN_SURVIVED=0
[ -f "$SCRATCH/dist/migrations/1765443716000-InitialMigrationSchema.js" ] && ORPHAN_SURVIVED=1
STRAY_SURVIVED=0
[ -f "$SCRATCH/dist/migrations/.stray-marker" ] && STRAY_SURVIVED=1

# --- assert (1:1 with the README checkbox list) ----------------------------
ck   "build script (package.json \"build\") ran cleanly"               test "$BUILD_RC" -eq 0
ck   "build produced the current InitialSchema migration"              test -f "$SCRATCH/dist/migrations/"*"-InitialSchema.js"
ck_eq "pre-consolidation orphan migration .js does NOT survive build"  "$ORPHAN_SURVIVED" "0"
ck_eq "unrelated stray file under dist/migrations does NOT survive build" "$STRAY_SURVIVED" "0"
ck_file_has "build script cleans dist before compiling (static guard)" "$SCRATCH/package.json" '"build":.*(rm -rf dist|pnpm run clean|npm run clean)'

rm -f "$SCRATCH.buildlog"
se_summary
