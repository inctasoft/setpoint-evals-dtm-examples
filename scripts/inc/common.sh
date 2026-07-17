#!/bin/bash

# Common functions and variables for all scripts

# Load API configuration first
# Note: Use COMMON_INC_DIR to avoid overwriting SCRIPT_DIR from calling script
COMMON_INC_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${COMMON_INC_DIR}/api-config.sh"

# Color codes for output
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export RED='\033[0;31m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export BOLD='\033[1m'
export NC='\033[0m' # No Color

# Get project root directory (compatible with bash and zsh)
get_project_root() {
    local script_dir="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
    echo "$( cd "$script_dir/../.." && pwd )"
}

# Print colored messages
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${GREEN}→${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${1}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

# Self-heal an aged .env that predates newly-added keys in .env.example.
# postinstall (scripts/setup-env.cjs) only ever creates .env when it's
# MISSING — a checkout whose .env survives across many `pnpm install` runs
# (the common case for a long-lived main checkout, vs. a throwaway worktree)
# never gets new keys added to .env.example after it was first created. Bit
# the Fix-4c bring-up: DISABLE_AUTH/ENABLE_EVAL_RUN_API were added to
# .env.example after this checkout's .env was generated, so the orchestrator
# booted auth-walled and every SE 401ed (0% pass) with no indication why.
# Called at the top of local-env.sh's start_standalone/start_integrated —
# every "start" run — so it can't silently ship a wall of 401s again.
check_env_freshness() {
    local project_root example_file env_file
    project_root="$(get_project_root)"
    env_file="$project_root/.env"
    example_file="$project_root/.env.example"

    # Nothing to diff against, or .env not created yet (postinstall's job) —
    # not this function's concern.
    [ -f "$env_file" ] || return 0
    [ -f "$example_file" ] || return 0

    local missing=() key
    while IFS='=' read -r key _; do
        [ -z "$key" ] && continue
        grep -qE "^${key}=" "$env_file" || missing+=("$key")
    done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$example_file")

    [ "${#missing[@]}" -eq 0 ] && return 0

    print_warning "Your .env is missing ${#missing[@]} key(s) present in .env.example (aged checkout — new keys were added since your .env was created):"
    for key in "${missing[@]}"; do
        echo -e "    ${YELLOW}-${NC} $key"
    done
    print_info "Auto-appending the missing keys (with .env.example's dev defaults) to .env ..."
    {
        echo ""
        echo "# --- auto-appended by check_env_freshness (scripts/inc/common.sh) on $(date -u +%Y-%m-%dT%H:%M:%SZ) ---"
        echo "# Missing from this .env, sourced verbatim from .env.example. Review before relying on them."
        for key in "${missing[@]}"; do
            grep -E "^${key}=" "$example_file"
        done
    } >> "$env_file"
    print_warning "If any services are already running, a bare restart will NOT pick this up — recreate with the same --env-file/profiles this script uses (see DIFFICULTIES-LOG.md 'Stale .env')."
    return 0
}

# Check if Docker is running
check_docker() {
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker first."
        return 1
    fi
    return 0
}

# Check if network exists
check_network() {
    local network_name="$1"
    if ! docker network inspect "$network_name" &> /dev/null; then
        print_warning "Network '$network_name' does not exist"
        print_info "Run ${GREEN}./bin/init.sh${NC} first to initialize the environment"
        return 1
    fi
    return 0
}

# Check if service is running
check_service_running() {
    local service_name="$1"
    if docker ps --format '{{.Names}}' | grep -q "^${service_name}$"; then
        return 0
    else
        return 1
    fi
}

# Wait for service to be healthy
wait_for_healthy() {
    local service_name="$1"
    local max_wait="${2:-30}"
    local count=0
    
    print_info "Waiting for $service_name to be healthy..."
    
    while [ $count -lt $max_wait ]; do
        if docker ps --format '{{.Names}}\t{{.Status}}' | grep "$service_name" | grep -q "healthy"; then
            print_success "$service_name is healthy"
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    
    print_warning "$service_name did not become healthy within ${max_wait}s"
    return 1
}

# Start docker compose service
start_compose_service() {
    local compose_file="$1"
    local service_description="$2"
    local detached="${3:-true}"
    local build="${4:-false}"
    local extra_flags="${5:-}"
    
    local flags=""
    [ "$detached" = true ] && flags="$flags -d"
    [ "$build" = true ] && flags="$flags --build"
    [ -n "$extra_flags" ] && flags="$flags $extra_flags"
    
    print_info "Starting $service_description..."
    
    if docker compose --env-file .env -f "$compose_file" up $flags; then
        print_success "$service_description started"
        return 0
    else
        print_error "Failed to start $service_description"
        return 1
    fi
}

# Stop docker compose service
stop_compose_service() {
    local compose_file="$1"
    local service_description="$2"
    local remove_volumes="${3:-false}"
    
    local flags=""
    [ "$remove_volumes" = true ] && flags="-v"
    
    print_info "Stopping $service_description..."
    
    if docker compose --env-file .env -f "$compose_file" down $flags; then
        print_success "$service_description stopped"
        return 0
    else
        print_error "Failed to stop $service_description"
        return 1
    fi
}

