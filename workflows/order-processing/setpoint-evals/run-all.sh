#!/usr/bin/env bash
# Delegates to the SAME core SE runner (SE Conventions v2 — no forked runner) — see
# server-config/docs/setpoint-eval-conventions.md. This suite's SE-<NN>-<name>/ dirs
# are discovered and executed by setpoint-evals/run-all.sh via --dir.
#
# Defaults to --in-band (sequential): these SEs share the SAME core dtm_jobs/dtm_steps
# tables (and, for feature-flag SEs, process-wide env) with every other suite and were
# never verified under concurrent execution — pass --parallel explicitly to opt in.
set -e
SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_RUNNER="$(cd "$SUITE_DIR/../../../setpoint-evals" && pwd)/run-all.sh"
exec bash "$CORE_RUNNER" --dir "$SUITE_DIR" --in-band "$@"
