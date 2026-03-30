#!/bin/bash

# E2E Test Results Analyzer
# Analyzes log files and provides summary of execution status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_BASE="$SCRIPT_DIR/.results/parallel"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
ANALYZE_ALL=false
ANALYZE_STATS=false
ANALYZE_COMPARE=false
COMPARE_DIR1=""
COMPARE_DIR2=""
RESULTS_DIR=""

show_usage() {
  echo "Usage: $0 [options] [results-directory]"
  echo ""
  echo "Options:"
  echo "  --all                    Analyze all runs in the directory and produce a summary report"
  echo "  --stats                  Comprehensive cross-run statistics: timing, flakiness, failure details"
  echo "  --compare <dir1> <dir2>  Compare two runs side-by-side (uses results.json if available)"
  echo "  --help                   Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                              # Analyze most recent run"
  echo "  $0 .results/parallel/           # Analyze most recent run in directory"
  echo "  $0 --all .results/parallel/     # Analyze ALL runs and show summary"
  echo "  $0 --stats                      # Full statistics across all runs"
  echo "  $0 --stats .results/parallel/   # Full statistics for specific directory"
  echo "  $0 --compare .results/parallel/run1 .results/parallel/run2"
  echo ""
  echo "Available results:"
  find "$RESULTS_BASE" -maxdepth 1 -type d -name "2*" 2>/dev/null | sort -r | head -5
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --all)
      ANALYZE_ALL=true
      shift
      ;;
    --stats)
      ANALYZE_STATS=true
      shift
      ;;
    --compare)
      ANALYZE_COMPARE=true
      shift
      if [[ $# -ge 2 ]]; then
        COMPARE_DIR1="$1"
        COMPARE_DIR2="$2"
        shift 2
      elif [[ $# -eq 0 ]]; then
        # No args: compare two most recent runs
        COMPARE_DIR1=""
        COMPARE_DIR2=""
      else
        echo "Error: --compare requires 0 or 2 arguments"
        echo "  $0 --compare                    # Compare two most recent runs"
        echo "  $0 --compare <dir1> <dir2>      # Compare specific runs"
        exit 1
      fi
      ;;
    --help|-h)
      show_usage
      exit 0
      ;;
    *)
      RESULTS_DIR="$1"
      shift
      ;;
  esac
done

###############################################################################
# COMPARE TWO RUNS MODE (--compare)
###############################################################################

if [ "$ANALYZE_COMPARE" = true ]; then
  # Resolve directories: if none given, use two most recent
  if [ -z "$COMPARE_DIR1" ] || [ -z "$COMPARE_DIR2" ]; then
    RECENT_DIRS=$(find "$RESULTS_BASE" -maxdepth 1 -type d -name "2*" | sort -r | head -2)
    RECENT_COUNT=$(echo "$RECENT_DIRS" | grep -c . || echo 0)
    if [ "$RECENT_COUNT" -lt 2 ]; then
      echo -e "${RED}Need at least 2 runs to compare. Found: $RECENT_COUNT${NC}"
      exit 1
    fi
    COMPARE_DIR1=$(echo "$RECENT_DIRS" | tail -1)  # older
    COMPARE_DIR2=$(echo "$RECENT_DIRS" | head -1)  # newer
  fi

  # Validate directories exist
  if [ ! -d "$COMPARE_DIR1" ]; then
    echo -e "${RED}Directory not found: $COMPARE_DIR1${NC}"; exit 1
  fi
  if [ ! -d "$COMPARE_DIR2" ]; then
    echo -e "${RED}Directory not found: $COMPARE_DIR2${NC}"; exit 1
  fi

  RUN1_NAME=$(basename "$COMPARE_DIR1")
  RUN2_NAME=$(basename "$COMPARE_DIR2")

  echo ""
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}          CROSS-RUN COMPARISON REPORT${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  echo -e "  Run A (baseline): ${BLUE}$RUN1_NAME${NC}"
  echo -e "  Run B (current):  ${BLUE}$RUN2_NAME${NC}"
  echo ""

  # Helper: extract eval data from a run directory
  # Prefers results.json, falls back to log parsing
  extract_run_data() {
    local run_dir="$1"
    local prefix="$2"  # "A" or "B"

    if [ -f "$run_dir/results.json" ]; then
      # Use jq to parse JSON results
      local eval_count
      eval_count=$(jq '.evals | length' "$run_dir/results.json" 2>/dev/null || echo 0)

      for i in $(seq 0 $((eval_count - 1))); do
        local eid result duration
        eid=$(jq -r ".evals[$i].id" "$run_dir/results.json")
        result=$(jq -r ".evals[$i].result" "$run_dir/results.json")
        duration=$(jq -r ".evals[$i].durationSeconds" "$run_dir/results.json")
        eval "${prefix}_RESULT_${eid}=\"$result\""
        eval "${prefix}_DURATION_${eid}=\"$duration\""
        eval "${prefix}_EVALS=\"\${${prefix}_EVALS:-} $eid\""
      done

      # Summary
      eval "${prefix}_PASSED=$(jq '.summary.passed' "$run_dir/results.json")"
      eval "${prefix}_FAILED=$(jq '.summary.failed' "$run_dir/results.json")"
      eval "${prefix}_TOTAL_DURATION=$(jq '.totalDurationSeconds' "$run_dir/results.json")"
    else
      # Fallback: parse log files
      for log_file in "$run_dir"/[0-9]*.log; do
        [ ! -f "$log_file" ] && continue
        local filename eid last_line status duration
        filename=$(basename "$log_file")
        eid=$(echo "$filename" | grep -oE '^[0-9]+' | head -1)
        [ -z "$eid" ] && continue

        last_line=$(tail -n 1 "$log_file" 2>/dev/null || echo "")
        status="UNKNOWN"
        duration=0

        if echo "$last_line" | grep -q "^PASS:"; then
          status="PASS"
          duration=$(echo "$last_line" | cut -d':' -f2)
        elif echo "$last_line" | grep -q "^FAIL:"; then
          status="FAIL"
          duration=$(echo "$last_line" | cut -d':' -f2)
        elif echo "$last_line" | grep -q "^TIMEOUT:"; then
          status="TIMEOUT"
          duration=$(echo "$last_line" | cut -d':' -f2)
        elif grep -qE "ALL TESTS PASSED|PASSED|TEST PASSED" "$log_file" 2>/dev/null; then
          status="PASS"
        elif grep -qE "FAIL|timed out" "$log_file" 2>/dev/null; then
          status="FAIL"
        fi

        eval "${prefix}_RESULT_${eid}=\"$status\""
        eval "${prefix}_DURATION_${eid}=\"$duration\""
        eval "${prefix}_EVALS=\"\${${prefix}_EVALS:-} $eid\""
      done
    fi
  }

  A_EVALS=""
  B_EVALS=""
  extract_run_data "$COMPARE_DIR1" "A"
  extract_run_data "$COMPARE_DIR2" "B"

  # Merge eval IDs
  ALL_EVALS=$(echo "$A_EVALS $B_EVALS" | tr ' ' '\n' | sort -u | sort -n)

  # Print comparison table
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  PER-EVAL COMPARISON${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  printf "  %-5s  %-10s  %-10s  %-8s  %-8s  %-8s  %s\n" \
    "Eval" "Run A" "Run B" "A Time" "B Time" "Delta" "Change"
  printf "  %-5s  %-10s  %-10s  %-8s  %-8s  %-8s  %s\n" \
    "-----" "----------" "----------" "--------" "--------" "--------" "----------"

  REGRESSIONS=0
  FIXES=0
  SAME=0
  TOTAL_DELTA=0

  for eid in $ALL_EVALS; do
    [ -z "$eid" ] && continue

    a_result=$(eval echo "\${A_RESULT_${eid}:-N/A}")
    b_result=$(eval echo "\${B_RESULT_${eid}:-N/A}")
    a_dur=$(eval echo "\${A_DURATION_${eid}:-0}")
    b_dur=$(eval echo "\${B_DURATION_${eid}:-0}")

    # Ensure durations are numeric
    a_dur="${a_dur//[^0-9]/}"
    b_dur="${b_dur//[^0-9]/}"
    a_dur="${a_dur:-0}"
    b_dur="${b_dur:-0}"

    # Calculate delta
    delta=$((b_dur - a_dur))
    TOTAL_DELTA=$((TOTAL_DELTA + delta))
    if [ "$delta" -gt 0 ]; then
      delta_str="+${delta}s"
    elif [ "$delta" -lt 0 ]; then
      delta_str="${delta}s"
    else
      delta_str="0s"
    fi

    # Determine change
    change=""
    change_color="${NC}"
    a_pass=false
    b_pass=false
    [[ "$a_result" == "PASS" || "$a_result" == "PASSED" ]] && a_pass=true
    [[ "$b_result" == "PASS" || "$b_result" == "PASSED" ]] && b_pass=true

    if [ "$a_pass" = true ] && [ "$b_pass" = false ] && [ "$b_result" != "N/A" ]; then
      change="REGRESSION"
      change_color="${RED}"
      REGRESSIONS=$((REGRESSIONS + 1))
    elif [ "$a_pass" = false ] && [ "$b_pass" = true ] && [ "$a_result" != "N/A" ]; then
      change="FIXED"
      change_color="${GREEN}"
      FIXES=$((FIXES + 1))
    elif [ "$a_result" = "$b_result" ]; then
      change="-"
      SAME=$((SAME + 1))
    else
      change="CHANGED"
      change_color="${YELLOW}"
    fi

    # Color results
    a_color="${NC}"
    b_color="${NC}"
    [[ "$a_pass" = true ]] && a_color="${GREEN}" || a_color="${RED}"
    [[ "$b_pass" = true ]] && b_color="${GREEN}" || b_color="${RED}"
    [[ "$a_result" = "N/A" ]] && a_color="${YELLOW}"
    [[ "$b_result" = "N/A" ]] && b_color="${YELLOW}"

    printf "  %-5s  ${a_color}%-10s${NC}  ${b_color}%-10s${NC}  %-8s  %-8s  %-8s  ${change_color}%s${NC}\n" \
      "$eid" "$a_result" "$b_result" "${a_dur}s" "${b_dur}s" "$delta_str" "$change"
  done

  echo ""

  # Summary
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  COMPARISON SUMMARY${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  echo -e "  Unchanged:    ${GREEN}$SAME${NC}"
  echo -e "  Regressions:  ${RED}$REGRESSIONS${NC}"
  echo -e "  Fixed:        ${GREEN}$FIXES${NC}"
  if [ "$TOTAL_DELTA" -gt 0 ]; then
    echo -e "  Total Delta:  ${YELLOW}+${TOTAL_DELTA}s (slower)${NC}"
  elif [ "$TOTAL_DELTA" -lt 0 ]; then
    echo -e "  Total Delta:  ${GREEN}${TOTAL_DELTA}s (faster)${NC}"
  else
    echo -e "  Total Delta:  0s (same)"
  fi
  echo ""

  if [ "$REGRESSIONS" -gt 0 ]; then
    echo -e "  ${RED}WARNING: $REGRESSIONS regression(s) detected!${NC}"
    echo ""
    exit 1
  fi

  exit 0
fi

###############################################################################
# COMPREHENSIVE STATISTICS MODE (--stats)
###############################################################################

if [ "$ANALYZE_STATS" = true ]; then
  # Determine the base directory to scan
  if [ -z "$RESULTS_DIR" ]; then
    SCAN_DIR="$RESULTS_BASE"
  else
    SCAN_DIR="$RESULTS_DIR"
  fi

  # Find all timestamped run directories
  ALL_RUN_DIRS=$(find "$SCAN_DIR" -maxdepth 1 -type d -name "2*" | sort)
  ALL_RUN_COUNT=$(echo "$ALL_RUN_DIRS" | grep -c . || echo 0)

  if [ "$ALL_RUN_COUNT" -eq 0 ]; then
    echo -e "${RED}No run directories found in $SCAN_DIR${NC}"
    exit 1
  fi

  # Separate complete vs incomplete runs
  COMPLETE_DIRS=""
  INCOMPLETE_DIRS=""
  COMPLETE_COUNT=0
  INCOMPLETE_COUNT=0

  for run_dir in $ALL_RUN_DIRS; do
    eval_log_count=$(ls "$run_dir"/[0-9]*.log 2>/dev/null | wc -l)
    if [ "$eval_log_count" -ge 20 ]; then
      COMPLETE_DIRS="$COMPLETE_DIRS $run_dir"
      COMPLETE_COUNT=$((COMPLETE_COUNT + 1))
    else
      INCOMPLETE_DIRS="$INCOMPLETE_DIRS $run_dir"
      INCOMPLETE_COUNT=$((INCOMPLETE_COUNT + 1))
    fi
  done

  # Date range
  FIRST_RUN=$(echo "$ALL_RUN_DIRS" | head -1 | xargs basename)
  LAST_RUN=$(echo "$ALL_RUN_DIRS" | tail -1 | xargs basename)

  echo ""
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}          COMPREHENSIVE CROSS-RUN STATISTICS REPORT${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  echo -e "${CYAN}  Scan Directory:    $SCAN_DIR${NC}"
  echo -e "${CYAN}  Total Directories: $ALL_RUN_COUNT${NC}"
  echo -e "${CYAN}  Complete Runs:     ${GREEN}$COMPLETE_COUNT${NC}"
  echo -e "${CYAN}  Incomplete Runs:   ${YELLOW}$INCOMPLETE_COUNT${CYAN} (warmup-only, no eval results)${NC}"
  echo -e "${CYAN}  Date Range:        $FIRST_RUN -> $LAST_RUN${NC}"
  echo ""

  if [ "$COMPLETE_COUNT" -eq 0 ]; then
    echo -e "${RED}No complete runs found to analyze.${NC}"
    exit 1
  fi

  # =========================================================================
  # SECTION 1: PER-RUN SUMMARY TABLE
  # =========================================================================
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  SECTION 1: PER-RUN SUMMARY${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  printf "  %-17s  %4s  %4s  %4s  %6s  %8s  %s\n" "Run Timestamp" "Pass" "Fail" "T/O" "Rate" "Duration" "Failed Evals"
  printf "  %-17s  %4s  %4s  %4s  %6s  %8s  %s\n" "-----------------" "----" "----" "----" "------" "--------" "-------------------"

  TOTAL_EVAL_PASS=0
  TOTAL_EVAL_FAIL=0
  TOTAL_EVAL_TIMEOUT=0
  TOTAL_RUNS_CLEAN=0
  TOTAL_RUNS_WITH_FAILURES=0
  RUN_DURATIONS=""

  # Per-eval tracking arrays (use temp files for portability)
  TMPDIR_STATS=$(mktemp -d)
  trap "rm -rf $TMPDIR_STATS" EXIT

  # Initialize per-eval tracking
  for e in $(seq 1 25); do
    eid=$(printf "%02d" $e)
    echo "0" > "$TMPDIR_STATS/pass_$eid"
    echo "0" > "$TMPDIR_STATS/fail_$eid"
    echo "" > "$TMPDIR_STATS/times_$eid"
    echo "" > "$TMPDIR_STATS/fail_runs_$eid"
    echo "" > "$TMPDIR_STATS/fail_details_$eid"
  done

  for run_dir in $COMPLETE_DIRS; do
    run_name=$(basename "$run_dir")
    run_pass=0
    run_fail=0
    run_timeout=0
    failed_evals=""

    # Calculate run duration from file timestamps
    first_file=$(ls -t "$run_dir"/*.log 2>/dev/null | tail -1)
    last_file=$(ls -t "$run_dir"/*.log 2>/dev/null | head -1)
    run_duration=0
    if [ -n "$first_file" ] && [ -n "$last_file" ]; then
      first_mod=$(stat -c %Y "$first_file" 2>/dev/null || echo 0)
      last_mod=$(stat -c %Y "$last_file" 2>/dev/null || echo 0)
      run_duration=$((last_mod - first_mod))
      [ "$run_duration" -lt 0 ] && run_duration=0
    fi
    RUN_DURATIONS="$RUN_DURATIONS $run_duration"

    for log_file in "$run_dir"/[0-9]*.log; do
      [ ! -f "$log_file" ] && continue
      filename=$(basename "$log_file")
      eval_id=$(echo "$filename" | grep -oE '^[0-9]+' | head -1)
      [ -z "$eval_id" ] && continue

      last_line=$(tail -n 1 "$log_file" 2>/dev/null || echo "")
      status=""
      duration=0

      if echo "$last_line" | grep -q "^PASS:"; then
        status="PASS"
        duration=$(echo "$last_line" | cut -d':' -f2)
      elif echo "$last_line" | grep -q "^FAIL:"; then
        status="FAIL"
        duration=$(echo "$last_line" | cut -d':' -f2)
      elif echo "$last_line" | grep -q "^TIMEOUT:"; then
        status="TIMEOUT"
        duration=$(echo "$last_line" | cut -d':' -f2)
      else
        if grep -qE "ALL TESTS PASSED|PASSED|TEST PASSED" "$log_file" 2>/dev/null; then
          status="PASS"
        elif grep -qE "FAIL|timed out" "$log_file" 2>/dev/null; then
          status="FAIL"
        else
          status="PASS"
        fi
      fi

      # Update run-level counts
      case "$status" in
        PASS) run_pass=$((run_pass + 1)) ;;
        FAIL) run_fail=$((run_fail + 1)); failed_evals="$failed_evals $eval_id" ;;
        TIMEOUT) run_timeout=$((run_timeout + 1)); failed_evals="$failed_evals $eval_id" ;;
      esac

      # Update per-eval tracking
      if [ "$status" = "PASS" ]; then
        cur=$(cat "$TMPDIR_STATS/pass_$eval_id" 2>/dev/null || echo 0)
        echo $((cur + 1)) > "$TMPDIR_STATS/pass_$eval_id"
      else
        cur=$(cat "$TMPDIR_STATS/fail_$eval_id" 2>/dev/null || echo 0)
        echo $((cur + 1)) > "$TMPDIR_STATS/fail_$eval_id"
        echo "$run_name" >> "$TMPDIR_STATS/fail_runs_$eval_id"
        # Grab last error line
        error_line=$(grep -E "FAIL|ERROR|timed out" "$log_file" 2>/dev/null | tail -1 | head -c 120)
        echo "  [$run_name] $status (${duration}s) - $error_line" >> "$TMPDIR_STATS/fail_details_$eval_id"
      fi

      # Track timing
      if [ -n "$duration" ] && [ "$duration" -gt 0 ] 2>/dev/null; then
        echo -n " $duration" >> "$TMPDIR_STATS/times_$eval_id"
      fi
    done

    # Run-level stats
    run_total=$((run_pass + run_fail + run_timeout))
    if [ "$run_total" -gt 0 ]; then
      pass_rate=$((run_pass * 100 / run_total))
    else
      pass_rate=0
    fi

    TOTAL_EVAL_PASS=$((TOTAL_EVAL_PASS + run_pass))
    TOTAL_EVAL_FAIL=$((TOTAL_EVAL_FAIL + run_fail))
    TOTAL_EVAL_TIMEOUT=$((TOTAL_EVAL_TIMEOUT + run_timeout))

    # Format duration
    dur_mins=$((run_duration / 60))
    dur_secs=$((run_duration % 60))
    dur_str=$(printf "%dm %02ds" "$dur_mins" "$dur_secs")

    # Format failed evals
    failed_str=$(echo "$failed_evals" | xargs | tr ' ' ',')
    [ -z "$failed_str" ] && failed_str="-"

    if [ "$run_fail" -eq 0 ] && [ "$run_timeout" -eq 0 ]; then
      TOTAL_RUNS_CLEAN=$((TOTAL_RUNS_CLEAN + 1))
      printf "  ${GREEN}%-17s${NC}  %4d  %4d  %4d  %5d%%  %8s  %s\n" \
        "$run_name" "$run_pass" "$run_fail" "$run_timeout" "$pass_rate" "$dur_str" "$failed_str"
    else
      TOTAL_RUNS_WITH_FAILURES=$((TOTAL_RUNS_WITH_FAILURES + 1))
      printf "  ${RED}%-17s${NC}  %4d  ${RED}%4d${NC}  %4d  %5d%%  %8s  ${RED}%s${NC}\n" \
        "$run_name" "$run_pass" "$run_fail" "$run_timeout" "$pass_rate" "$dur_str" "$failed_str"
    fi
  done

  echo ""

  # =========================================================================
  # SECTION 2: OVERALL STATISTICS
  # =========================================================================
  TOTAL_EVAL_EXECUTIONS=$((TOTAL_EVAL_PASS + TOTAL_EVAL_FAIL + TOTAL_EVAL_TIMEOUT))
  if [ "$TOTAL_EVAL_EXECUTIONS" -gt 0 ]; then
    OVERALL_PASS_RATE=$((TOTAL_EVAL_PASS * 10000 / TOTAL_EVAL_EXECUTIONS))
    OVERALL_PASS_PCT=$((OVERALL_PASS_RATE / 100))
    OVERALL_PASS_DEC=$((OVERALL_PASS_RATE % 100))
  else
    OVERALL_PASS_PCT=0
    OVERALL_PASS_DEC=0
  fi

  # Calculate run duration stats
  RUN_DUR_MIN=999999; RUN_DUR_MAX=0; RUN_DUR_SUM=0; RUN_DUR_COUNT=0
  for d in $RUN_DURATIONS; do
    [ "$d" -lt "$RUN_DUR_MIN" ] && RUN_DUR_MIN=$d
    [ "$d" -gt "$RUN_DUR_MAX" ] && RUN_DUR_MAX=$d
    RUN_DUR_SUM=$((RUN_DUR_SUM + d))
    RUN_DUR_COUNT=$((RUN_DUR_COUNT + 1))
  done
  [ "$RUN_DUR_COUNT" -gt 0 ] && RUN_DUR_AVG=$((RUN_DUR_SUM / RUN_DUR_COUNT)) || RUN_DUR_AVG=0

  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  SECTION 2: OVERALL STATISTICS${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  echo -e "  Complete Runs Analyzed:  $COMPLETE_COUNT"
  echo -e "  Clean Runs (all pass):   ${GREEN}$TOTAL_RUNS_CLEAN${NC}"
  echo -e "  Runs with Failures:      ${RED}$TOTAL_RUNS_WITH_FAILURES${NC}"
  if [ "$COMPLETE_COUNT" -gt 0 ]; then
    echo -e "  Run Success Rate:        $((TOTAL_RUNS_CLEAN * 100 / COMPLETE_COUNT))%"
  fi
  echo ""
  echo -e "  Total Eval Executions:   $TOTAL_EVAL_EXECUTIONS"
  echo -e "  Passed:                  ${GREEN}$TOTAL_EVAL_PASS${NC}"
  echo -e "  Failed:                  ${RED}$TOTAL_EVAL_FAIL${NC}"
  echo -e "  Timed Out:               ${YELLOW}$TOTAL_EVAL_TIMEOUT${NC}"
  echo -e "  Overall Pass Rate:       ${OVERALL_PASS_PCT}.$(printf "%02d" $OVERALL_PASS_DEC)%"
  echo ""
  echo -e "  Run Duration (min):      $((RUN_DUR_MIN / 60))m $((RUN_DUR_MIN % 60))s"
  echo -e "  Run Duration (avg):      $((RUN_DUR_AVG / 60))m $((RUN_DUR_AVG % 60))s"
  echo -e "  Run Duration (max):      $((RUN_DUR_MAX / 60))m $((RUN_DUR_MAX % 60))s"
  echo ""

  # =========================================================================
  # SECTION 3: PER-EVAL TIMING STATISTICS
  # =========================================================================
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  SECTION 3: PER-EVAL TIMING & RELIABILITY${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""
  printf "  %-7s  %5s  %5s  %5s  %5s  %5s  %8s  %s\n" \
    "Eval" "Runs" "Pass" "Fail" "Rate" "Flaky" "Avg(s)" "Min-Max(s)"
  printf "  %-7s  %5s  %5s  %5s  %5s  %5s  %8s  %s\n" \
    "-------" "-----" "-----" "-----" "-----" "-----" "--------" "----------"

  for e in $(seq 1 25); do
    eid=$(printf "%02d" $e)
    e_pass=$(cat "$TMPDIR_STATS/pass_$eid" 2>/dev/null || echo 0)
    e_fail=$(cat "$TMPDIR_STATS/fail_$eid" 2>/dev/null || echo 0)
    e_total=$((e_pass + e_fail))

    if [ "$e_total" -eq 0 ]; then
      continue
    fi

    e_rate=$((e_pass * 100 / e_total))

    # Timing stats
    times_raw=$(cat "$TMPDIR_STATS/times_$eid" 2>/dev/null)
    t_min=0; t_max=0; t_avg=0; t_count=0; t_sum=0
    for t in $times_raw; do
      [ -z "$t" ] && continue
      t_count=$((t_count + 1))
      t_sum=$((t_sum + t))
      [ "$t_count" -eq 1 ] && t_min=$t && t_max=$t
      [ "$t" -lt "$t_min" ] && t_min=$t
      [ "$t" -gt "$t_max" ] && t_max=$t
    done
    [ "$t_count" -gt 0 ] && t_avg=$((t_sum / t_count))

    # Flakiness indicator
    if [ "$e_fail" -gt 0 ] && [ "$e_pass" -gt 0 ]; then
      flaky_pct="$((e_fail * 100 / e_total))%"
      flaky_color="${YELLOW}"
    elif [ "$e_fail" -gt 0 ] && [ "$e_pass" -eq 0 ]; then
      flaky_pct="100%"
      flaky_color="${RED}"
    else
      flaky_pct="0%"
      flaky_color="${GREEN}"
    fi

    # Color for pass rate
    if [ "$e_rate" -eq 100 ]; then
      rate_color="${GREEN}"
    elif [ "$e_rate" -ge 90 ]; then
      rate_color="${YELLOW}"
    else
      rate_color="${RED}"
    fi

    printf "  %-7s  %5d  ${GREEN}%5d${NC}  ${RED}%5d${NC}  ${rate_color}%4d%%${NC}  ${flaky_color}%5s${NC}  %6ds  %d-%ds\n" \
      "$eid" "$e_total" "$e_pass" "$e_fail" "$e_rate" "$flaky_pct" "$t_avg" "$t_min" "$t_max"
  done

  echo ""

  # =========================================================================
  # SECTION 4: FAILURE DETAILS
  # =========================================================================
  HAS_FAILURES=false
  for e in $(seq 1 25); do
    eid=$(printf "%02d" $e)
    e_fail=$(cat "$TMPDIR_STATS/fail_$eid" 2>/dev/null || echo 0)
    [ "$e_fail" -gt 0 ] && HAS_FAILURES=true
  done

  if [ "$HAS_FAILURES" = true ]; then
    echo -e "${CYAN}=============================================================================${NC}"
    echo -e "${CYAN}  SECTION 4: FAILURE DETAILS${NC}"
    echo -e "${CYAN}=============================================================================${NC}"
    echo ""

    for e in $(seq 1 25); do
      eid=$(printf "%02d" $e)
      e_fail=$(cat "$TMPDIR_STATS/fail_$eid" 2>/dev/null || echo 0)
      [ "$e_fail" -eq 0 ] && continue

      e_pass=$(cat "$TMPDIR_STATS/pass_$eid" 2>/dev/null || echo 0)
      e_total=$((e_pass + e_fail))

      echo -e "  ${RED}Eval $eid: $e_fail failures out of $e_total runs ($((e_fail * 100 / e_total))% failure rate)${NC}"

      # Show failed run details
      details=$(cat "$TMPDIR_STATS/fail_details_$eid" 2>/dev/null)
      if [ -n "$details" ]; then
        echo "$details"
      fi

      # Show the actual log files for reference
      fail_runs=$(cat "$TMPDIR_STATS/fail_runs_$eid" 2>/dev/null)
      if [ -n "$fail_runs" ]; then
        echo ""
        echo -e "  ${YELLOW}Log files:${NC}"
        for fr in $fail_runs; do
          log_path=$(ls "$SCAN_DIR/$fr/${eid}_"*.log 2>/dev/null | head -1)
          [ -n "$log_path" ] && echo "    $log_path"
        done
      fi
      echo ""
    done
  else
    echo -e "  ${GREEN}No failures detected across any eval in any run.${NC}"
    echo ""
  fi

  # =========================================================================
  # SECTION 5: INCOMPLETE RUNS
  # =========================================================================
  if [ "$INCOMPLETE_COUNT" -gt 0 ]; then
    echo -e "${CYAN}=============================================================================${NC}"
    echo -e "${CYAN}  SECTION 5: INCOMPLETE RUNS ($INCOMPLETE_COUNT)${NC}"
    echo -e "${CYAN}=============================================================================${NC}"
    echo ""
    echo -e "  ${YELLOW}These directories contain only warmup logs (no eval results):${NC}"
    for inc_dir in $INCOMPLETE_DIRS; do
      inc_name=$(basename "$inc_dir")
      inc_size=$(wc -c < "$inc_dir/run.log" 2>/dev/null || echo 0)
      echo "    $inc_name  (run.log: ${inc_size} bytes)"
    done
    echo ""
  fi

  # =========================================================================
  # SECTION 6: SUMMARY & RECOMMENDATIONS
  # =========================================================================
  echo -e "${CYAN}=============================================================================${NC}"
  echo -e "${CYAN}  SUMMARY${NC}"
  echo -e "${CYAN}=============================================================================${NC}"
  echo ""

  if [ "$TOTAL_RUNS_WITH_FAILURES" -eq 0 ]; then
    echo -e "  ${GREEN}All $COMPLETE_COUNT complete runs passed all 25 evals.${NC}"
    echo -e "  ${GREEN}Overall pass rate: ${OVERALL_PASS_PCT}.$(printf "%02d" $OVERALL_PASS_DEC)%${NC}"
    echo -e "  ${GREEN}The eval suite is stable.${NC}"
  else
    echo -e "  ${YELLOW}$TOTAL_RUNS_WITH_FAILURES out of $COMPLETE_COUNT runs had failures.${NC}"
    echo -e "  ${YELLOW}Overall eval pass rate: ${OVERALL_PASS_PCT}.$(printf "%02d" $OVERALL_PASS_DEC)%${NC}"
    echo ""
    echo -e "  ${YELLOW}Flaky evals to investigate:${NC}"
    for e in $(seq 1 25); do
      eid=$(printf "%02d" $e)
      e_fail=$(cat "$TMPDIR_STATS/fail_$eid" 2>/dev/null || echo 0)
      if [ "$e_fail" -gt 0 ]; then
        e_pass=$(cat "$TMPDIR_STATS/pass_$eid" 2>/dev/null || echo 0)
        e_total=$((e_pass + e_fail))
        echo -e "    - Eval $eid: failed $e_fail/$e_total times ($((e_fail * 100 / e_total))%)"
      fi
    done
  fi

  echo ""

  # Cleanup is handled by trap
  exit 0
fi

###############################################################################
# ANALYZE ALL RUNS MODE
###############################################################################

if [ "$ANALYZE_ALL" = true ]; then
  # Determine the base directory to scan
  if [ -z "$RESULTS_DIR" ]; then
    SCAN_DIR="$RESULTS_BASE"
  else
    SCAN_DIR="$RESULTS_DIR"
  fi

  # Find all timestamped run directories
  RUN_DIRS=$(find "$SCAN_DIR" -maxdepth 1 -type d -name "2*" | sort)
  RUN_COUNT=$(echo "$RUN_DIRS" | grep -c . || echo 0)

  if [ "$RUN_COUNT" -eq 0 ]; then
    echo -e "${RED}❌ No run directories found in $SCAN_DIR${NC}"
    exit 1
  fi

  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║                                    E2E TEST RESULTS - ALL RUNS SUMMARY                                       ║${NC}"
  echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${CYAN}║  Scan Directory: $(printf "%-89s" "$SCAN_DIR") ║${NC}"
  echo -e "${CYAN}║  Total Runs: $(printf "%-93s" "$RUN_COUNT") ║${NC}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Track overall stats
  TOTAL_RUNS=0
  TOTAL_RUNS_PASSED=0
  TOTAL_RUNS_FAILED=0
  declare -a FAILED_RUNS=()
  declare -A EVAL_FAILURE_COUNT=()
  declare -A EVAL_FAILURE_DIRS=()

  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║                                              RUN SUMMARY                                                      ║${NC}"
  echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
  printf "║ %-17s │ %4s │ %4s │ %4s │ %7s │ %-60s ║\n" "Run Timestamp" "Pass" "Fail" "T/O" "Rate" "Failed Evals"
  echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"

  for run_dir in $RUN_DIRS; do
    run_name=$(basename "$run_dir")
    TOTAL_RUNS=$((TOTAL_RUNS + 1))

    # Count results in this run
    run_pass=0
    run_fail=0
    run_timeout=0
    failed_evals=""

    for log_file in "$run_dir"/*.log; do
      [ ! -f "$log_file" ] && continue
      filename=$(basename "$log_file")
      [[ ! "$filename" =~ ^[0-9] ]] && continue

      eval_id=$(echo "$filename" | cut -d'_' -f1)
      eval_name=$(echo "$filename" | cut -d'_' -f2)

      # Check status from last line
      last_line=$(tail -n 1 "$log_file" 2>/dev/null || echo "")

      if echo "$last_line" | grep -q "^PASS:"; then
        run_pass=$((run_pass + 1))
      elif echo "$last_line" | grep -q "^TIMEOUT:"; then
        run_timeout=$((run_timeout + 1))
        failed_evals="${failed_evals}${eval_id},"
        EVAL_FAILURE_COUNT[$eval_id]=$((${EVAL_FAILURE_COUNT[$eval_id]:-0} + 1))
        EVAL_FAILURE_DIRS[$eval_id]="${EVAL_FAILURE_DIRS[$eval_id]} $run_dir/$filename"
      elif echo "$last_line" | grep -q "^FAIL:"; then
        run_fail=$((run_fail + 1))
        failed_evals="${failed_evals}${eval_id},"
        EVAL_FAILURE_COUNT[$eval_id]=$((${EVAL_FAILURE_COUNT[$eval_id]:-0} + 1))
        EVAL_FAILURE_DIRS[$eval_id]="${EVAL_FAILURE_DIRS[$eval_id]} $run_dir/$filename"
      else
        # Heuristic: check for success/failure patterns
        if grep -qE "✅ ALL TESTS PASSED|🎉.*PASSED|TEST PASSED" "$log_file" 2>/dev/null; then
          run_pass=$((run_pass + 1))
        elif grep -qE "❌.*FAIL|timed out|ERROR" "$log_file" 2>/dev/null; then
          run_fail=$((run_fail + 1))
          failed_evals="${failed_evals}${eval_id},"
          EVAL_FAILURE_COUNT[$eval_id]=$((${EVAL_FAILURE_COUNT[$eval_id]:-0} + 1))
          EVAL_FAILURE_DIRS[$eval_id]="${EVAL_FAILURE_DIRS[$eval_id]} $run_dir/$filename"
        else
          run_pass=$((run_pass + 1))  # Assume pass if no failure indicators
        fi
      fi
    done

    # Calculate pass rate
    run_total=$((run_pass + run_fail + run_timeout))
    if [ $run_total -gt 0 ]; then
      pass_rate=$((run_pass * 100 / run_total))
    else
      pass_rate=0
    fi

    # Track run-level stats
    if [ $run_fail -eq 0 ] && [ $run_timeout -eq 0 ]; then
      TOTAL_RUNS_PASSED=$((TOTAL_RUNS_PASSED + 1))
      status_color="${GREEN}"
    else
      TOTAL_RUNS_FAILED=$((TOTAL_RUNS_FAILED + 1))
      FAILED_RUNS+=("$run_name")
      status_color="${RED}"
    fi

    # Format failed evals list
    failed_evals=$(echo "$failed_evals" | sed 's/,$//')
    if [ -z "$failed_evals" ]; then
      failed_evals="-"
    elif [ ${#failed_evals} -gt 58 ]; then
      failed_evals="${failed_evals:0:55}..."
    fi

    # Print row
    printf "║ ${status_color}%-17s${NC} │ %4d │ %4d │ %4d │ %5d%% │ %-60s ║\n" \
      "$run_name" "$run_pass" "$run_fail" "$run_timeout" "$pass_rate" "$failed_evals"
  done

  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Overall summary
  if [ $TOTAL_RUNS -gt 0 ]; then
    RUNS_PASS_RATE=$((TOTAL_RUNS_PASSED * 100 / TOTAL_RUNS))
  else
    RUNS_PASS_RATE=0
  fi

  echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║                                           OVERALL STATISTICS                                                  ║${NC}"
  echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
  echo -e "║ ${GREEN}✅ Fully Passed Runs:${NC} $(printf "%-3d" $TOTAL_RUNS_PASSED)    ${RED}❌ Runs with Failures:${NC} $(printf "%-3d" $TOTAL_RUNS_FAILED)    📊 Run Success Rate: $(printf "%-3d" $RUNS_PASS_RATE)%                               ║"
  echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # Show flaky evals (failed in some runs but not all)
  if [ ${#EVAL_FAILURE_COUNT[@]} -gt 0 ]; then
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                        FAILURE ANALYSIS BY EVAL                                               ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
    printf "║ %-6s │ %-10s │ %-8s │ %-82s ║\n" "Eval" "Failures" "Rate" "Failed Run Directories"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"

    # Sort by failure count (descending)
    for eval_id in $(for k in "${!EVAL_FAILURE_COUNT[@]}"; do echo "$k ${EVAL_FAILURE_COUNT[$k]}"; done | sort -k2 -rn | awk '{print $1}'); do
      fail_count=${EVAL_FAILURE_COUNT[$eval_id]}
      fail_rate=$((fail_count * 100 / TOTAL_RUNS))

      # Get list of failed directories (just timestamps)
      dirs="${EVAL_FAILURE_DIRS[$eval_id]}"
      dir_list=$(echo "$dirs" | tr ' ' '\n' | xargs -I{} dirname {} | xargs -I{} basename {} | sort -u | paste -sd "," -)

      # Truncate if too long
      if [ ${#dir_list} -gt 80 ]; then
        dir_list="${dir_list:0:77}..."
      fi

      # Color based on flakiness
      if [ $fail_rate -ge 50 ]; then
        color="${RED}"
      elif [ $fail_rate -ge 20 ]; then
        color="${YELLOW}"
      else
        color="${NC}"
      fi

      printf "║ ${color}%-6s${NC} │ %3d / %-4d │ %5d%%  │ %-82s ║\n" \
        "$eval_id" "$fail_count" "$TOTAL_RUNS" "$fail_rate" "$dir_list"
    done

    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Show exact log file paths for failed evals
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                      FAILED EVAL LOG FILE REFERENCES                                          ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    for eval_id in $(for k in "${!EVAL_FAILURE_COUNT[@]}"; do echo "$k ${EVAL_FAILURE_COUNT[$k]}"; done | sort -k2 -rn | awk '{print $1}'); do
      echo -e "${YELLOW}Eval $eval_id (${EVAL_FAILURE_COUNT[$eval_id]} failures):${NC}"
      for log_path in ${EVAL_FAILURE_DIRS[$eval_id]}; do
        echo "  $log_path"
      done
      echo ""
    done
  fi

  # Exit with appropriate code
  if [ $TOTAL_RUNS_FAILED -gt 0 ]; then
    exit 1
  else
    exit 0
  fi
fi

###############################################################################
# SINGLE RUN MODE (default)
###############################################################################

# Find the results directory
if [ -n "$RESULTS_DIR" ]; then
  # If the provided directory contains timestamped subdirectories (e.g., .results/parallel/),
  # automatically use the most recent one
  if [ -d "$RESULTS_DIR" ] && ! ls "$RESULTS_DIR"/*.log &>/dev/null; then
    SUBDIR=$(find "$RESULTS_DIR" -maxdepth 1 -type d -name "2*" | sort -r | head -n 1)
    if [ -n "$SUBDIR" ]; then
      echo -e "${YELLOW}Note: $RESULTS_DIR contains multiple run directories${NC}"
      echo -e "${YELLOW}      Using most recent: $(basename "$SUBDIR")${NC}"
      echo -e "${YELLOW}      Use --all to analyze all runs${NC}"
      echo ""
      RESULTS_DIR="$SUBDIR"
    fi
  fi
else
  RESULTS_DIR=$(find "$RESULTS_BASE" -maxdepth 1 -type d -name "2*" | sort -r | head -n 1)
fi

if [ -z "$RESULTS_DIR" ] || [ ! -d "$RESULTS_DIR" ]; then
  echo -e "${RED}❌ No results directory found${NC}"
  echo ""
  show_usage
  exit 1
fi

TIMESTAMP=$(basename "$RESULTS_DIR")

echo ""
echo -e "${CYAN}╔═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                    E2E TEST RESULTS ANALYSIS                                                                                ║${NC}"
echo -e "${CYAN}╠═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║  Results Directory: $(printf "%-139s" "$TIMESTAMP") ║${NC}"
echo -e "${CYAN}╚═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Arrays to store results
declare -A EVAL_STATUS
declare -A EVAL_DURATION
declare -A EVAL_ERROR
declare -A EVAL_JOB_IDS
declare -A EVAL_CORRELATION_IDS

# Success patterns
SUCCESS_PATTERNS=(
  "✅ ALL TESTS PASSED"
  "🎉.*PASSED"
  "Test Summary.*Passed:.*5"
  "TEST SUMMARY.*Total Tests:.*Passed:.*[1-9]"
)

# Failure patterns
FAILURE_PATTERNS=(
  "⚠️.*timed out"
  "❌.*FAIL"
  "❌ Failed"
  "ERROR"
  "Test Summary.*Failed:.*[1-9]"
)

# Analyze each log file
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_TIMEOUT=0
TOTAL_DURATION=0

echo -e "${BLUE}Analyzing log files...${NC}"
echo ""

for log_file in "$RESULTS_DIR"/*.log; do
  if [ ! -f "$log_file" ]; then
    continue
  fi
  
  filename=$(basename "$log_file")
  
  # Skip files that don't start with a digit (not eval logs)
  if [[ ! "$filename" =~ ^[0-9] ]]; then
    continue
  fi
  
  # Extract eval ID and name from filename
  # Format: 01_01-happy-path_20251127_210355.log
  eval_id=$(echo "$filename" | cut -d'_' -f1)
  eval_name=$(echo "$filename" | cut -d'_' -f2 | sed 's/\.log$//')
  
  # Extract Job IDs (UUIDs) - do this first for all cases
  job_ids=$(grep -oE "Job ID: [0-9a-f-]{36}" "$log_file" 2>/dev/null | cut -d' ' -f3 | sort -u | paste -sd "," - || echo "")
  if [ -z "$job_ids" ]; then
    # Try alternative patterns (first 5 unique UUIDs found)
    job_ids=$(grep -oE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" "$log_file" 2>/dev/null | sort -u | head -5 | paste -sd "," - || echo "")
  fi
  EVAL_JOB_IDS[$eval_id]=$job_ids
  
  # Extract Correlation IDs
  correlation_ids=$(grep -oE "Correlation ID: [0-9a-f-]{36}" "$log_file" 2>/dev/null | cut -d' ' -f3 | sort -u | paste -sd "," - || echo "")
  EVAL_CORRELATION_IDS[$eval_id]=$correlation_ids
  
  # Check for PASS/FAIL/TIMEOUT markers at end of file
  last_line=$(tail -n 1 "$log_file" 2>/dev/null || echo "")
  
  if echo "$last_line" | grep -q "^PASS:"; then
    duration=$(echo "$last_line" | cut -d':' -f2)
    EVAL_STATUS[$eval_id]="PASS"
    EVAL_DURATION[$eval_id]=$duration
    TOTAL_PASS=$((TOTAL_PASS + 1))
    TOTAL_DURATION=$((TOTAL_DURATION + duration))
  elif echo "$last_line" | grep -q "^TIMEOUT:"; then
    duration=$(echo "$last_line" | cut -d':' -f2)
    EVAL_STATUS[$eval_id]="TIMEOUT"
    EVAL_DURATION[$eval_id]=$duration
    TOTAL_TIMEOUT=$((TOTAL_TIMEOUT + 1))
    TOTAL_DURATION=$((TOTAL_DURATION + duration))
  elif echo "$last_line" | grep -q "^FAIL:"; then
    duration=$(echo "$last_line" | cut -d':' -f2)
    EVAL_STATUS[$eval_id]="FAIL"
    EVAL_DURATION[$eval_id]=$duration
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    TOTAL_DURATION=$((TOTAL_DURATION + duration))
  else
    # Heuristic analysis
    has_success=false
    has_failure=false
    error_msg=""
    
    # Check for success patterns
    for pattern in "${SUCCESS_PATTERNS[@]}"; do
      if grep -E "$pattern" "$log_file" > /dev/null 2>&1; then
        has_success=true
        break
      fi
    done
    
    # Check for failure patterns and extract error message
    for pattern in "${FAILURE_PATTERNS[@]}"; do
      if match=$(grep -E "$pattern" "$log_file" 2>/dev/null | tail -1); then
        has_failure=true
        error_msg="$match"
        break
      fi
    done
    
    # If no error found yet, look for common error indicators
    if [ -z "$error_msg" ]; then
      # Try to find last line with ❌ or ERROR
      error_msg=$(grep -E "(❌|ERROR|FAILED:)" "$log_file" 2>/dev/null | tail -1 || echo "")
    fi
    
    # Estimate duration from log timestamps
    first_time=$(grep -oE "[0-9]{2}:[0-9]{2}:[0-9]{2}" "$log_file" 2>/dev/null | head -1 || echo "")
    last_time=$(grep -oE "[0-9]{2}:[0-9]{2}:[0-9]{2}" "$log_file" 2>/dev/null | tail -1 || echo "")
    
    duration=0
    if [ -n "$first_time" ] && [ -n "$last_time" ]; then
      first_sec=$(echo "$first_time" | awk -F: '{ print ($1 * 3600) + ($2 * 60) + $3 }')
      last_sec=$(echo "$last_time" | awk -F: '{ print ($1 * 3600) + ($2 * 60) + $3 }')
      duration=$((last_sec - first_sec))
      if [ $duration -lt 0 ]; then
        duration=$((duration + 86400))  # Handle day boundary
      fi
    fi
    
    EVAL_DURATION[$eval_id]=$duration
    TOTAL_DURATION=$((TOTAL_DURATION + duration))
    
    # Determine status
    if [ "$has_success" = true ] && [ "$has_failure" = false ]; then
      EVAL_STATUS[$eval_id]="PASS"
      TOTAL_PASS=$((TOTAL_PASS + 1))
    elif [ "$has_failure" = true ]; then
      if echo "$error_msg" | grep -q "timed out"; then
        EVAL_STATUS[$eval_id]="TIMEOUT"
        TOTAL_TIMEOUT=$((TOTAL_TIMEOUT + 1))
      else
        EVAL_STATUS[$eval_id]="FAIL"
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
      fi
      EVAL_ERROR[$eval_id]="$error_msg"
    else
      EVAL_STATUS[$eval_id]="UNKNOWN"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
  fi
done

# Display results table
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                                                                         EVALUATION RESULTS                                                                                                                ║${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "║ ID | Eval Name                                  | Duration | Status     | Error / Notes                   | Job ID(s)                            | Correlation ID(s)                    ║"
echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"

# Get all eval IDs from the results (sorted numerically)
ALL_EVAL_IDS=$(for key in "${!EVAL_STATUS[@]}"; do echo "$key"; done | sort -n)

for eval_id in $ALL_EVAL_IDS; do
  status="${EVAL_STATUS[$eval_id]}"
  if [ -n "$status" ]; then
    duration="${EVAL_DURATION[$eval_id]:-0}"
    error_msg="${EVAL_ERROR[$eval_id]:-}"
    
    # Format duration
    if [ $duration -lt 60 ]; then
      duration_str=$(printf "%4ss" "$duration")
    else
      minutes=$((duration / 60))
      seconds=$((duration % 60))
      duration_str=$(printf "%2dm %02ds" "$minutes" "$seconds")
    fi
    
    # Color based on status
    case "$status" in
      PASS)
        status_display="${GREEN}✅ PASS${NC}   "
        ;;
      FAIL)
        status_display="${RED}❌ FAIL${NC}   "
        ;;
      TIMEOUT)
        status_display="${YELLOW}⏱️  TIMEOUT${NC}"
        ;;
      *)
        status_display="${RED}❓ UNKNOWN${NC}"
        ;;
    esac
    
    # Get eval name
    eval_name=$(ls $RESULTS_DIR/${eval_id}_*.log 2>/dev/null | head -1 | xargs basename 2>/dev/null | cut -d'_' -f2 | sed 's/-/ /g' || echo "unknown")
    
    # Truncate error message if too long
    if [ -n "$error_msg" ]; then
      # Remove ANSI codes and truncate to 33 chars
      error_clean=$(echo "$error_msg" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-33)
      if [ ${#error_msg} -gt 33 ]; then
        error_clean="${error_clean}..."
      fi
    else
      error_clean=""
    fi
    
    # Format job IDs - show full IDs
    job_ids_raw="${EVAL_JOB_IDS[$eval_id]:-}"
    if [ -n "$job_ids_raw" ]; then
      # Count number of job IDs
      job_count=$(echo "$job_ids_raw" | tr ',' '\n' | wc -l)
      if [ $job_count -eq 1 ]; then
        # Single job - show full ID
        job_ids_display=$(echo "$job_ids_raw")
      else
        # Multiple jobs - show full IDs comma separated
        job_ids_display=$(echo "$job_ids_raw" | tr ',' '\n' | paste -sd "," -)
      fi
    else
      job_ids_display="-"
    fi
    
    # Format correlation IDs - show full IDs
    correlation_ids_raw="${EVAL_CORRELATION_IDS[$eval_id]:-}"
    if [ -n "$correlation_ids_raw" ]; then
      correlation_ids_display=$(echo "$correlation_ids_raw")
    else
      correlation_ids_display="-"
    fi
    
    # Use echo -e to properly render the status_display colors
    echo -e "║ $(printf "%2s" "$eval_id") | $(printf "%-42s" "$eval_name") | $(printf "%8s" "$duration_str") | $status_display | $(printf "%-33s" "$error_clean") | $(printf "%-37s" "$job_ids_display") | $(printf "%-37s" "$correlation_ids_display") ║"
  fi
done

echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣${NC}"

# Calculate percentages
TOTAL_TESTS=$((TOTAL_PASS + TOTAL_FAIL + TOTAL_TIMEOUT))
if [ $TOTAL_TESTS -gt 0 ]; then
  PASS_PCT=$((TOTAL_PASS * 100 / TOTAL_TESTS))
else
  PASS_PCT=0
fi

# Format total duration
if [ $TOTAL_DURATION -lt 60 ]; then
  total_duration_str="${TOTAL_DURATION}s"
else
  minutes=$((TOTAL_DURATION / 60))
  seconds=$((TOTAL_DURATION % 60))
  total_duration_str="${minutes}m ${seconds}s"
fi

echo -e "║ ${GREEN}✅ PASSED:${NC} $(printf "%3d" $TOTAL_PASS)  ${RED}❌ FAILED:${NC} $(printf "%3d" $TOTAL_FAIL)  ${YELLOW}⏱️  TIMEOUT:${NC} $(printf "%3d" $TOTAL_TIMEOUT)  │ 📊 Success Rate: ${PASS_PCT}%  │ ⏱️  Total: $(printf "%-104s" "$total_duration_str") ║"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Show failure details if any
if [ $TOTAL_FAIL -gt 0 ] || [ $TOTAL_TIMEOUT -gt 0 ]; then
  echo ""
  echo -e "${CYAN}╔═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║                                                          FAILURE DETAILS                                                                                    ║${NC}"
  echo -e "${CYAN}╚═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  
  for eval_id in $ALL_EVAL_IDS; do
    status="${EVAL_STATUS[$eval_id]}"
    if [ "$status" = "FAIL" ] || [ "$status" = "TIMEOUT" ] || [ "$status" = "UNKNOWN" ]; then
      log_file=$(ls $RESULTS_DIR/${eval_id}_*.log 2>/dev/null | head -1)
      if [ -n "$log_file" ]; then
        eval_name=$(basename "$log_file" | cut -d'_' -f2)
        
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}[$eval_id] $eval_name - $status${NC}"
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        
        # Show last 30 lines or error context
        if [ -n "${EVAL_ERROR[$eval_id]}" ]; then
          echo "Error: ${EVAL_ERROR[$eval_id]}"
          echo ""
        fi
        
        echo "Last 30 lines:"
        tail -n 30 "$log_file"
        echo ""
        echo "Full log: $log_file"
        echo ""
      fi
    fi
  done
fi

# Exit with appropriate code
if [ $TOTAL_FAIL -gt 0 ] || [ $TOTAL_TIMEOUT -gt 0 ]; then
  exit 1
else
  exit 0
fi

