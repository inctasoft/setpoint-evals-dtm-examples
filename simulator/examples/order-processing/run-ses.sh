#!/bin/bash
# ============================================================================
# Order-Processing — Simulator SE Runner
# ============================================================================
#
# Builds the workflow, starts the simulator stack, runs all SEs,
# and tears down the environment.
#
# Usage:
#   bash simulator/examples/order-processing/run-stes.sh
#
# Options:
#   --no-build       Skip building workflow packages
#   --no-teardown    Leave the simulator running after SEs complete
#   --build-only     Build workflow packages and simulator images, then exit
#
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# Parse options
NO_BUILD=false
NO_TEARDOWN=false
BUILD_ONLY=false

for arg in "$@"; do
  case $arg in
    --no-build)    NO_BUILD=true ;;
    --no-teardown) NO_TEARDOWN=true ;;
    --build-only)  BUILD_ONLY=true ;;
    *)             echo "Unknown option: $arg"; exit 1 ;;
  esac
done

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  Order-Processing — Simulator SE Runner                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ────────────────────────────────────────────────────────────────
# Step 1: Build workflow packages
# ────────────────────────────────────────────────────────────────
if [ "$NO_BUILD" = false ]; then
  echo "━━━ Step 1: Building workflow packages ━━━"
  echo ""

  cd "$REPO_ROOT"

  echo "  Building @dtm/core..."
  pnpm --filter @dtm/core run build

  echo "  Building @dtm/errors..."
  pnpm --filter @dtm/errors run build

  echo "  Building @dtm/worker-sdk..."
  pnpm --filter @dtm/worker-sdk run build

  echo "  Building @dtm-workflows/order-processing..."
  pnpm --filter @dtm-workflows/order-processing run build

  echo "  Building @dtm-workflows/order-processing-typeorm..."
  pnpm --filter @dtm-workflows/order-processing-typeorm run build

  echo "  Building @dtm-workflows/order-processing-workers..."
  pnpm --filter @dtm-workflows/order-processing-workers run build

  echo ""
  echo "  ✅ All workflow packages built"
  echo ""
else
  echo "━━━ Step 1: Skipping build (--no-build) ━━━"
  echo ""
fi

# ────────────────────────────────────────────────────────────────
# Step 2: Build and start simulator stack
# ────────────────────────────────────────────────────────────────
echo "━━━ Step 2: Starting simulator stack ━━━"
echo ""

cd "$SCRIPT_DIR"

# Build images
echo "  Building simulator Docker images..."
docker compose -f "$COMPOSE_FILE" build

if [ "$BUILD_ONLY" = true ]; then
  echo ""
  echo "  ✅ Build complete (--build-only)"
  exit 0
fi

# Start services
echo "  Starting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "  Waiting for services to become healthy..."

# Wait for orchestrator health
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost:3010/api/v1/health > /dev/null 2>&1; then
    echo "  ✅ Orchestrator healthy (${WAITED}s)"
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
  if [ $((WAITED % 20)) -eq 0 ]; then
    echo "  ... still waiting for orchestrator (${WAITED}s / ${MAX_WAIT}s)"
  fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "  ❌ Orchestrator failed to become healthy after ${MAX_WAIT}s"
  echo ""
  echo "  Container logs:"
  docker compose -f "$COMPOSE_FILE" logs simulator-orchestrator --tail 50
  exit 1
fi

# Wait a bit for poller + ack to be ready
sleep 5

echo "  ✅ All services started"
echo ""

# ────────────────────────────────────────────────────────────────
# Step 3: Run SEs
# ────────────────────────────────────────────────────────────────
echo "━━━ Step 3: Running order-processing SEs ━━━"
echo ""

# Set environment variables for SE execution against the simulator
export ORCHESTRATOR_PORT=3010
export ORCHESTRATOR_BASE_URL="http://localhost:3010"
export API_BASE_URL="http://localhost:3010/api/v1"
export ORCHESTRATOR_HOST="http://localhost:3010"
export DEV_ACK_SIMULATOR_PORT=3011
export DEV_ACK_SIMULATOR_BASE_URL="http://localhost:3011"
export COMPOSE_PROJECT_NAME=simulator
export ENABLE_DEV_ACK_SIMULATOR=true
export ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true

# Run the workflow's SE suite
SE_DIR="$REPO_ROOT/workflows/order-processing/setpoint-evals"
SE_EXIT_CODE=0

if [ -f "$SE_DIR/run-all.sh" ]; then
  bash "$SE_DIR/run-all.sh" || SE_EXIT_CODE=$?
else
  echo "  ❌ SE runner not found at $SE_DIR/run-all.sh"
  SE_EXIT_CODE=1
fi

echo ""

# ────────────────────────────────────────────────────────────────
# Step 4: Teardown
# ────────────────────────────────────────────────────────────────
if [ "$NO_TEARDOWN" = false ]; then
  echo "━━━ Step 4: Tearing down simulator ━━━"
  echo ""
  docker compose -f "$COMPOSE_FILE" down -v
  echo "  ✅ Simulator stopped and volumes removed"
  echo ""
else
  echo "━━━ Step 4: Skipping teardown (--no-teardown) ━━━"
  echo "  Simulator is still running. Stop with:"
  echo "    docker compose -f $COMPOSE_FILE down -v"
  echo ""
fi

# ────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────
echo "╔════════════════════════════════════════════════════════════════╗"
if [ $SE_EXIT_CODE -eq 0 ]; then
  echo "║  ✅ All SEs PASSED                                          ║"
else
  echo "║  ❌ Some SEs FAILED (exit code: $SE_EXIT_CODE)                          ║"
fi
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

exit $SE_EXIT_CODE
