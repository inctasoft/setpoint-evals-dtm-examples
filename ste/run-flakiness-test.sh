#!/bin/bash
################################################################################
# Flakiness Test Runner
#
# Runs the full E2E test suite 10 times with 10 second intervals to gather
# statistical data on test flakiness.
#
# Usage:
#   ./ste/run-flakiness-test.sh
#
# Results will be stored in .results/parallel/ with timestamps
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NUM_RUNS=${1:-10}
INTERVAL=${2:-10}

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              FLAKINESS TEST - $NUM_RUNS CONSECUTIVE RUNS              ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║  Interval between runs: ${INTERVAL}s                                    ║"
echo "║  Results: .results/parallel/<timestamp>/                           ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

START_TIME=$(date +%s)

for i in $(seq 1 $NUM_RUNS); do
  RUN_START=$(date +%s)

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  RUN $i of $NUM_RUNS - Started at $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Run the test suite with --skip-purge to preserve all artifacts for analysis
  ./run-all.sh --parallel --skip-checks --skip-purge 2>&1 | tee -a "/tmp/flakiness-run-$i.log" | tail -20

  RUN_END=$(date +%s)
  RUN_DURATION=$((RUN_END - RUN_START))

  echo ""
  echo "  Run $i completed in ${RUN_DURATION}s"

  # Don't sleep after the last run
  if [ $i -lt $NUM_RUNS ]; then
    echo "  Waiting ${INTERVAL}s before next run..."
    sleep $INTERVAL
  fi
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                    FLAKINESS TEST COMPLETE                        ║"
echo "╠════════════════════════════════════════════════════════════════════╣"
echo "║  Total runs: $NUM_RUNS                                                 ║"
echo "║  Total time: ${TOTAL_DURATION}s                                              ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "To analyze results, run:"
echo "  ./analyze-results.sh .results/parallel/"
echo ""
echo "Or manually check the most recent directories:"
echo "  ls -lt .results/parallel/ | head -$((NUM_RUNS + 1))"
echo ""
