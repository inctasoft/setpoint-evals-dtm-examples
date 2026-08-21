#!/bin/bash

################################################################################
# SE Runner (SE Conventions v2 — server-config/docs/setpoint-eval-conventions.md)
#
# Runs all Setpoint Evals under a directory in parallel (default) or in-band
# (sequential) mode. SEs are discovered from the filesystem (any SE-<NN>-<name>/
# test.sh, zero-padded numeric order) — no hand-maintained lists. Per-SE
# behavior (timeout, parallel-safe vs destructive isolation, category, XFAIL
# anchoring, --quick opt-in) comes from that SE's README.md metadata; a missing
# README (pre-v2 legacy estate) degrades to defaults rather than erroring.
#
# Parallel Mode (default):
#   - Phase 1: Runs parallel-safe evals concurrently
#   - Phase 2: Runs destructive evals sequentially (isolation: destructive in the README)
#   - Reason: Phase 2 evals use global maintenance tasks, are destructive, or need isolated resources
#
# In-Band Mode:
#   - Runs all evals sequentially (safe for all scenarios)
#
# Verdict markers (last line of each per-eval log, `VERDICT:<durationSeconds>`):
#   PASS · FAIL · TIMEOUT · SKIP (test.sh exited 77 — the se_skip sentinel) ·
#   XFAIL (README anchored `**Expected outcome:** EXPECTED-FAIL` and it failed — green) ·
#   UPASS (anchored EXPECTED-FAIL but it PASSED — anomaly, red, fails the run)
#
# Dynamic Lambda Pre-Warming:
#   - Automatically scales Lambda workers based on eval count
#   - Default: 3 instances per worker type per eval
#   - 1 eval:  12 workers (3 instances x 4 worker types)
#   - 5 evals: 60 workers (15 instances x 4 worker types) - capped
#   - 15 evals: 60 workers (15 instances x 4 worker types) - capped
#   - Override: --worker-instances=N to change instances per eval
#   - Control: --skip-warmup to skip warm-up, --skip-checks still warms up
#
# Usage:
#   ./setpoint-evals/run-all.sh [--parallel|--in-band] [options]
#
# Modes:
#   --parallel         Run parallel-safe evals concurrently, destructive sequentially (default)
#   --in-band          Run all evals sequentially
#
# Options:
#   --skip-purge            Don't purge before running (use with caution)
#   --skip-checks           Skip preflight checks (still warms up Lambdas)
#   --skip-warmup           Skip Lambda pre-warming (saves time if already warm)
#   --purge-between         Purge between each eval (in-band mode only)
#   --category <cat>        Run only SEs whose README declares this **Category** (default: all)
#   --eval <id>, --se <id>  Run specific eval(s) (e.g., 01 or SE-01-retry-transient-failure);
#                           repeatable
#   --dir <path>            Discover/run SEs under this directory instead of this script's own
#                           (lets a workflow suite's run-all.sh delegate to this SAME runner)
#   --list                  Print the discovered execution order and exit (runs nothing)
#   --quick                 Export SE_QUICK=1 — SEs that opt in via README `**Quick**: yes`
#                           may shorten their internal waits
#   --worker-instances=N    Lambda instances per worker type per eval (default: 3)
#   --add-timeout=N         Add N seconds to the timeout of each eval (default: 0)
#   --max-parallel=N        Max concurrent evals in parallel mode (default: 6, 0=unlimited)
#   --all-workflows         After core SEs, discover and run workflows/*/setpoint-evals/run-all.sh
#   --ci-mode               CI/CD mode (JSON output, no colors)
#   --help                  Show this help
#
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Default settings
MODE="parallel"  # Default mode
SKIP_PURGE=false
SKIP_CHECKS=false
SKIP_WARMUP=false
PURGE_BETWEEN=false
CATEGORY="all"
SPECIFIC_EVALS=()
SKIP_EVALS=()
CI_MODE=false
ALL_WORKFLOWS=false
WORKER_INSTANCES_PER_EVAL=3  # Default: 3 instances per worker type per eval
MAX_PARALLEL=6  # Default: max 6 concurrent evals in parallel mode (0=unlimited)
export ADDITIONAL_TIMEOUT=0  # Default: 0 additional seconds (Exported globally)
EVAL_DIR="$SCRIPT_DIR"  # Directory to auto-discover SE-*/test.sh in (SE Conventions v2).
                        # Overridable via --dir so a workflow suite's run-all.sh can delegate
                        # to THIS runner instead of forking its own copy.
LIST_ONLY=false
export SE_QUICK=0      # --quick exports SE_QUICK=1; SEs may opt in to shortened waits

# Result Arrays (Associative to handle "08", "09" string keys correctly)
declare -A RESULTS
declare -A DURATIONS
declare -A PIDS
declare -A JOB_IDS
declare -A CORRELATION_IDS
declare -A NOTES

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --parallel)
      MODE="parallel"
      shift
      ;;
    --in-band)
      MODE="in-band"
      shift
      ;;
    --skip-purge)
      SKIP_PURGE=true
      shift
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --skip-warmup)
      SKIP_WARMUP=true
      shift
      ;;
    --purge-between)
      PURGE_BETWEEN=true
      shift
      ;;
    --category)
      CATEGORY="$2"
      shift 2
      ;;
    --eval|--se)
      shift
      while [[ $# -gt 0 && ! "$1" =~ ^- ]]; do
        SPECIFIC_EVALS+=("$1")
        shift
      done
      ;;
    --dir)
      EVAL_DIR="$(cd "$2" && pwd)"
      shift 2
      ;;
    --list)
      LIST_ONLY=true
      shift
      ;;
    --quick)
      export SE_QUICK=1
      shift
      ;;
    --skip)
      shift
      while [[ $# -gt 0 && ! "$1" =~ ^- ]]; do
        SKIP_EVALS+=("$1")
        shift
      done
      ;;
    --ci-mode)
      CI_MODE=true
      shift
      ;;
    --all-workflows)
      ALL_WORKFLOWS=true
      shift
      ;;
    --worker-instances=*)
      WORKER_INSTANCES_PER_EVAL="${1#*=}"
      if ! [[ "$WORKER_INSTANCES_PER_EVAL" =~ ^[0-9]+$ ]] || [ "$WORKER_INSTANCES_PER_EVAL" -lt 1 ]; then
        echo "Error: --worker-instances must be a positive integer"
        exit 1
      fi
      shift
      ;;
    --add-timeout=*)
      export ADDITIONAL_TIMEOUT="${1#*=}"
      if ! [[ "$ADDITIONAL_TIMEOUT" =~ ^[0-9]+$ ]]; then
        echo "Error: --add-timeout must be a non-negative integer"
        exit 1
      fi
      shift
      ;;
    --max-parallel=*)
      MAX_PARALLEL="${1#*=}"
      if ! [[ "$MAX_PARALLEL" =~ ^[0-9]+$ ]]; then
        echo "Error: --max-parallel must be a non-negative integer (0=unlimited)"
        exit 1
      fi
      shift
      ;;
    --help)
      sed -n '3,61p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run with --help for usage information"
      exit 1
      ;;
  esac
done

################################################################################
# Eval Definitions — filesystem autodiscovery (SE Conventions v2)
################################################################################
# Any SE-<NN>-<name>/test.sh under EVAL_DIR, zero-padded numeric order. No hand-maintained
# lists. A "00-template" dir (if present) never matches the SE-* glob, so it's naturally
# excluded from discovery. Runs BEFORE the .results/ dir is created so --list stays a pure
# read-only query (no run dir, no log).

ALL_EVALS=()
while IFS= read -r -d '' se_path; do
  se_name="$(basename "$se_path")"
  if [[ "$se_name" =~ ^SE-([0-9]+)-(.+)$ ]] && [ -f "$se_path/test.sh" ]; then
    ALL_EVALS+=("${BASH_REMATCH[1]}:${se_name}")
  fi
done < <(find "$EVAL_DIR" -maxdepth 1 -mindepth 1 -type d -name 'SE-*' -print0 | sort -z -V)

if [ "$LIST_ONLY" = true ]; then
  echo "Discovered SEs in $EVAL_DIR:"
  for eval_spec in "${ALL_EVALS[@]}"; do
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    echo "  [$eval_id] $eval_dir"
  done
  exit 0
fi

# Setup results directory based on mode — lives under the SUITE being scanned (EVAL_DIR),
# not always the core setpoint-evals/ dir, so a delegated workflow suite gets its own .results/.
RESULTS_DIR="$EVAL_DIR/.results/$MODE/$TIMESTAMP"
mkdir -p "$RESULTS_DIR"

# Self-gitignoring .results dir (SE Conventions v2 — mirrors scripts/se-run-suite.sh).
# Written only if absent so a hand-authored richer .gitignore (comment + negation, see
# workflows/*/setpoint-evals/.results/.gitignore) is never clobbered on every run.
[ -f "$EVAL_DIR/.results/.gitignore" ] || printf '*\n' > "$EVAL_DIR/.results/.gitignore"

# Redirect all output to a log file in addition to stdout
exec > >(tee -a "$RESULTS_DIR/run.log") 2>&1

# Source shared helpers for strip_ansi_codes function
source "$SCRIPT_DIR/shared/helpers.sh"

################################################################################
# Per-SE README metadata (v2 contract: server-config/docs/setpoint-eval-conventions.md)
################################################################################
# '**Timeout**: <n>s' (default 120s) · '**Isolation**: parallel-safe|destructive'
# (default parallel-safe) · '**Category**: <cat>' (default uncategorized) ·
# '**Expected outcome:** EXPECTED-FAIL' (XFAIL anchor) · '**Quick**: yes' (opts into
# SE_QUICK). A missing README is the pre-v2 legacy/grandfathered case — every reader
# below degrades to its default rather than erroring, and every grep is `|| true`-guarded
# so a non-match can never trip `set -e`.

se_meta_raw() {
  # $1 = SE dir name, $2 = bold-key WITHOUT trailing colon (e.g. "Timeout")
  local readme="$EVAL_DIR/$1/README.md"
  [ -f "$readme" ] || { printf ''; return 0; }
  grep -m1 -E "\*\*${2}\*\*:" "$readme" 2>/dev/null || true
}

se_timeout() {
  # v2 contract default is 120s — but that applies to SEs that HAVE a README (they had the
  # chance to declare '**Timeout**'). A README-less SE is the pre-v2 legacy case, which
  # historically ran with NO timeout at all (old in-band/destructive paths) — killing a
  # retry-heavy legacy SE at 120s would convert a legitimate PASS into a TIMEOUT (the
  # workflow SEs ride 3x ~30s SQS visibility cycles and poll up to 300s). Legacy default:
  # 600s — generous enough to never clip a real run, finite enough to still catch a hang.
  local raw val
  if [ ! -f "$EVAL_DIR/$1/README.md" ]; then printf '600'; return 0; fi
  raw="$(se_meta_raw "$1" "Timeout")"
  val="$(printf '%s' "$raw" | sed -E 's/.*\*\*Timeout\*\*:[[:space:]]*([0-9]+)s?.*/\1/')"
  if [ -n "$val" ] && [[ "$val" =~ ^[0-9]+$ ]]; then printf '%s' "$val"; else printf '120'; fi
}

se_isolation() {
  local raw val
  raw="$(se_meta_raw "$1" "Isolation")"
  val="$(printf '%s' "$raw" | sed -E 's/.*\*\*Isolation\*\*:[[:space:]]*([A-Za-z-]+).*/\1/')"
  if [ "$val" = "destructive" ]; then printf 'destructive'; else printf 'parallel-safe'; fi
}

se_category() {
  local raw val
  raw="$(se_meta_raw "$1" "Category")"
  val="$(printf '%s' "$raw" | sed -E 's/.*\*\*Category\*\*:[[:space:]]*([A-Za-z0-9_-]+).*/\1/')"
  if [ -n "$val" ]; then printf '%s' "$val"; else printf 'uncategorized'; fi
}

se_is_xfail_anchor() {
  local readme="$EVAL_DIR/$1/README.md"
  [ -f "$readme" ] || return 1
  grep -qE '\*\*Expected outcome:\*\*[[:space:]]*EXPECTED-FAIL' "$readme" 2>/dev/null
}

# Verdict from a test.sh exit code + whether the SE is anchored EXPECTED-FAIL.
# 77 => SKIP (se_skip sentinel) · 124 => TIMEOUT (from the `timeout` wrapper) ·
# 0 => PASS, or UPASS if XFAIL-anchored (unexpected pass = anomaly) ·
# nonzero => FAIL, or XFAIL if XFAIL-anchored (expected fail = green).
se_verdict_from_exit() {
  local ec="$1" xfail="$2"
  if [ "$ec" -eq 77 ]; then echo "SKIP"; return; fi
  if [ "$ec" -eq 124 ]; then echo "TIMEOUT"; return; fi
  if [ "$ec" -eq 0 ]; then
    if [ "$xfail" = "1" ]; then echo "UPASS"; else echo "PASS"; fi
  else
    if [ "$xfail" = "1" ]; then echo "XFAIL"; else echo "FAIL"; fi
  fi
}

# "Green" verdicts (no notes/forensics needed): PASS, legacy PASSED, XFAIL (expected fail),
# SKIP (intentionally not run). Everything else (FAIL/TIMEOUT/UPASS/ERROR) is a problem.
se_is_ok_verdict() {
  case "$1" in
    PASS|PASSED|XFAIL|SKIP) return 0 ;;
    *) return 1 ;;
  esac
}

declare -A PARALLEL_TIMEOUTS
declare -A ISOLATION_MAP
declare -A CATEGORY_MAP
declare -A XFAIL_ANCHOR

SAFE_EVALS=()
DESTRUCTIVE_EVALS=()
for eval_spec in "${ALL_EVALS[@]}"; do
  IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
  PARALLEL_TIMEOUTS[$eval_id]="$(se_timeout "$eval_dir")"
  ISOLATION_MAP[$eval_id]="$(se_isolation "$eval_dir")"
  CATEGORY_MAP[$eval_id]="$(se_category "$eval_dir")"
  if se_is_xfail_anchor "$eval_dir"; then XFAIL_ANCHOR[$eval_id]=1; else XFAIL_ANCHOR[$eval_id]=0; fi
  if [ "${ISOLATION_MAP[$eval_id]}" = "destructive" ]; then
    DESTRUCTIVE_EVALS+=("$eval_spec")
  else
    SAFE_EVALS+=("$eval_spec")
  fi
done

################################################################################
# Select Evals to Run (moved up to calculate count before preflight)
################################################################################

EVALS_TO_RUN=()

if [ ${#SPECIFIC_EVALS[@]} -gt 0 ]; then
  # Find each requested eval
  for specific_eval in "${SPECIFIC_EVALS[@]}"; do
    found=false
    for eval_spec in "${ALL_EVALS[@]}"; do
      IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
      if [[ "$eval_dir" == *"$specific_eval"* ]] || [[ "$eval_id" == "$specific_eval" ]]; then
        # Avoid duplicates
        already_added=false
        for existing in "${EVALS_TO_RUN[@]}"; do
          if [ "$existing" == "$eval_spec" ]; then
            already_added=true
            break
          fi
        done

        if [ "$already_added" = false ]; then
          EVALS_TO_RUN+=("$eval_spec")
        fi
        found=true
        break
      fi
    done

    if [ "$found" = false ]; then
      echo -e "${RED}Eval not found: $specific_eval${NC}"
      exit 1
    fi
  done
elif [ "$CATEGORY" == "all" ]; then
  EVALS_TO_RUN=("${ALL_EVALS[@]}")
else
  for eval_spec in "${ALL_EVALS[@]}"; do
    IFS=':' read -r eval_id _ <<< "$eval_spec"
    if [ "${CATEGORY_MAP[$eval_id]:-uncategorized}" == "$CATEGORY" ]; then
      EVALS_TO_RUN+=("$eval_spec")
    fi
  done
  if [ ${#EVALS_TO_RUN[@]} -eq 0 ]; then
    echo -e "${RED}No evals found in category: ${CATEGORY}${NC}"
    echo "Available categories (from discovered SE READMEs):"
    for eval_spec in "${ALL_EVALS[@]}"; do
      IFS=':' read -r eval_id _ <<< "$eval_spec"
      echo "  [$eval_id] ${CATEGORY_MAP[$eval_id]:-uncategorized}"
    done
    exit 1
  fi
fi

# Filter out skipped evals
if [ ${#SKIP_EVALS[@]} -gt 0 ]; then
  FILTERED_EVALS=()
  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    should_skip=false
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"

    for skip_val in "${SKIP_EVALS[@]}"; do
      if [[ "$eval_dir" == *"$skip_val"* ]] || [[ "$eval_id" == "$skip_val" ]]; then
        should_skip=true
        break
      fi
    done

    if [ "$should_skip" = false ]; then
      FILTERED_EVALS+=("$eval_spec")
    fi
  done
  EVALS_TO_RUN=("${FILTERED_EVALS[@]}")
fi

# Export eval count and worker instances for preflight check to use for dynamic Lambda warm-up
export E2E_EVAL_COUNT=${#EVALS_TO_RUN[@]}
export E2E_WORKER_INSTANCES_PER_EVAL=${WORKER_INSTANCES_PER_EVAL}

################################################################################
# Pre-Flight Check (unless skipped)
################################################################################

if [ "$SKIP_CHECKS" = true ] && [ "$SKIP_WARMUP" = true ]; then
  # Skip everything (old --skip-checks behavior)
  echo ""
  echo -e "${YELLOW}Skipping all pre-flight checks and Lambda warm-up${NC}"
  echo -e "${BLUE}Selected ${E2E_EVAL_COUNT} eval(s) to run${NC}"
  echo ""
  log_warning "Skipping Docker, worker, health checks, and Lambda warm-up"
  log_info "Use only when confident your environment is ready and warm"
  echo ""
elif [ "$SKIP_CHECKS" = true ]; then
  # Skip checks but still warm up Lambdas
  echo ""
  echo -e "${YELLOW}Skipping pre-flight checks (--skip-checks flag set)${NC}"
  echo -e "${BLUE}Selected ${E2E_EVAL_COUNT} eval(s) to run${NC}"
  echo ""
  log_info "Skipping Docker, worker, and health checks"
  log_info "Running Lambda warm-up to ensure capacity..."
  echo ""

  # Run only Lambda warm-up
  PREFLIGHT_SCRIPT="$SCRIPT_DIR/preflight-check.sh"
  if [ -f "$PREFLIGHT_SCRIPT" ]; then
    # Pass --warmup-only flag to run only the warm-up check
    "$PREFLIGHT_SCRIPT" --warmup-only
  fi
  echo ""
elif [ "$SKIP_PURGE" = false ]; then
  PREFLIGHT_SCRIPT="$SCRIPT_DIR/preflight-check.sh"

  if [ -f "$PREFLIGHT_SCRIPT" ]; then
    echo ""
    echo -e "${CYAN}========================================================${NC}"
    echo -e "${CYAN}Running Pre-Flight Checks...${NC}"
    echo -e "${CYAN}========================================================${NC}"
    echo ""
    echo -e "${BLUE}Selected ${E2E_EVAL_COUNT} eval(s) to run${NC}"
    echo ""

    # Build preflight command with optional flags
    PREFLIGHT_CMD="$PREFLIGHT_SCRIPT"
    if [ "$SKIP_WARMUP" = true ]; then
      PREFLIGHT_CMD="$PREFLIGHT_CMD --skip-warmup"
    fi

    # Run preflight check (exit code 0 = pass, 1 = critical fail, 2 = warnings)
    if $PREFLIGHT_CMD; then
      echo ""
      echo -e "${GREEN}All pre-flight checks passed - proceeding with evals${NC}"
      echo ""
    else
      PREFLIGHT_EXIT=$?

      if [ $PREFLIGHT_EXIT -eq 2 ]; then
        # Warnings only - ask user to proceed
        echo ""
        echo -e "${YELLOW}Pre-flight warnings detected${NC}"
        echo -e "${YELLOW}Evals may fail or behave unexpectedly${NC}"
        echo ""
        echo "Options:"
        echo "  1) Continue anyway (may fail)"
        echo "  2) Fix issues and re-run"
        echo ""

        if [ "$CI_MODE" = true ]; then
          # In CI mode, proceed with warnings
          echo "CI mode: Proceeding despite warnings"
        else
          # Interactive mode: ask user
          read -p "Continue? (y/N): " -n 1 -r
          echo ""

          if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted. Fix issues and re-run."
            exit 1
          fi
        fi

        echo -e "${YELLOW}Proceeding despite warnings...${NC}"
        echo ""
      else
        # Critical failures - abort
        echo ""
        echo -e "${RED}Pre-flight check failed with critical errors${NC}"
        echo ""
        echo "Fix the issues above and re-run this script."
        echo "Or run with --skip-checks to bypass pre-flight checks (not recommended)"
        echo ""
        exit 1
      fi
    fi
  else
    echo -e "${YELLOW}Pre-flight check script not found (skipping)${NC}"
  fi
else
  echo ""
  echo -e "${YELLOW}Skipping pre-flight checks (--skip-purge implies no checks)${NC}"
  echo -e "${BLUE}Selected ${E2E_EVAL_COUNT} eval(s) to run${NC}"
  echo ""
fi

################################################################################
# Helper Functions
################################################################################

log_section() {
  echo -e "\n${CYAN}=======================================================================${NC}"
  echo -e "${CYAN}$1${NC}"
  echo -e "${CYAN}=======================================================================${NC}\n"
}

log_info() {
  echo -e "${BLUE}$1${NC}"
}

log_success() {
  echo -e "${GREEN}$1${NC}"
}

log_warning() {
  echo -e "${YELLOW}$1${NC}"
}

log_error() {
  echo -e "${RED}$1${NC}"
}


# Forensic logging function
collect_failure_logs() {
  local eval_id="$1"
  local job_id="$2"
  local output_dir="$3"
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local log_file="${output_dir}/forensics_${eval_id}.log"

  echo "Collecting failure logs for Eval ${eval_id} (Job: ${job_id:-N/A})..." > "$log_file"

  local services=("${COMPOSE_PROJECT_NAME:-dtm}-orchestrator" "${COMPOSE_PROJECT_NAME:-dtm}-localstack" "${COMPOSE_PROJECT_NAME:-dtm}-dev-ack-simulator")

  # Dynamically add all worker containers (SQS Pollers and Spawned Lambdas)
  if command -v docker &> /dev/null; then
    # 1. SQS Pollers (Optional - enabled via env var)
    if [[ "${E2E_EVALS_FORENSICS_ADD_POLLER_LOGS}" == "true" ]]; then
      while IFS= read -r container_name; do
        if [[ -n "$container_name" ]]; then
          services+=("$container_name")
        fi
      done < <(docker ps -a --filter "name=sqs-poller" --format "{{.Names}}")
    fi

    # 2. Spawned Lambda Containers (LocalStack usually includes function name in container name)
    # We look for containers matching our known worker function names
    worker_patterns=("validate-customer" "validate-order" "submit-customer" "submit-order")
    for pattern in "${worker_patterns[@]}"; do
      while IFS= read -r container_name; do
        # Avoid adding the poller itself again if it matches the pattern (though unlikely given specific naming)
        # and avoid duplicates
        if [[ -n "$container_name" ]] && [[ ! " ${services[*]} " =~ " ${container_name} " ]]; then
           services+=("$container_name")
        fi
      done < <(docker ps -a --filter "name=$pattern" --format "{{.Names}}")
    done
  fi

  # Track if we found any lambda containers. If NOT, and we are likely in ESM mode,
  # we should add filtered views of LocalStack logs for each worker type.
  has_lambda_containers=false
  for svc in "${services[@]}"; do
    if [[ "$svc" == *"validate-"* ]] || [[ "$svc" == *"submit-"* ]]; then
      has_lambda_containers=true
      break
    fi
  done

  # If no separate lambda containers found, we assume they run inside LocalStack.
  # We add "virtual" services that are actually just grep filters on dtm-localstack.
  if [ "$has_lambda_containers" = false ]; then
     # These are virtual names that the loop below will handle specially
     services+=("VIRTUAL:Validate Customer" "VIRTUAL:Validate Order" "VIRTUAL:Submit Customer" "VIRTUAL:Submit Order")
  fi

  for service in "${services[@]}"; do
    # Handle Virtual Services (Filtered LocalStack Logs)
    if [[ "$service" == "VIRTUAL:"* ]]; then
      worker_name="${service#VIRTUAL:}"

      # Check for logs first before writing section header
      localstack_svc="${COMPOSE_PROJECT_NAME:-dtm}-localstack"
      local worker_logs
      worker_logs=$(docker logs --since 15m "$localstack_svc" 2>&1 | grep -i "\[${worker_name}\]" | tail -n 500 | strip_ansi_codes)

      # Only write section if there are logs
      if [ -n "$worker_logs" ]; then
        echo "" >> "$log_file"
        echo "================================================================" >> "$log_file"
        echo "SERVICE: ${worker_name} (Filtered from LocalStack)" >> "$log_file"
        echo "================================================================" >> "$log_file"
        echo "--- [Logs for ${worker_name}] ---" >> "$log_file"
        echo "$worker_logs" >> "$log_file"
      fi
      # If no logs found, skip this worker entirely (no output)

    else
      # Standard Service Container
      # Focused forensics: Search by BOTH job ID and correlation ID
      if [ -n "$job_id" ]; then
        # Step 1: Get logs by job ID
        local job_logs
        job_logs=$(docker logs --since 30m "$service" 2>&1 | grep -i "${job_id}" | strip_ansi_codes)

        # Step 2: Extract correlation ID from the logs (NestJS format: [correlation-id])
        local correlation_id=""
        if [ -n "$job_logs" ]; then
          # Extract UUID from [xxxxx-xxxx-xxxx-xxxx-xxxxx] pattern in logs
          correlation_id=$(echo "$job_logs" | grep -oE '\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]' | head -n 1 | tr -d '[]')
        fi

        # Step 3: Search by correlation ID to get complete request trace
        local correlation_logs=""
        if [ -n "$correlation_id" ] && [ "$correlation_id" != "$job_id" ]; then
          correlation_logs=$(docker logs --since 30m "$service" 2>&1 | grep -i "${correlation_id}" | strip_ansi_codes)
        fi

        # Only write service section header if there are actual logs
        if [ -n "$job_logs" ] || [ -n "$correlation_logs" ]; then
          echo "" >> "$log_file"
          echo "================================================================" >> "$log_file"
          echo "SERVICE: ${service}" >> "$log_file"
          echo "================================================================" >> "$log_file"

          if [ -n "$job_logs" ]; then
            echo "--- [Logs matching Job ID: ${job_id}] ---" >> "$log_file"
            echo "$job_logs" | tail -n 500 >> "$log_file"
          fi

          if [ -n "$correlation_id" ] && [ "$correlation_id" != "$job_id" ]; then
            echo "" >> "$log_file"
            echo "--- [Additional logs by Correlation ID: ${correlation_id}] ---" >> "$log_file"
            echo "(NestJS request tracing - captures complete request flow)" >> "$log_file"
            # Show correlation logs that aren't already in job_logs (deduplicate)
            comm -13 <(echo "$job_logs" | sort) <(echo "$correlation_logs" | sort) | tail -n 500 >> "$log_file"
          fi
        fi
        # If no logs found, skip this service entirely (no output)
      else
        # No job ID available - check for recent errors
        local error_logs
        error_logs=$(docker logs --since 15m "$service" 2>&1 | grep -iE "Error|Exception|Fail" | grep -v "Found 0 errors" | strip_ansi_codes)

        # Only write service section if there are errors
        if [ -n "$error_logs" ]; then
          echo "" >> "$log_file"
          echo "================================================================" >> "$log_file"
          echo "SERVICE: ${service}" >> "$log_file"
          echo "================================================================" >> "$log_file"
          echo "--- [Recent Errors (No Job ID available)] ---" >> "$log_file"
          echo "$error_logs" | tail -n 100 >> "$log_file"
        fi
        # If no errors found, skip this service entirely (no output)
      fi
    fi
  done

  echo "" >> "$log_file"
  echo "Log capture complete." >> "$log_file"
}

################################################################################
# Purge System
################################################################################

if [ "$SKIP_PURGE" = false ]; then
  log_section "PURGING SYSTEM"
  log_info "Fast purge: Clearing DB only (SQS/Kafka left intact)..."
  "$REPO_ROOT/scripts/local-env.sh" purge > /dev/null 2>&1
  log_success "Fast purge complete"

  log_info "Waiting 2 seconds for system to stabilize..."
  sleep 2
else
  log_warning "Skipping purge (--skip-purge flag set)"
fi

################################################################################
# Note: Deduplication Control
################################################################################
# Global deduplication is ENABLED (ENABLE_DEDUPLICATION=true)
#
# Per-request override via testOptions.enableDeduplication:
#   - All evals (except 03) pass enableDeduplication: false to bypass deduplication
#   - Eval 03 (deduplication test) passes enableDeduplication: true to test it
#
# This allows:
#   1. Global deduplication for production safety
#   2. Evals to run multiple times without 409 conflicts
#   3. Eval 03 to specifically test deduplication behavior
################################################################################

echo ""

################################################################################
# Display Mode Information
################################################################################

log_section "EXECUTION MODE: ${MODE^^}"

if [ "$MODE" = "parallel" ]; then
  # Split evals into safe and destructive
  SAFE_TO_RUN=()
  DESTRUCTIVE_TO_RUN=()

  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    IFS=':' read -r eval_id _ <<< "$eval_spec"

    # Check if eval is in destructive list
    IS_DESTRUCTIVE=false
    for dest_eval in "${DESTRUCTIVE_EVALS[@]}"; do
      IFS=':' read -r dest_id _ <<< "$dest_eval"
      if [ "$eval_id" = "$dest_id" ]; then
        IS_DESTRUCTIVE=true
        break
      fi
    done

    if [ "$IS_DESTRUCTIVE" = true ]; then
      DESTRUCTIVE_TO_RUN+=("$eval_spec")
    else
      SAFE_TO_RUN+=("$eval_spec")
    fi
  done

  echo "Execution Plan:"
  echo ""
  if [ $MAX_PARALLEL -gt 0 ]; then
    echo "  Phase 1 (Parallel, max $MAX_PARALLEL): ${#SAFE_TO_RUN[@]} safe evals"
  else
    echo "  Phase 1 (Parallel, unlimited): ${#SAFE_TO_RUN[@]} safe evals"
  fi
  for eval_spec in "${SAFE_TO_RUN[@]}"; do
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    echo "    - [$eval_id] $eval_dir"
  done
  echo ""

  if [ ${#DESTRUCTIVE_TO_RUN[@]} -gt 0 ]; then
    echo "  Phase 2 (Sequential): ${#DESTRUCTIVE_TO_RUN[@]} destructive evals"
    for eval_spec in "${DESTRUCTIVE_TO_RUN[@]}"; do
      IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
      echo "    - [$eval_id] $eval_dir"
    done
    echo ""

    log_warning "Phase 2 evals run sequentially due to global state interactions:"
    echo "    - Eval 05: Concurrent jobs - needs isolated resources"
    echo "    - Eval 06: Stuck detection (simulates Lambda crash, container auto-restarts)"
    echo "    - Eval 07: Stuck ack recovery - global maintenance task scan"
    echo "    - Eval 08: Health metrics (global job scan)"
    echo "    - Eval 09: Orphaned job recovery - global maintenance task scan"
    echo ""
    log_info "For purely sequential execution, use: --in-band"
  fi
else
  echo "Execution Plan:"
  echo ""
  echo "  Sequential execution: ${#EVALS_TO_RUN[@]} evals"
  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    echo "    - [$eval_id] $eval_dir"
  done
  echo ""
fi

sleep 2

################################################################################
# Run Evals - Parallel Mode
################################################################################

if [ "$MODE" = "parallel" ]; then

  PASS_COUNT=0
  FAIL_COUNT=0
  TIMEOUT_COUNT=0
  ERROR_COUNT=0
  XFAIL_COUNT=0
  UPASS_COUNT=0
  SKIP_COUNT=0
  TOTAL_DURATION=0

  #############################################################################
  # PHASE 1: Run safe evals in parallel
  #############################################################################

  if [ ${#SAFE_TO_RUN[@]} -gt 0 ]; then
    log_section "PHASE 1: PARALLEL EXECUTION (SAFE EVALS)"
    if [ $MAX_PARALLEL -gt 0 ] && [ ${#SAFE_TO_RUN[@]} -gt $MAX_PARALLEL ]; then
      log_info "Starting ${#SAFE_TO_RUN[@]} evals with max $MAX_PARALLEL concurrent..."
    else
      log_info "Starting ${#SAFE_TO_RUN[@]} evals concurrently..."
    fi
    echo ""

    for eval_spec in "${SAFE_TO_RUN[@]}"; do
      # Throttle: wait if we've hit the max-parallel limit
      if [ $MAX_PARALLEL -gt 0 ]; then
        while true; do
          running=0
          for pid_key in "${!PIDS[@]}"; do
            if kill -0 "${PIDS[$pid_key]}" 2>/dev/null; then
              running=$((running + 1))
            fi
          done
          if [ $running -lt $MAX_PARALLEL ]; then
            break
          fi
          sleep 0.5
        done
      fi

      IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
      eval_name=$(basename "$eval_dir")
      result_file="$RESULTS_DIR/${eval_id}_${eval_name}_${TIMESTAMP}.log"

      base_timeout=${PARALLEL_TIMEOUTS[$eval_id]:-180}
      timeout_val=$((base_timeout + ADDITIONAL_TIMEOUT))

      (
        start_time=$(date +%s)
        cd "$EVAL_DIR/$eval_dir"
        # Pass ADDITIONAL_TIMEOUT/SE_QUICK to the test script via environment variable
        # This allows the test script to adjust its internal timeouts/polls
        export ADDITIONAL_TIMEOUT SE_QUICK

        set +e
        timeout "$timeout_val" ./test.sh > "$result_file" 2>&1
        exit_code=$?
        set -e
        end_time=$(date +%s)
        duration=$((end_time - start_time))
        verdict="$(se_verdict_from_exit "$exit_code" "${XFAIL_ANCHOR[$eval_id]:-0}")"
        echo "${verdict}:${duration}" >> "$result_file"
      ) &

      PIDS[$eval_id]=$!
    done

    # Monitor progress
    COMPLETED=0
    RUNNING=${#SAFE_TO_RUN[@]}
    DISPLAY_COUNT=0

    while [ $RUNNING -gt 0 ]; do
      sleep 0.5

      RUNNING=0
      COMPLETED=0

      for eval_spec in "${SAFE_TO_RUN[@]}"; do
        IFS=':' read -r eval_id eval_dir <<< "$eval_spec"

        if [ -n "${PIDS[$eval_id]}" ]; then
          if kill -0 "${PIDS[$eval_id]}" 2>/dev/null; then
            RUNNING=$((RUNNING + 1))
          else
            if [ -z "${RESULTS[$eval_id]}" ]; then
              wait "${PIDS[$eval_id]}" 2>/dev/null || true
              eval_name=$(basename "$eval_dir")
              result_file="$RESULTS_DIR/${eval_id}_${eval_name}_${TIMESTAMP}.log"

              if [ -f "$result_file" ]; then
                result_line=$(tail -n 1 "$result_file")
                RESULTS[$eval_id]=$(echo "$result_line" | cut -d':' -f1)
                DURATIONS[$eval_id]=$(echo "$result_line" | cut -d':' -f2)

                # Strip ANSI codes from log file
                temp_file=$(mktemp)
                strip_ansi_codes < "$result_file" > "$temp_file"
                mv "$temp_file" "$result_file"

                # Extract Job ID
                job_id=$(grep -o "Job ID: [a-f0-9-]*" "$result_file" | cut -d' ' -f3 | head -n 1)
                if [ -n "$job_id" ]; then
                    JOB_IDS[$eval_id]="$job_id"
                fi

                # Extract Correlation ID
                correlation_id=$(grep -o "Correlation ID: [a-f0-9-]*" "$result_file" | cut -d' ' -f3 | head -n 1)
                if [ -n "$correlation_id" ]; then
                    CORRELATION_IDS[$eval_id]="$correlation_id"
                fi

                # Extract Notes (last failure message or relevant info)
                if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
                    # Try to find specific error message
                    error_msg=$(grep -i "error" "$result_file" | tail -n 1 | sed 's/.*Error: //')
                    if [ -z "$error_msg" ]; then
                         error_msg=$(tail -n 1 "$result_file")
                    fi
                    NOTES[$eval_id]="${error_msg:0:50}..."
                fi

                # Collect forensics if failed
                if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
                    collect_failure_logs "$eval_id" "$job_id" "$RESULTS_DIR"
                fi
              else
                RESULTS[$eval_id]="ERROR"
                DURATIONS[$eval_id]=0
              fi

              COMPLETED=$((COMPLETED + 1))
            else
              COMPLETED=$((COMPLETED + 1))
            fi
          fi
        fi
      done

      # Display progress with eval names and status
      DISPLAY_COUNT=$((DISPLAY_COUNT + 1))
      if [ $((DISPLAY_COUNT % 6)) -eq 0 ]; then
        # Clear and display current status of all evals (3 per line)
        count=0
        for eval_spec in "${SAFE_TO_RUN[@]}"; do
          IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
          eval_name=$(basename "$eval_dir")
          status="${RESULTS[$eval_id]:-RUNNING}"

          if [ "$status" = "RUNNING" ] || [ -z "$status" ]; then
            printf "[%s] %s: %s     " "$eval_id" "$eval_name" "RUNNING"
          else
            printf "[%s] %s: %s     " "$eval_id" "$eval_name" "DONE"
          fi

          count=$((count + 1))
          if [ $((count % 3)) -eq 0 ]; then
            echo ""
          fi
        done

        echo ""
        echo "Progress: $COMPLETED/${#SAFE_TO_RUN[@]} completed, $RUNNING running"
        echo ""
      fi
    done

    # Clear progress line and show completion
    printf "\r\033[K"
    log_success "Phase 1 complete - all safe evals finished!"
    echo ""
  fi

  #############################################################################
  # PHASE 2: Run destructive evals sequentially
  #############################################################################

  if [ ${#DESTRUCTIVE_TO_RUN[@]} -gt 0 ]; then
    log_section "PHASE 2: SEQUENTIAL EXECUTION (DESTRUCTIVE EVALS)"
    log_warning "These evals kill shared resources and must run one at a time"
    echo ""

    DESTRUCTIVE_EVAL_INDEX=0
    for eval_spec in "${DESTRUCTIVE_TO_RUN[@]}"; do
      IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
      eval_name=$(basename "$eval_dir")
      result_file="$RESULTS_DIR/${eval_id}_${eval_name}_${TIMESTAMP}.log"

      # No purge between destructive evals - rely on initial purge only
      # Note: fromBeginning: false in consumers means new messages only
      DESTRUCTIVE_EVAL_INDEX=$((DESTRUCTIVE_EVAL_INDEX + 1))

      log_info "Running [$eval_id] $eval_name..."

      base_timeout=${PARALLEL_TIMEOUTS[$eval_id]:-120}
      timeout_val=$((base_timeout + ADDITIONAL_TIMEOUT))

      start_time=$(date +%s)
      cd "$EVAL_DIR/$eval_dir"
      export ADDITIONAL_TIMEOUT SE_QUICK

      set +e
      timeout "$timeout_val" ./test.sh > "$result_file" 2>&1
      exit_code=$?
      set -e
      end_time=$(date +%s)
      duration=$((end_time - start_time))
      verdict="$(se_verdict_from_exit "$exit_code" "${XFAIL_ANCHOR[$eval_id]:-0}")"
      echo "${verdict}:${duration}" >> "$result_file"  # Append marker for analyze-results.sh
      RESULTS[$eval_id]="$verdict"
      DURATIONS[$eval_id]=$duration
      if [ "$verdict" = "PASS" ] || [ "$verdict" = "XFAIL" ] || [ "$verdict" = "SKIP" ]; then
        log_success "[$eval_id] $verdict (${duration}s)"
      else
        log_error "[$eval_id] $verdict (${duration}s)"
      fi

      # Strip ANSI codes from log file
      temp_file=$(mktemp)
      strip_ansi_codes < "$result_file" > "$temp_file"
      mv "$temp_file" "$result_file"

      # Extract Job ID
      job_id=$(grep -o "Job ID: [a-f0-9-]*" "$result_file" | cut -d' ' -f3 | head -n 1)
      if [ -n "$job_id" ]; then
          JOB_IDS[$eval_id]="$job_id"
      fi

      # Extract Notes
      if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
          error_msg=$(grep -i "error" "$result_file" | tail -n 1 | sed 's/.*Error: //')
          if [ -z "$error_msg" ]; then
                error_msg=$(tail -n 1 "$result_file")
          fi
          NOTES[$eval_id]="${error_msg:0:50}..."
      fi

      # Collect forensics if failed
      if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
          collect_failure_logs "$eval_id" "$job_id" "$RESULTS_DIR"
      fi

      # Stabilization after eval 06 (stuck-in-progress-detection)
      # This eval kills Lambda workers and the system needs time to recover
      # before running eval 07 (stuck-ack-recovery). LocalStack needs ~20s to
      # spin up new Lambda containers after a container is killed.
      if [ "$eval_id" == "06" ]; then
        log_info "Stabilizing after eval 06 (Lambda workers recovering)..."
        sleep 20
        log_success "Stabilization complete"
      fi

      echo ""
    done

    log_success "Phase 2 complete - all destructive evals finished!"
    echo ""
  fi

  #############################################################################
  # Collect Results from both phases
  #############################################################################

  log_section "COLLECTING RESULTS"

  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    IFS=':' read -r eval_id _ <<< "$eval_spec"

    result="${RESULTS[$eval_id]}"
    duration="${DURATIONS[$eval_id]:-0}"
    # Ensure duration is numeric and force base-10
    duration="${duration//[^0-9]/}"
    duration="${duration:-0}"
    duration=$((10#$duration))

    case "$result" in
      PASS)
        PASS_COUNT=$((PASS_COUNT + 1))
        ;;
      XFAIL)
        XFAIL_COUNT=$((XFAIL_COUNT + 1))
        ;;
      UPASS)
        UPASS_COUNT=$((UPASS_COUNT + 1))
        ;;
      SKIP)
        SKIP_COUNT=$((SKIP_COUNT + 1))
        ;;
      FAIL)
        FAIL_COUNT=$((FAIL_COUNT + 1))
        ;;
      TIMEOUT)
        TIMEOUT_COUNT=$((TIMEOUT_COUNT + 1))
        ;;
      ERROR)
        ERROR_COUNT=$((ERROR_COUNT + 1))
        ;;
    esac

    TOTAL_DURATION=$((TOTAL_DURATION + duration))
  done

################################################################################
# Run Evals - In-Band Mode
################################################################################

else
  # In-band sequential execution

  PASS_COUNT=0
  FAIL_COUNT=0
  TIMEOUT_COUNT=0
  XFAIL_COUNT=0
  UPASS_COUNT=0
  SKIP_COUNT=0
  TOTAL_DURATION=0

  log_section "RUNNING EVALUATIONS"

  eval_num=0
  total_evals=${#EVALS_TO_RUN[@]}

  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    eval_num=$((eval_num + 1))
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    eval_name=$(basename "$eval_dir")

    echo ""
    log_info "[$eval_num/$total_evals] Running: $eval_name"
    echo ""

    result_file="$RESULTS_DIR/${eval_id}_${eval_name}_${TIMESTAMP}.log"

    base_timeout=${PARALLEL_TIMEOUTS[$eval_id]:-120}
    timeout_val=$((base_timeout + ADDITIONAL_TIMEOUT))

    start_time=$(date +%s)
    cd "$EVAL_DIR/$eval_dir"

    # Pass ADDITIONAL_TIMEOUT/SE_QUICK to the test script via environment variable
    export ADDITIONAL_TIMEOUT SE_QUICK

    set +e
    timeout "$timeout_val" ./test.sh > "$result_file" 2>&1
    exit_code=$?
    set -e
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    verdict="$(se_verdict_from_exit "$exit_code" "${XFAIL_ANCHOR[$eval_id]:-0}")"
    RESULTS[$eval_id]="$verdict"
    DURATIONS[$eval_id]=$duration
    echo "${verdict}:${duration}" >> "$result_file"
    case "$verdict" in
      PASS)  PASS_COUNT=$((PASS_COUNT + 1)); log_success "$eval_name completed in ${duration}s" ;;
      XFAIL) XFAIL_COUNT=$((XFAIL_COUNT + 1)); log_success "$eval_name XFAIL (expected) in ${duration}s" ;;
      SKIP)  SKIP_COUNT=$((SKIP_COUNT + 1)); log_warning "$eval_name SKIPPED after ${duration}s" ;;
      UPASS) UPASS_COUNT=$((UPASS_COUNT + 1)); log_error "$eval_name UPASS (unexpected pass) after ${duration}s" ;;
      TIMEOUT) TIMEOUT_COUNT=$((TIMEOUT_COUNT + 1)); log_error "$eval_name TIMED OUT after ${duration}s" ;;
      FAIL)  FAIL_COUNT=$((FAIL_COUNT + 1)); log_error "$eval_name failed after ${duration}s" ;;
    esac

    # Strip ANSI codes from log file
    temp_file=$(mktemp)
    strip_ansi_codes < "$result_file" > "$temp_file"
    mv "$temp_file" "$result_file"

    # Extract Job ID
    job_id=$(grep -o "Job ID: [a-f0-9-]*" "$result_file" | cut -d' ' -f3 | head -n 1)
    if [ -n "$job_id" ]; then
        JOB_IDS[$eval_id]="$job_id"
    fi

    # Extract Correlation ID
    correlation_id=$(grep -o "Correlation ID: [a-f0-9-]*" "$result_file" | cut -d' ' -f3 | head -n 1)
    if [ -n "$correlation_id" ]; then
        CORRELATION_IDS[$eval_id]="$correlation_id"
    fi

    # Extract Notes
    if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
        error_msg=$(grep -i "error" "$result_file" | tail -n 1 | sed 's/.*Error: //')
        if [ -z "$error_msg" ]; then
              error_msg=$(tail -n 1 "$result_file")
        fi
        NOTES[$eval_id]="${error_msg:0:50}..."
    fi

    # Collect forensics if failed
    if ! se_is_ok_verdict "${RESULTS[$eval_id]}"; then
        collect_failure_logs "$eval_id" "$job_id" "$RESULTS_DIR"
    fi

    TOTAL_DURATION=$((TOTAL_DURATION + duration))

    # Stabilization after eval 06 (stuck-in-progress-detection)
    # This eval kills Lambda workers and the system needs time to recover
    # before running eval 07 (stuck-ack-recovery)
    if [ "$eval_id" == "06" ]; then
      log_info "Stabilizing after eval 06 (Lambda workers recovering)..."
      sleep 10
      log_success "Stabilization complete"
    fi

    # Purge between evals if explicitly requested (not recommended)
    if [ "$PURGE_BETWEEN" = true ] && [ $eval_num -lt $total_evals ]; then
      log_info "Purging system before next eval (--purge-between flag)..."
      "$REPO_ROOT/scripts/local-env.sh" purge --fast > /dev/null 2>&1
      sleep 2
    fi
  done
fi

################################################################################
# Display Results Summary
################################################################################

log_section "EVALUATION SUMMARY"

echo ""
echo "+===========================================================================================================================================================================+"
echo "|                                                    CORE SE RESULTS                                                                                                      |"
echo "+===========================================================================================================================================================================+"
echo "| ID  | Name                         | Time   | Status   | Job ID                               | Correlation ID                       | Notes            |"
echo "+===========================================================================================================================================================================+"

for eval_spec in "${EVALS_TO_RUN[@]}"; do
  IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
  eval_name=$(basename "$eval_dir")

  result="${RESULTS[$eval_id]}"
  duration="${DURATIONS[$eval_id]:-0}"
  job_id="${JOB_IDS[$eval_id]:--}"
  correlation_id="${CORRELATION_IDS[$eval_id]:--}"
  notes="${NOTES[$eval_id]:-}"

  # Ensure duration is numeric
  duration="${duration//[^0-9]/}"
  duration="${duration:-0}"

  if [ "$duration" -ge 60 ]; then
    duration_str=$(printf "%dm %02ds" $((duration / 60)) $((duration % 60)))
  else
    duration_str="${duration}s"
  fi

  if [ "$result" = "PASS" ] || [ "$result" = "PASSED" ]; then
    status="${GREEN}PASS${NC}"
  elif [ "$result" = "XFAIL" ]; then
    status="${GREEN}XFAIL${NC}"
  elif [ "$result" = "SKIP" ]; then
    status="${YELLOW}SKIP${NC}"
  elif [ "$result" = "UPASS" ]; then
    status="${RED}UPASS${NC}"
  elif [ "$result" = "TIMEOUT" ]; then
    status="${YELLOW}TIME${NC}"
  elif [ "$result" = "ERROR" ]; then
    status="${RED}ERR ${NC}"
  else
    status="${RED}FAIL${NC}"
  fi

  # Format line with columns (ID | Name | Time | Status | Job ID | Correlation ID | Notes)
  printf "| %-3s | %-28s | %-6s | %-8s | %-36s | %-36s | %-16s |\n" "$eval_id" "${eval_name:0:28}" "$duration_str" "$status" "${job_id}" "${correlation_id}" "${notes:0:16}"
done

echo "+===========================================================================================================================================================================+"

echo -e "| ${GREEN}PASSED:${NC}  $(printf "%-3d" "${PASS_COUNT:-0}")    ${GREEN}XFAIL:${NC}  $(printf "%-3d" "${XFAIL_COUNT:-0}")    ${RED}FAILED:${NC}  $(printf "%-3d" "${FAIL_COUNT:-0}")    ${RED}UPASS:${NC}  $(printf "%-3d" "${UPASS_COUNT:-0}")    ${YELLOW}SKIP:${NC}  $(printf "%-3d" "${SKIP_COUNT:-0}")    ${CYAN}TOTAL:${NC} $(printf "%4ds" "${TOTAL_DURATION:-0}")                                                                                     |"

echo "+===========================================================================================================================================================================+"

# Ensure TOTAL_DURATION is numeric
TOTAL_DURATION="${TOTAL_DURATION:-0}"
if [ "$TOTAL_DURATION" -ge 60 ]; then
  total_duration_str=$(printf "%dm %02ds" $((TOTAL_DURATION / 60)) $((TOTAL_DURATION % 60)))
else
  total_duration_str="${TOTAL_DURATION}s"
fi

echo -e "| Total Duration: $(printf "%-161s" "$total_duration_str")|"
echo "| Execution Mode: $(printf "%-161s" "${MODE^^}")|"
echo "+===========================================================================================================================================================================+"
echo ""

################################################################################
# Generate Machine-Readable JSON Results
################################################################################

RESULTS_JSON="$RESULTS_DIR/results.json"
{
  echo "{"
  echo "  \"timestamp\": \"$TIMESTAMP\","
  echo "  \"mode\": \"$MODE\","
  echo "  \"totalDurationSeconds\": ${TOTAL_DURATION:-0},"
  echo "  \"summary\": {"
  echo "    \"total\": ${#EVALS_TO_RUN[@]},"
  echo "    \"passed\": ${PASS_COUNT:-0},"
  echo "    \"failed\": ${FAIL_COUNT:-0},"
  echo "    \"timedOut\": ${TIMEOUT_COUNT:-0},"
  echo "    \"errors\": ${ERROR_COUNT:-0},"
  echo "    \"xfail\": ${XFAIL_COUNT:-0},"
  echo "    \"upass\": ${UPASS_COUNT:-0},"
  echo "    \"skipped\": ${SKIP_COUNT:-0}"
  echo "  },"
  echo "  \"evals\": ["
  json_first=true
  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    eval_name=$(basename "$eval_dir")
    result="${RESULTS[$eval_id]}"
    duration="${DURATIONS[$eval_id]:-0}"
    duration="${duration//[^0-9]/}"
    duration="${duration:-0}"
    job_id="${JOB_IDS[$eval_id]:-}"
    correlation_id="${CORRELATION_IDS[$eval_id]:-}"
    note="${NOTES[$eval_id]:-}"
    # Escape double quotes in notes for valid JSON
    note="${note//\"/\\\"}"

    [ "$json_first" = true ] && json_first=false || echo ","
    echo -n "    {\"id\":\"$eval_id\",\"name\":\"$eval_name\",\"result\":\"$result\",\"durationSeconds\":$duration,\"jobId\":\"$job_id\",\"correlationId\":\"$correlation_id\",\"notes\":\"$note\"}"
  done
  echo ""
  echo "  ]"
  echo "}"
} > "$RESULTS_JSON"

log_info "JSON results saved to: $RESULTS_JSON"

# In CI mode, also output JSON to stdout for pipeline consumption
if [ "$CI_MODE" = true ]; then
  echo ""
  echo "--- JSON_RESULTS_START ---"
  cat "$RESULTS_JSON"
  echo "--- JSON_RESULTS_END ---"
  echo ""
fi

################################################################################
# Display Failure Details
################################################################################

if [ "${FAIL_COUNT:-0}" -gt 0 ] || [ "${TIMEOUT_COUNT:-0}" -gt 0 ] || [ "${ERROR_COUNT:-0}" -gt 0 ] || [ "${UPASS_COUNT:-0}" -gt 0 ]; then
  log_section "FAILURE DETAILS"

  for eval_spec in "${EVALS_TO_RUN[@]}"; do
    IFS=':' read -r eval_id eval_dir <<< "$eval_spec"
    result="${RESULTS[$eval_id]}"

    if [ "$result" = "FAIL" ] || [ "$result" = "FAILED" ] || [ "$result" = "ERROR" ] || [ "$result" = "TIMEOUT" ] || [ "$result" = "UPASS" ]; then
      eval_name=$(basename "$eval_dir")
      result_file="$RESULTS_DIR/${eval_id}_${eval_name}_${TIMESTAMP}.log"

      echo -e "${RED}------------------------------------------------------------------${NC}"
      echo -e "${RED}[$eval_id] $eval_name - $result${NC}"
      echo -e "${RED}------------------------------------------------------------------${NC}"

      echo -e "${CYAN}Last 30 lines of output:${NC}"
      tail -n 30 "$result_file"
      echo ""

      echo -e "${BLUE}Full log: $result_file${NC}"
      echo ""
    fi
  done
fi

################################################################################
# Final Status Summary
################################################################################

log_section "FINAL STATUS"

# A run is clean iff nothing FAILED/TIMED-OUT/ERRORED/UPASSED. PASS, XFAIL (expected fail,
# anchored) and SKIP (exit-77 sentinel) are all "not a problem" outcomes.
PROBLEM_COUNT=$(( ${FAIL_COUNT:-0} + ${TIMEOUT_COUNT:-0} + ${ERROR_COUNT:-0} + ${UPASS_COUNT:-0} ))

if [ "$PROBLEM_COUNT" -eq 0 ]; then
  log_success "ALL EVALUATIONS PASSED! (${PASS_COUNT:-0} pass, ${XFAIL_COUNT:-0} xfail, ${SKIP_COUNT:-0} skip)"
  log_info "Results saved to: $RESULTS_DIR"
  FINAL_EXIT_CODE=0
elif [ "${FAIL_COUNT:-0}" -eq 0 ] && [ "${UPASS_COUNT:-0}" -eq 0 ]; then
  log_warning "SOME EVALUATIONS TIMED OUT OR HAD ERRORS"
  log_info "Review failure details above"
  log_info "Results saved to: $RESULTS_DIR"
  FINAL_EXIT_CODE=1
else
  log_error "SOME EVALUATIONS FAILED"
  log_info "Review failure details above"
  log_info "Results saved to: $RESULTS_DIR"
  FINAL_EXIT_CODE=1
fi

echo ""

################################################################################
# Detailed Analysis Table (shown last for easy summary view)
################################################################################

log_section "DETAILED ANALYSIS"

  # Run the analyzer on the results
if [ -x "$SCRIPT_DIR/analyze-results.sh" ]; then
  # Force output flush and ensure it's visible
  # Run analyzer, tee to stdout (for run.log/console) and also pipe to sed -> analysis_report.log (stripped of ANSI codes)
  "$SCRIPT_DIR/analyze-results.sh" "$RESULTS_DIR" 2>&1 | tee >(sed 's/\x1b\[[0-9;]*m//g' > "$RESULTS_DIR/analysis_report.log") || {
    log_error "Analyzer failed with exit code: $?"
    log_info "Run manually: ./setpoint-evals/analyze-results.sh $RESULTS_DIR"
  }
else
  log_warning "Analyzer script not found or not executable"
  log_info "Run manually: ./setpoint-evals/analyze-results.sh $RESULTS_DIR"
fi

echo ""

################################################################################
# Workflow SEs (--all-workflows flag)
################################################################################

if [ "$ALL_WORKFLOWS" = true ]; then
  log_section "WORKFLOW SEs"

  WORKFLOW_RUNNERS=()
  if [ -d "$REPO_ROOT/workflows" ]; then
    for workflow_runner in "$REPO_ROOT"/workflows/*/setpoint-evals/run-all.sh; do
      if [ -f "$workflow_runner" ]; then
        # Skip template directories (00-* prefix)
        wf_dir=$(basename "$(dirname "$(dirname "$workflow_runner")")")
        if [[ "$wf_dir" == 00-* ]]; then
          continue
        fi
        WORKFLOW_RUNNERS+=("$workflow_runner")
      fi
    done
  fi

  if [ ${#WORKFLOW_RUNNERS[@]} -eq 0 ]; then
    log_info "No workflow SEs found in workflows/*/setpoint-evals/run-all.sh"
  else
    log_info "Found ${#WORKFLOW_RUNNERS[@]} workflow SE runner(s)"
    echo ""

    WORKFLOW_FAILURES=0
    for runner in "${WORKFLOW_RUNNERS[@]}"; do
      workflow_name=$(basename "$(dirname "$(dirname "$runner")")")
      log_info "Running workflow SE: $workflow_name"
      echo "  Runner: $runner"
      echo ""

      # Build workflow runner args: pass through mode and max-parallel.
      # --skip-checks (not just --skip-warmup): the core run's preflight already
      # validated the whole stack; re-running it per suite is redundant AND its
      # warning path prompts interactively (read -p), which aborts when the
      # delegated runner has no TTY (this exact failure shipped once — the
      # 2026-07-15 verification run had core 13/13 green and all 3 workflow
      # suites "failed" on that prompt).
      workflow_args=""
      if [ "$MODE" = "in-band" ]; then
        workflow_args="$workflow_args --in-band"
      fi
      if [ $MAX_PARALLEL -gt 0 ]; then
        workflow_args="$workflow_args --max-parallel=$MAX_PARALLEL"
      fi
      if [ "$CI_MODE" = true ]; then
        workflow_args="$workflow_args --ci-mode"
      fi
      workflow_args="$workflow_args --skip-checks --skip-warmup"

      if "$runner" $workflow_args; then
        log_success "Workflow '$workflow_name' SEs passed"
      else
        log_error "Workflow '$workflow_name' SEs failed"
        WORKFLOW_FAILURES=$((WORKFLOW_FAILURES + 1))
      fi
      echo ""
    done

    if [ $WORKFLOW_FAILURES -gt 0 ]; then
      log_error "$WORKFLOW_FAILURES workflow SE suite(s) failed"
      FINAL_EXIT_CODE=1
    else
      log_success "All workflow SEs passed"
    fi
  fi

  echo ""
fi

################################################################################
# Final Exit
################################################################################

exit $FINAL_EXIT_CODE
