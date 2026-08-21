#!/bin/bash
################################################################################
# Parallel Sweep Runner
#
# Tests different --max-parallel values to find the optimal concurrency level
# for the current environment. Runs the full SE suite at each level and
# reports a comparison table.
#
# Usage:
#   ./setpoint-evals/run-parallel-sweep.sh [OPTIONS]
#
# Options:
#   --values "4 6 8 10 0"   Space-separated max-parallel values to test (0=unlimited)
#   --runs-per-value N       Runs per value (default: 2)
#   --all-workflows          Include workflow SEs (default: core only)
#   --help                   Show this help
#
# Example:
#   ./setpoint-evals/run-parallel-sweep.sh --values "4 6 8 12" --runs-per-value 3 --all-workflows
#
################################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
VALUES="4 6 8 10 0"
RUNS_PER_VALUE=2
ALL_WORKFLOWS=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --values)
      VALUES="$2"
      shift 2
      ;;
    --runs-per-value)
      RUNS_PER_VALUE="$2"
      shift 2
      ;;
    --all-workflows)
      ALL_WORKFLOWS=true
      shift
      ;;
    --help)
      sed -n '3,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Build base command
BASE_CMD="$SCRIPT_DIR/run-all.sh --skip-checks --skip-purge"
if [ "$ALL_WORKFLOWS" = true ]; then
  BASE_CMD="$BASE_CMD --all-workflows"
fi

# Results tracking
declare -A SWEEP_RESULTS  # "value:run" -> "pass_count/total"
declare -A SWEEP_DURATIONS  # "value:run" -> seconds

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              PARALLEL SWEEP - FIND OPTIMAL CONCURRENCY           ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Values to test: $VALUES${NC}"
echo -e "${BLUE}║  Runs per value: $RUNS_PER_VALUE${NC}"
echo -e "${BLUE}║  Include workflows: $ALL_WORKFLOWS${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

TOTAL_RUNS=0
for val in $VALUES; do
  TOTAL_RUNS=$((TOTAL_RUNS + RUNS_PER_VALUE))
done
CURRENT_RUN=0

# Results arrays for final report
declare -a ALL_VALUES
declare -A VALUE_PASSES
declare -A VALUE_TOTAL_RUNS
declare -A VALUE_TOTAL_DURATION

for val in $VALUES; do
  ALL_VALUES+=("$val")
  VALUE_PASSES[$val]=0
  VALUE_TOTAL_RUNS[$val]=0
  VALUE_TOTAL_DURATION[$val]=0

  val_display=$val
  if [ "$val" = "0" ]; then
    val_display="unlimited"
  fi

  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  Testing --max-parallel=$val_display${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  for run in $(seq 1 $RUNS_PER_VALUE); do
    CURRENT_RUN=$((CURRENT_RUN + 1))
    VALUE_TOTAL_RUNS[$val]=$((${VALUE_TOTAL_RUNS[$val]} + 1))

    echo -e "  ${BLUE}Run $run/$RUNS_PER_VALUE (overall $CURRENT_RUN/$TOTAL_RUNS) at $(date '+%H:%M:%S')${NC}"

    run_start=$(date +%s)

    # Run the suite
    run_cmd="$BASE_CMD --max-parallel=$val"
    if $run_cmd > /tmp/sweep-run-${val}-${run}.log 2>&1; then
      run_status="PASS"
      VALUE_PASSES[$val]=$((${VALUE_PASSES[$val]} + 1))
    else
      run_status="FAIL"
    fi

    run_end=$(date +%s)
    run_duration=$((run_end - run_start))
    VALUE_TOTAL_DURATION[$val]=$((${VALUE_TOTAL_DURATION[$val]} + run_duration))

    # Extract pass/fail counts from the latest results
    if [ "$ALL_WORKFLOWS" = true ]; then
      latest_core=$(ls -t "$SCRIPT_DIR/.results/parallel/" 2>/dev/null | head -1)
      core_summary=""
      if [ -n "$latest_core" ] && [ -f "$SCRIPT_DIR/.results/parallel/$latest_core/analysis_report.log" ]; then
        core_summary=$(grep -oP "PASSED:\s+\K\d+" "$SCRIPT_DIR/.results/parallel/$latest_core/analysis_report.log" | head -1)
        core_total=$(grep -oP "Total:\s+\K[0-9m]+s" "$SCRIPT_DIR/.results/parallel/$latest_core/analysis_report.log" | head -1)
      fi
    fi

    if [ "$run_status" = "PASS" ]; then
      echo -e "    ${GREEN}PASS${NC} (${run_duration}s)"
    else
      echo -e "    ${RED}FAIL${NC} (${run_duration}s)"
    fi

    # Brief cooldown between runs
    if [ $run -lt $RUNS_PER_VALUE ] || [ "$val" != "$(echo $VALUES | awk '{print $NF}')" ]; then
      sleep 5
    fi
  done

  echo ""
done

# Final report
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    PARALLEL SWEEP RESULTS                        ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════════╣${NC}"
printf "${BLUE}║  %-14s │ %-8s │ %-12s │ %-15s ║${NC}\n" "max-parallel" "Pass %" "Passes" "Avg Duration"
echo -e "${BLUE}╠════════════════════════════════════════════════════════════════════╣${NC}"

BEST_VALUE=""
BEST_RATE=0

for val in "${ALL_VALUES[@]}"; do
  passes=${VALUE_PASSES[$val]}
  total=${VALUE_TOTAL_RUNS[$val]}
  total_dur=${VALUE_TOTAL_DURATION[$val]}

  if [ $total -gt 0 ]; then
    rate=$((passes * 100 / total))
    avg_dur=$((total_dur / total))
  else
    rate=0
    avg_dur=0
  fi

  val_display=$val
  if [ "$val" = "0" ]; then
    val_display="unlimited"
  fi

  if [ $rate -ge $BEST_RATE ]; then
    # Prefer higher rate, then faster avg duration for ties
    if [ $rate -gt $BEST_RATE ] || [ -z "$BEST_VALUE" ] || [ $avg_dur -lt $BEST_AVG_DUR ]; then
      BEST_VALUE=$val
      BEST_RATE=$rate
      BEST_AVG_DUR=$avg_dur
    fi
  fi

  if [ $rate -eq 100 ]; then
    color=$GREEN
  elif [ $rate -ge 80 ]; then
    color=$YELLOW
  else
    color=$RED
  fi

  printf "${color}║  %-14s │ %5d%%  │ %3d/%-3d      │ %6ds          ║${NC}\n" \
    "$val_display" "$rate" "$passes" "$total" "$avg_dur"
done

echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

best_display=$BEST_VALUE
if [ "$BEST_VALUE" = "0" ]; then
  best_display="unlimited"
fi

echo -e "${GREEN}Recommendation: --max-parallel=$best_display (${BEST_RATE}% success rate, ${BEST_AVG_DUR}s avg)${NC}"
echo ""
echo "To apply:"
echo "  ./setpoint-evals/run-all.sh --max-parallel=$BEST_VALUE --all-workflows"
echo ""
