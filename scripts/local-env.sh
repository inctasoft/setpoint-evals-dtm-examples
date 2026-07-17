#!/bin/bash

# ============================================================================
# Local Environment Management Script
# Unified script for managing DTM development environment
# ============================================================================

set -e

# Get script directory and project root (compatible with bash and zsh)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

# Source common functions
source "$SCRIPT_DIR/inc/common.sh"

# ============================================================================
# Configuration
# ============================================================================

# Ensure COMPOSE_PROJECT_NAME is always set to 'dtm' for consistent container naming
# This ensures all containers created via this script use the 'dtm-' prefix
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dtm}"

# Environment file for Docker Compose variable substitution
ENV_FILE=".env"

# Docker Compose files
COMPOSE_MAIN="docker-compose.yml"
COMPOSE_KAFKA="docker-compose.kafka.yml"
COMPOSE_KAFKA_INIT_INTEGRATED="docker-compose.kafka-init-integrated.yml"
COMPOSE_ORCHESTRATOR_INTEGRATED="docker-compose.orchestrator-integrated.yml"
COMPOSE_ORDER_PROCESSING="workflows/order-processing/docker-compose.order-processing.yml"
COMPOSE_IOT_SENSOR="workflows/iot-sensor-pipeline/docker-compose.iot-sensor-pipeline.yml"
COMPOSE_INFRA_PROVISIONING="workflows/infra-provisioning/docker-compose.infra-provisioning.yml"
COMPOSE_WORKERS="docker-compose.workers.yml"
COMPOSE_WORKERS_DEV="docker-compose.workers.dev.yml"

# External Kafka Network (for integrated mode with the external system)
# Default network name matches the external system's docker-compose.yaml network
# Note: the external system uses the 'default' network, which Docker names as '<project-dir>_default'
EXTERNAL_KAFKA_NETWORK="${EXTERNAL_KAFKA_NETWORK:-external-system_default}"
# Default broker address matches the external system's Kafka service advertised listener
# Using 'kafka' as that's the advertised listener hostname (not a system-specific alias)
EXTERNAL_KAFKA_BROKER="${EXTERNAL_KAFKA_BROKER:-kafka:9092}"

# ============================================================================
# Helper Functions
# ============================================================================

# Get build flag for docker compose if --rebuild was specified
get_build_flag() {
    if [ "$REBUILD_FLAG" = true ]; then
        echo "--build"
    else
        echo ""
    fi
}

show_help() {
    cat << EOF
Local Environment Management

Usage: $0 <command> [options]

Commands:
  start --standalone [--orchestrator] [--monitor] [--build]          Start all services with local Kafka
  start --integrated [--orchestrator] [--monitor] [--build]          Start services using the external system's Kafka
  stop                                                               Stop all services
  deploy-workers [--count=N] [--debug-server] [--build]              Deploy Lambda workers (default: --count=10)
  scale-pollers [count]                                              Scale SQS poller replicas (no redeploy)
  list workers                                                       List deployed Lambda workers
  monitor api                                                        Monitor DTM jobs via API
  monitor sqs [queue-prefix]                                         Monitor SQS queues with DLQ status (optional filter prefix)
  monitor dashboard                                                  Start DTM Monitor dashboard (Vite dev on port 5173)
  logs [worker-name]                                                 Show logs for all services or specific Lambda worker
  purge [--full]                                                     Purge database (default) or all data with --full (keeps services running)
  reset                                                              Reset Kafka consumer groups (fixes 'coordinator' errors)
  clean                                                              Stop all services and remove volumes
  help                                                               Show this help message

Optional Flags:
  --orchestrator         Start orchestrator service in Docker (debug port 9230 always enabled)
                         Note: For debug mode, omit this flag and use VS Code to run orchestrator locally
  --monitor              Start the DTM Monitor dashboard (Vite dev server on port 5173)
  --build                Force rebuild of all Docker images (use after modifying Dockerfiles, init scripts, etc.)

Examples:
  # Standard Docker mode (all services in containers)
  $0 start --standalone                                 # Infrastructure only (for local orchestrator debugging)
  $0 start --standalone --orchestrator                  # Infrastructure + orchestrator in Docker
  $0 start --standalone --orchestrator --monitor         # Infrastructure + orchestrator + monitor dashboard
  $0 start --integrated --orchestrator                  # Integrated mode with orchestrator in Docker
  
  # Debug mode (orchestrator runs locally via VS Code, workers in-process)
  $0 start --standalone                                 # Start infrastructure (dev-ack-simulator included)
  $0 deploy-workers --debug-server                      # Stops orchestrator Docker if running, launches locally
  
  # Poller mode (orchestrator in Docker, workers via SQS polling)
  $0 start --standalone                                 # Start infrastructure only
  $0 deploy-workers                                     # Auto-starts orchestrator Docker if not running (10 pollers)

  # Other commands
  $0 start --standalone --build                         # Rebuild all images and start
  $0 deploy-workers                                     # Deploy Lambda workers (default: 10 pollers)
  $0 deploy-workers --count=5                           # Deploy Lambda workers with custom poller count
  $0 list workers                                       # List all deployed Lambda workers
  $0 monitor api                                        # Watch job progress via API
  $0 monitor sqs                                        # Watch all SQS queues + DLQs
  $0 logs                                               # Show logs for all Docker services
  $0 purge                                              # Fast purge: DB only (~2s)
  $0 purge --full                                       # Full purge: DB + SQS + Kafka (~20s)
  $0 reset                                              # Fix Kafka consumer group issues (after destructive tests)
  $0 stop                                               # Stop everything
  $0 clean                                              # Clean up all services and volumes

Service Details:
  Standalone mode starts:
    • Kafka + Zookeeper + Kafka UI
    • PostgreSQL (${COMPOSE_PROJECT_NAME:-dtm}-db)
    • PostgreSQL (order-processing-source-db)
    • PostgreSQL (iot-sensor-pipeline-source-db)
    • PostgreSQL (infra-provisioning-source-db)
    • LocalStack (AWS services)
    • dev-ack-simulator (always included for local development)
    • Orchestrator (if --orchestrator flag used)
    • SQS Poller (started via deploy-workers --poller)

  Debug mode workflow:
    1. Start infrastructure: ./scripts/local-env.sh start --standalone (NO --orchestrator flag)
    2. Deploy in debug mode: ./scripts/local-env.sh deploy-workers --debug-server
       → Stops orchestrator Docker container if running
       → Verifies dev-ack-simulator is running
       → Prepares for VS Code debugging
    3. Launch debugger in VS Code: F5 → "🎯 Full Stack Debug (Orchestrator + Workers)"
       → Orchestrator runs locally on port 3002 (debuggable)
       → All Lambda handlers run in-process (debuggable)
  
  Poller mode workflow:
    1. Start infrastructure: ./scripts/local-env.sh start --standalone (NO --orchestrator flag)
    2. Deploy workers: ./scripts/local-env.sh deploy-workers
       → Auto-starts orchestrator Docker container if not running
       → Deploys Lambda workers and starts 10 SQS poller replicas
  
  Integrated mode starts:
    • PostgreSQL (${COMPOSE_PROJECT_NAME:-dtm}-db)
    • PostgreSQL (order-processing-source-db)
    • PostgreSQL (iot-sensor-pipeline-source-db)
    • PostgreSQL (infra-provisioning-source-db)
    • LocalStack (AWS services)
    • dev-ack-simulator (temporarily included)
    • Orchestrator (if --orchestrator flag used)
    • SQS Poller (started via deploy-workers --poller)
    • Kafka topic initialization (connects to the external system's Kafka on 'backend' network)

EOF
}

# ============================================================================
# Start Commands
# ============================================================================

start_standalone() {
    print_header "${GREEN}🚀 Starting Standalone Environment${NC}"

    # Self-heal an aged .env missing keys added to .env.example since it was
    # created (postinstall only creates .env once, never refreshes it).
    check_env_freshness

    # Check Docker
    check_docker || exit 1
    
    # Clean up any stale debug processes that might interfere with Docker mode
    # This prevents Kafka consumer group conflicts where stale host processes
    # compete with Docker containers for partition assignments
    print_info "Cleaning up any stale debug processes..."
    pkill -9 -f "services/orchestrator/dist/src/main" 2>/dev/null || true
    pkill -9 -f "nest start.*orchestrator" 2>/dev/null || true
    pkill -9 -f "sqs-poller/src/poller.ts" 2>/dev/null || true
    pkill -9 -f "tsx.*poller.ts" 2>/dev/null || true
    rm -f /tmp/dtm-orchestrator.pid /tmp/dtm-poller.pid 2>/dev/null || true
    
    # Build workspace packages if debug mode is enabled and orchestrator is starting
    if [ "$START_ORCHESTRATOR" = true ]; then
        echo ""
        print_info "Preparing workspace for hot reload..."
        
        # Check if dependencies are installed
        if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
            print_warning "Node modules not found - running pnpm install..."
            cd "$PROJECT_ROOT"
            pnpm install
            if [ $? -ne 0 ]; then
                print_error "Failed to install dependencies"
                exit 1
            fi
            print_success "Dependencies installed"
            echo ""
        fi
        
        # Check if workspace artifacts need building (packages, workflows, ack-simulator).
        # The dev-ack-simulator and orchestrator bind-mount workflow dist/ directories,
        # so they all must be built before docker compose up.
        NEEDS_BUILD=false
        for d in packages/database/dist packages/kafka-producer/dist workflows/order-processing/dist workflows/iot-sensor-pipeline/dist workflows/infra-provisioning/dist workflows/plan-execution/dist tools/dev-ack-simulator/dist; do
          if [ ! -d "/" ]; then
            print_info "Missing "
            NEEDS_BUILD=true
          fi
        done

        if [ "" = true ]; then
            print_info "Building workspace artifacts (packages + workflows + tools)..."
            echo ""
            cd ""
            pnpm run build:packages \
              && pnpm run build:workflows \
              && pnpm run build:tools
            if [ 0 -ne 0 ]; then
                print_error "Failed to build workspace artifacts"
                echo ""
                print_info "Try running manually: pnpm run build"
                exit 1
            fi
            echo ""
            print_success "Workspace artifacts built successfully"
        else
            print_info "Workspace artifacts already built"
        fi
        echo ""
    fi
    
    # Ensure Docker networks exist (required for all services)
    print_header "${CYAN}🔌 Checking Docker Networks${NC}"
    
    # Create 'dtm' network (used by all services for inter-communication)
    # We create it externally to avoid "network exists but was not created by compose" errors
    # when multiple compose files try to manage the same network.
    # All docker-compose files define this network as 'external: true'.
    if ! docker network inspect dtm >/dev/null 2>&1; then
        print_info "Creating 'dtm' Docker network..."
        if docker network create dtm; then
            print_success "'dtm' network created successfully"
        else
            print_error "Failed to create 'dtm' network"
            exit 1
        fi
    else
        print_success "'dtm' network already exists"
    fi

   
    echo ""
    
    # Build profiles based on flags
    PROFILES="--profile db"
    if [ "$START_ORCHESTRATOR" = true ]; then
        PROFILES="$PROFILES --profile orchestrator"
    fi
    # Always add dev-tools profile in standalone mode (includes dev-ack-simulator)
    PROFILES="$PROFILES --profile dev-tools"
    
    echo ""
    print_info "Starting services..."
    echo ""
    
    # Start Kafka (includes zookeeper, kafka, kafka-ui, kafka-init)
    print_info "Starting Kafka cluster..."
    if [ "$REBUILD_FLAG" = true ]; then
        print_info "🔨 Rebuilding Kafka containers..."
    fi
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA" up -d --wait $(get_build_flag)
    print_success "Kafka cluster started"
    
    echo ""
    
    # Start workflow source databases
    print_info "Starting workflow source databases..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_ORDER_PROCESSING" up -d --wait $(get_build_flag)
    print_success "Order Processing database started (port 5449)"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_IOT_SENSOR" up -d --wait $(get_build_flag)
    print_success "IoT Sensor Pipeline database started (port 5450)"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_INFRA_PROVISIONING" up -d --wait $(get_build_flag)
    print_success "Infra Provisioning database started (port 5451)"

    echo ""

    # Start DTM Core DB (and optionally orchestrator)
    print_info "Starting DTM Core database..."
    # Set Kafka broker for standalone mode (local Kafka)
    export KAFKA_BROKER="dtm-kafka:29092"

    # Build docker compose command with debug mode if enabled
    COMPOSE_CMD="docker compose --env-file "$ENV_FILE" -f $COMPOSE_MAIN"
    if [ "$START_ORCHESTRATOR" = true ]; then
        print_info "Orchestrator will be started with debug enabled (port 9229)"
        if [ "$REBUILD_FLAG" = true ]; then
            print_info "Rebuilding orchestrator image (--build flag specified)..."
        fi
    fi
    
    $COMPOSE_CMD $PROFILES up -d --wait $(get_build_flag)
    print_success "DTM Core database started"
    
    echo ""
    
    # Start LocalStack and queue initialization (workers deployed separately with deploy-workers command)
    print_info "Starting LocalStack and initializing SQS queues..."
    # Start localstack with --wait, then run init-sqs-queues separately (it's a one-shot container)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" up -d localstack --wait $(get_build_flag)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" up init-sqs-queues $(get_build_flag)
    print_success "LocalStack started and queues initialized"
    
    echo ""
    # Start monitor dashboard if --monitor flag was passed
    if [ "$START_MONITOR" = true ]; then
        start_monitor_dashboard
    fi

    print_header "${GREEN}✅ Standalone Environment Ready!${NC}"
    echo ""

    show_access_urls "standalone"
}

start_integrated() {
    print_header "${GREEN}🚀 Starting Integrated Environment${NC}"

    # Self-heal an aged .env missing keys added to .env.example since it was
    # created (postinstall only creates .env once, never refreshes it).
    check_env_freshness

    # Check Docker
    check_docker || exit 1
    
    # Build workspace packages if debug mode is enabled and orchestrator is starting
    if [ "$START_ORCHESTRATOR" = true ]; then
        echo ""
        print_info "Preparing workspace for hot reload..."
        
        # Check if dependencies are installed
        if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
            print_warning "Node modules not found - running pnpm install..."
            cd "$PROJECT_ROOT"
            pnpm install
            if [ $? -ne 0 ]; then
                print_error "Failed to install dependencies"
                exit 1
            fi
            print_success "Dependencies installed"
            echo ""
        fi
        
        # Check if workspace artifacts need building (packages, workflows, ack-simulator).
        # The dev-ack-simulator and orchestrator bind-mount workflow dist/ directories,
        # so they all must be built before docker compose up.
        NEEDS_BUILD=false
        for d in packages/database/dist packages/kafka-producer/dist workflows/order-processing/dist workflows/iot-sensor-pipeline/dist workflows/infra-provisioning/dist workflows/plan-execution/dist tools/dev-ack-simulator/dist; do
          if [ ! -d "/" ]; then
            print_info "Missing "
            NEEDS_BUILD=true
          fi
        done

        if [ "" = true ]; then
            print_info "Building workspace artifacts (packages + workflows + tools)..."
            echo ""
            cd ""
            pnpm run build:packages \
              && pnpm run build:workflows \
              && pnpm run build:tools
            if [ 0 -ne 0 ]; then
                print_error "Failed to build workspace artifacts"
                echo ""
                print_info "Try running manually: pnpm run build"
                exit 1
            fi
            echo ""
            print_success "Workspace artifacts built successfully"
        else
            print_info "Workspace artifacts already built"
        fi
        echo ""
    fi
    
    # Ensure Docker networks exist (required for all services)
    print_header "${CYAN}🔌 Checking Docker Networks${NC}"
    
    # Create 'dtm' network (used by all services for inter-communication)
    # We create it externally to avoid "network exists but was not created by compose" errors
    # when multiple compose files try to manage the same network.
    # All docker-compose files define this network as 'external: true'.
    if ! docker network inspect dtm >/dev/null 2>&1; then
        print_info "Creating 'dtm' Docker network..."
        if docker network create dtm; then
            print_success "'dtm' network created successfully"
        else
            print_error "Failed to create 'dtm' network"
            exit 1
        fi
    else
        print_success "'dtm' network already exists"
    fi

    # Create 'backend' network (used by main services and accessed by external services for ETL)
    # This network is shared across multiple compose files, so we create it as external
    if ! docker network inspect external-system_default >/dev/null 2>&1; then
        print_info "Creating 'external-system_default' Docker network..."
        if docker network create external-system_default; then
            print_success "'external-system_default' network created successfully"
        else
            print_error "Failed to create 'external-system_default' network"
            exit 1
        fi
    else
        print_success "'external-system_default' network already exists"
    fi

    # Check if the external system's Kafka network exists (external dependency)
    if ! docker network inspect "$EXTERNAL_KAFKA_NETWORK" >/dev/null 2>&1; then
        print_warning "External system's Kafka network '$EXTERNAL_KAFKA_NETWORK' not found"
        print_info "Make sure the external system's docker compose is running (with Kafka services)"
        print_info "Or update EXTERNAL_KAFKA_NETWORK environment variable if using different network"
        echo ""
        print_info "To start the external system, navigate to its directory and run:"
        print_info "  docker compose --env-file "$ENV_FILE" -f docker-compose-kafka.yaml up -d"
        print_info "  docker compose --env-file "$ENV_FILE" -f docker-compose-local.yaml up -d"
        echo ""
        read -p "Continue anyway? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            exit 0
        fi
    fi
    
    # Build profiles based on flags
    PROFILES="--profile db"
    if [ "$START_ORCHESTRATOR" = true ]; then
        PROFILES="$PROFILES --profile orchestrator"
    fi
    # Always add dev-tools profile (includes dev-ack-simulator)
    PROFILES="$PROFILES --profile dev-tools"
    
    echo ""
    print_info "Starting services (without local Kafka)..."
    echo ""
    
    # Start workflow source databases
    print_info "Starting workflow source databases..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_ORDER_PROCESSING" up -d --wait $(get_build_flag)
    print_success "Order Processing database started (port 5449)"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_IOT_SENSOR" up -d --wait $(get_build_flag)
    print_success "IoT Sensor Pipeline database started (port 5450)"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_INFRA_PROVISIONING" up -d --wait $(get_build_flag)
    print_success "Infra Provisioning database started (port 5451)"

    echo ""

    # Start DTM Core DB (and optionally orchestrator)
    print_info "Starting DTM Core database..."
    # Set Kafka broker for integrated mode (the external system's Kafka)
    export KAFKA_BROKER="$EXTERNAL_KAFKA_BROKER"
    
    # Build compose command with override for orchestrator if needed
    COMPOSE_CMD="docker compose --env-file "$ENV_FILE" -f $COMPOSE_MAIN"
    BUILD_FLAGS=""
    
    # Check if rebuild requested
    if [ "$REBUILD_FLAG" = true ]; then
        print_info "🔨 Rebuilding images..."
    fi
    
    if [ "$START_ORCHESTRATOR" = true ]; then
        print_info "Orchestrator will be started with debug enabled (port 9229)"
        if [ "$REBUILD_FLAG" = true ]; then
            print_info "Rebuilding orchestrator image (--build flag specified)..."
        fi
        COMPOSE_CMD="$COMPOSE_CMD -f $COMPOSE_ORCHESTRATOR_INTEGRATED"
    fi
    
    $COMPOSE_CMD $PROFILES up -d --wait $(get_build_flag)
    print_success "DTM Core database started"
    
    echo ""
    
    # Start LocalStack and queue initialization (workers deployed separately with deploy-workers command)
    print_info "Starting LocalStack and initializing SQS queues..."
    # Start localstack with --wait, then run init-sqs-queues separately (it's a one-shot container)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" up -d localstack --wait $(get_build_flag)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" up init-sqs-queues $(get_build_flag)
    print_success "LocalStack started and queues initialized"
    
    echo ""
    
    # Initialize Kafka topics on the external system's Kafka using docker-compose
    print_info "Initializing DTM topics on the external system's Kafka cluster..."
    print_info "Connecting to: $EXTERNAL_KAFKA_BROKER (network: $EXTERNAL_KAFKA_NETWORK)"
    
    echo ""
    
    # Export environment variables for docker-compose (already exported above but keep for clarity)
    export EXTERNAL_KAFKA_BROKER
    
    # Run kafka-init-integrated using docker-compose
    print_info "Starting kafka-init-integrated container..."
    if [ "$REBUILD_FLAG" = true ]; then
        print_info "🔨 Rebuilding kafka-init-integrated container..."
    fi
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA_INIT_INTEGRATED" up --abort-on-container-exit $(get_build_flag) 2>&1 | sed 's/^/    /'
    
    INIT_EXIT_CODE=$?
    
    echo ""
    
    if [ $INIT_EXIT_CODE -eq 0 ]; then
        print_success "DTM topics initialized on the external system's Kafka cluster"
    else
        print_warning "Failed to initialize Kafka topics (they may already exist or Kafka is not ready)"
    fi
    
    echo ""
    
    # Show port allocation info in integrated mode
    echo -e "${YELLOW}ℹ️  Port Allocations:${NC}"
    echo -e "  ${CYAN}→${NC} External system postgres:   ${BLUE}5432${NC}"
    echo -e "  ${CYAN}→${NC} DTM Core DB:                ${BLUE}${DTM_DB_PORT_HOST:-5448}${NC}"
    echo -e "  ${CYAN}→${NC} Order Processing DB:        ${BLUE}5449${NC}"
    echo -e "  ${CYAN}→${NC} IoT Sensor Pipeline DB:     ${BLUE}5450${NC}"
    echo -e "  ${CYAN}→${NC} Infra Provisioning DB:      ${BLUE}5451${NC}"
    echo ""
    
    # Start monitor dashboard if --monitor flag was passed
    if [ "$START_MONITOR" = true ]; then
        start_monitor_dashboard
    fi

    print_header "${GREEN}✅ Integrated Environment Ready!${NC}"
    echo ""

    show_access_urls "integrated"
}

# ============================================================================
# Monitor Dashboard
# ============================================================================

MONITOR_PID_FILE="$PROJECT_ROOT/.monitor.pid"

start_monitor_dashboard() {
    print_info "Starting DTM Monitor dashboard..."

    # Check if already running
    if [ -f "$MONITOR_PID_FILE" ]; then
        local old_pid
        old_pid=$(cat "$MONITOR_PID_FILE")
        if kill -0 "$old_pid" 2>/dev/null; then
            print_warning "Monitor dashboard already running (PID: $old_pid)"
            echo -e "  ${GREEN}→${NC} Monitor Dashboard: ${BLUE}http://localhost:5173${NC}"
            return 0
        fi
        rm -f "$MONITOR_PID_FILE"
    fi

    # Check if apps/monitor exists
    if [ ! -d "$PROJECT_ROOT/apps/monitor" ]; then
        print_error "Monitor app not found at apps/monitor/"
        return 1
    fi

    # Start Vite dev server in background
    cd "$PROJECT_ROOT/apps/monitor"
    pnpm dev > /dev/null 2>&1 &
    local monitor_pid=$!
    echo "$monitor_pid" > "$MONITOR_PID_FILE"
    cd "$PROJECT_ROOT"

    print_success "Monitor dashboard started (PID: $monitor_pid)"
    echo -e "  ${GREEN}→${NC} Monitor Dashboard: ${BLUE}http://localhost:5173${NC}"
    echo ""
}

stop_monitor_dashboard() {
    if [ -f "$MONITOR_PID_FILE" ]; then
        local pid
        pid=$(cat "$MONITOR_PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null
            print_info "Stopped monitor dashboard (PID: $pid)"
        fi
        rm -f "$MONITOR_PID_FILE"
    fi
}

# ============================================================================
# Stop Command
# ============================================================================

stop_all() {
    print_header "${YELLOW}🛑 Stopping All Services${NC}"

    echo ""
    # Stop monitor dashboard if running
    stop_monitor_dashboard

    print_info "Stopping services..."
    
    # Stop in reverse order
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile db --profile orchestrator --profile dev-tools down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_INFRA_PROVISIONING" down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_IOT_SENSOR" down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_ORDER_PROCESSING" down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA" down 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA_INIT_INTEGRATED" down 2>/dev/null || true
    
    echo ""
    print_success "All services stopped"
    echo ""
}

# ============================================================================
# Clean Command
# ============================================================================

clean_all() {
    print_header "${RED}🧹 Cleaning All Services${NC}"

    # Stop monitor dashboard if running
    stop_monitor_dashboard

    print_info "Stopping all services and removing volumes..."
    echo ""

    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile db --profile orchestrator --profile dev-tools down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_INFRA_PROVISIONING" down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_IOT_SENSOR" down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_ORDER_PROCESSING" down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA" down -v 2>/dev/null || true
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA_INIT_INTEGRATED" down -v 2>/dev/null || true
    
    # Remove LocalStack data if exists
    if [ -d "./localstack-data" ]; then
        print_info "Removing LocalStack data..."
        rm -rf ./localstack-data
    fi
    
    echo ""
    print_success "Cleanup complete"
    echo ""
}

# ============================================================================
# Purge Command - Clear data without stopping services
# ============================================================================
#
# Usage:
#   purge         - Full purge (DB + SQS + Kafka, default)
#   purge --fast  - Fast purge (DB + SQS only, skip Kafka)
#
# Default behavior: Always purge Kafka for clean state
#   - Ensures no old messages interfere with new tests
#   - Critical after service restarts or clean rebuilds
#   - Prevents "Step not found" errors from orphaned messages
#
# When to use --fast:
#   - Running tests back-to-back without restarts
#   - All previous tests completed successfully
#   - Consumer offsets are clean and committed
#   - You want faster test cycles (saves ~10-15 seconds)
# ============================================================================

purge_all() {
    local PURGE_MODE="db-only"
    
    # Check if --full flag is passed
    if [[ "$1" == "--full" ]]; then
        PURGE_MODE="full"
        print_header "${YELLOW}🧹 Full Purge: Database, SQS, and Kafka${NC}"
        print_info "Clearing all data from:"
        echo "  • DTM database (jobs, steps, results)"
        echo "  • SQS queues (all messages)"
        echo "  • Kafka topics (all messages + consumer groups)"
        echo ""
        print_warning "⚠️  Full purge takes 15-30 seconds - use only when needed"
    else
        print_header "${YELLOW}🧹 Fast Purge: Database Only${NC}"
        print_info "Clearing data from:"
        echo "  • DTM database (jobs, steps, results)"
        echo ""
        print_info "Skipping SQS and Kafka (use --full for complete clean)"
        print_info "⚡ Fast purge completes in ~2 seconds"
    fi
    echo ""
    
    # ========================================================================
    # 1. Purge DTM Core Database
    # ========================================================================

    print_header "${CYAN}🗑️  Purging DTM Core Database${NC}"

    # Check if DTM DB is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-db"; then
        print_warning "DTM database is not running - skipping DB purge"
        echo ""
    else
        print_info "Connecting to DTM database..."
        
        # Use correct DTM database credentials
        DB_USER="dtm_user"
        DB_NAME="dtm"
        
        # Execute DELETE via docker exec (more reliable than psql from host)
        DELETE_RESULT=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db psql \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            -c "DELETE FROM dtm_jobs;" 2>&1)
        
        if [ $? -eq 0 ]; then
            # Extract number of deleted rows from PostgreSQL output
            DELETED_COUNT=$(echo "$DELETE_RESULT" | grep "DELETE" | awk '{print $2}')
            
            if [ -n "$DELETED_COUNT" ]; then
                print_success "Deleted $DELETED_COUNT job(s) from dtm_jobs table"
                print_info "Cascade delete also cleared:"
                echo "  • dtm_steps (child records)"
            else
                print_success "DTM database purged (table was already empty)"
            fi
        else
            print_error "Failed to purge DTM database"
            echo "$DELETE_RESULT"
        fi
    fi
    
    echo ""
    
    # ========================================================================
    # 2. Purge SQS Queues (LocalStack) - Only in full mode
    # ========================================================================
    
    if [ "$PURGE_MODE" = "db-only" ]; then
        # Skip SQS purge in fast mode
        :
    else
        print_header "${CYAN}🗑️  Purging SQS Queues${NC}"
    
    # Check if LocalStack is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-localstack"; then
        print_warning "LocalStack is not running - skipping SQS purge"
        echo ""
    else
        AWS_ENDPOINT="http://localhost:${LOCALSTACK_PORT:-4567}"
        AWS_REGION="${AWS_REGION:-us-east-1}"
        
        # Check if AWS CLI is available
        if ! command -v aws &> /dev/null; then
            print_warning "AWS CLI is not installed - skipping SQS purge"
            print_info "Install AWS CLI to enable SQS purge functionality"
            echo ""
        else
            print_info "Fetching all SQS queues from LocalStack..."
            
            # List all queue URLs
            QUEUE_URLS=$(aws sqs list-queues \
                --endpoint-url "$AWS_ENDPOINT" \
                --region "$AWS_REGION" \
                --output json 2>/dev/null | jq -r '.QueueUrls[]?' 2>/dev/null)
            
            if [ -z "$QUEUE_URLS" ]; then
                print_info "No SQS queues found"
            else
                QUEUE_COUNT=$(echo "$QUEUE_URLS" | wc -l | tr -d ' ')
                print_info "Found $QUEUE_COUNT queue(s) to purge (running in parallel)..."
                echo ""
                
                # Purge each queue in parallel for faster execution
                # NOTE: Using receive+delete instead of purge-queue to bypass 60-second rate limit
                PURGE_PIDS=()
                while IFS= read -r queue_url; do
                    if [ -n "$queue_url" ]; then
                        queue_name=$(echo "$queue_url" | rev | cut -d'/' -f1 | rev)
                        
                        # Run purge in background
                        (
                            # Use receive+delete loop instead of purge-queue (bypasses 60s rate limit)
                            # SQS purge-queue has a 60-second rate limit which breaks rapid E2E testing
                            local max_iterations=100  # Safety limit to prevent infinite loops
                            local iteration=0
                            local total_deleted=0
                            
                            while [ $iteration -lt $max_iterations ]; do
                                iteration=$((iteration + 1))
                                
                                # Receive up to 10 messages with short visibility timeout
                                # This ensures we can re-check quickly if needed
                                local messages
                                messages=$(aws sqs receive-message \
                                    --queue-url "$queue_url" \
                                    --endpoint-url "$AWS_ENDPOINT" \
                                    --region "$AWS_REGION" \
                                    --max-number-of-messages 10 \
                                    --visibility-timeout 2 \
                                    --wait-time-seconds 0 \
                                    2>/dev/null)
                                
                                # Check if any messages were received
                                local msg_count
                                msg_count=$(echo "$messages" | jq '.Messages | length' 2>/dev/null)
                                
                                # Default to 0 if empty/null
                                if [ -z "$msg_count" ] || [ "$msg_count" = "null" ]; then
                                    msg_count=0
                                fi
                                
                                if [ "$msg_count" -eq 0 ]; then
                                    # Double-check: wait 2s and try one more time to catch any invisible messages
                                    if [ $iteration -eq 1 ] || [ $total_deleted -gt 0 ]; then
                                        sleep 2
                                        messages=$(aws sqs receive-message \
                                            --queue-url "$queue_url" \
                                            --endpoint-url "$AWS_ENDPOINT" \
                                            --region "$AWS_REGION" \
                                            --max-number-of-messages 10 \
                                            --visibility-timeout 2 \
                                            --wait-time-seconds 0 \
                                            2>/dev/null)
                                        msg_count=$(echo "$messages" | jq '.Messages | length' 2>/dev/null || echo "0")
                                        if [ -z "$msg_count" ] || [ "$msg_count" = "null" ] || [ "$msg_count" -eq 0 ]; then
                                            break  # Confirmed empty
                                        fi
                                    else
                                        break  # No messages on first try
                                    fi
                                fi
                                
                                # Delete each message synchronously (not in subshell)
                                local receipts
                                receipts=$(echo "$messages" | jq -r '.Messages[]?.ReceiptHandle' 2>/dev/null)
                                
                                if [ -n "$receipts" ]; then
                                    while IFS= read -r receipt; do
                                        if [ -n "$receipt" ]; then
                                            if aws sqs delete-message \
                                                --queue-url "$queue_url" \
                                                --endpoint-url "$AWS_ENDPOINT" \
                                                --region "$AWS_REGION" \
                                                --receipt-handle "$receipt" >/dev/null 2>&1; then
                                                total_deleted=$((total_deleted + 1))
                                            fi
                                        fi
                                    done <<< "$receipts"
                                fi
                            done
                            
                            echo "✓ $queue_name ($total_deleted deleted)"
                        ) &
                        PURGE_PIDS+=($!)
                    fi
                done <<< "$QUEUE_URLS"
                
                # Wait for all purge operations to complete
                for pid in "${PURGE_PIDS[@]}"; do
                    wait "$pid"
                done
                
                echo ""
                print_success "SQS queue purge complete"
            fi
        fi
    fi
    
    echo ""
    fi  # End of SQS purge (full mode only) if-else
    
    # ========================================================================
    # 3. Purge Kafka Topics - Only in full mode
    # ========================================================================
    
    if [ "$PURGE_MODE" = "db-only" ]; then
        # Skip Kafka purge in fast mode
        :
    else
        print_header "${CYAN}🗑️  Purging Kafka Topics${NC}"
        
        # Check if Kafka is running (standalone mode)
        # Try multiple possible Kafka container names
        KAFKA_CONTAINER=""
        if docker ps --format "{{.Names}}" | grep -q "^dtm-kafka$"; then
            KAFKA_CONTAINER="dtm-kafka"
        fi
        
        if [ -z "$KAFKA_CONTAINER" ]; then
            print_warning "Local Kafka is not running"
            print_info "If using integrated mode, Kafka topics are in the external system"
            print_info "Purge Kafka manually from the external system or Kafka UI"
            echo ""
        else
        print_info "Fetching DTM and target topics from Kafka (container: $KAFKA_CONTAINER)..."

        # Get list of dtm and target topics (exclude internal topics)
        TOPICS=$(docker exec "$KAFKA_CONTAINER" kafka-topics \
            --bootstrap-server localhost:9092 \
            --list 2>/dev/null | grep -E "^(dtm\.|target\.)" 2>/dev/null)

        if [ -z "$TOPICS" ]; then
            print_info "No DTM or target topics found"
        else
            TOPIC_COUNT=$(echo "$TOPICS" | wc -l | tr -d ' ')
            print_info "Found $TOPIC_COUNT topic(s) to purge (dtm.* and target.* topics)"
            echo ""
            
            # Delete and recreate each topic (Kafka doesn't have native purge)
            echo "$TOPICS" | while IFS= read -r topic; do
                if [ -n "$topic" ]; then
                    print_info "Purging topic: $topic"
                    
                    # Delete topic
                    docker exec "$KAFKA_CONTAINER" kafka-topics \
                        --bootstrap-server localhost:9092 \
                        --delete \
                        --topic "$topic" >/dev/null 2>&1
                    
                    DELETE_STATUS=$?
                    
                    # Wait a moment for deletion
                    sleep 1
                    
                    # Recreate topic with default settings
                    docker exec "$KAFKA_CONTAINER" kafka-topics \
                        --bootstrap-server localhost:9092 \
                        --create \
                        --topic "$topic" \
                        --partitions 1 \
                        --replication-factor 1 >/dev/null 2>&1
                    
                    CREATE_STATUS=$?
                    
                    if [ $DELETE_STATUS -eq 0 ] && [ $CREATE_STATUS -eq 0 ]; then
                        print_success "Purged: $topic"
                    elif [ $DELETE_STATUS -eq 0 ]; then
                        print_warning "Deleted $topic but failed to recreate"
                    else
                        print_warning "Failed to purge: $topic"
                    fi
                fi
            done
            
            echo ""
            print_success "Kafka topic purge complete"
            
            # Delete consumer groups to reset offsets
            # NOTE: Use dtm-kafka:29092 (internal Docker network address), NOT localhost:9092
            print_info "Deleting Kafka consumer groups..."
            CONSUMER_GROUPS=$(docker exec "$KAFKA_CONTAINER" kafka-consumer-groups \
                --bootstrap-server dtm-kafka:29092 \
                --list 2>/dev/null | grep -E "(dev-ack-simulator|orchestrator)" 2>/dev/null)
            
            if [ -n "$CONSUMER_GROUPS" ]; then
                echo "$CONSUMER_GROUPS" | while IFS= read -r group; do
                    if [ -n "$group" ]; then
                        docker exec "$KAFKA_CONTAINER" kafka-consumer-groups \
                            --bootstrap-server dtm-kafka:29092 \
                            --delete \
                            --group "$group" 2>&1 || print_warning "Failed to delete group: $group"
                        print_success "Deleted consumer group: $group"
                    fi
                done
            else
                print_info "No matching consumer groups found"
            fi
        fi
        fi
    fi  # End of Kafka purge (full mode only)
    
    echo ""
    print_header "${GREEN}✅ Purge Complete!${NC}"
    echo ""
    if [ "$PURGE_MODE" = "db-only" ]; then
        print_info "Data cleared from:"
        echo "  • DTM database (jobs, steps, results)"
        echo ""
        print_info "SQS and Kafka left intact (queues/topics will process naturally)"
        echo ""
        print_info "💡 For complete clean, use: ./scripts/local-env.sh purge --full"
    else
        print_info "All data has been cleared from:"
        echo "  • DTM database (jobs, steps, results)"
        echo "  • SQS queues (main + DLQs)"
        echo "  • Kafka topics (dtm.* and target.* topics)"
        echo "  • Kafka consumer groups"
    fi
    echo ""
    print_info "Services are still running - you can start fresh testing now"
    echo ""
}

# ============================================================================
# Quick Purge Command - Only clear database (fast, for E2E tests)
# ============================================================================

purge_db_only() {
    print_header "${YELLOW}🧹 Quick Purge (Database Only)${NC}"
    
    print_info "Clearing DTM database only (skipping SQS & Kafka for speed)"
    echo ""
    
    # Check if DTM DB is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-db"; then
        print_warning "DTM database is not running"
        echo ""
        return 1
    fi
    
    print_info "Deleting all jobs from DTM database..."
    
    # Use correct DTM database credentials
    DB_USER="dtm_user"
    DB_NAME="dtm"
    
    # Execute DELETE via docker exec
    DELETE_RESULT=$(docker exec ${COMPOSE_PROJECT_NAME:-dtm}-db psql \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "DELETE FROM dtm_jobs;" 2>&1)
    
    if [ $? -eq 0 ]; then
        DELETED_COUNT=$(echo "$DELETE_RESULT" | grep "DELETE" | awk '{print $2}')
        
        if [ -n "$DELETED_COUNT" ]; then
            print_success "Deleted $DELETED_COUNT job(s) from dtm_jobs table"
        else
            print_success "Database purged (already empty)"
        fi
    else
        print_error "Failed to purge database"
        echo "$DELETE_RESULT"
        return 1
    fi
    
    echo ""
    print_success "Quick purge complete!"
    echo ""
}

# ============================================================================
# Deploy Workers
# ============================================================================

deploy_workers() {
    local MODE="--esm"
    local COUNT=1
    local HOT_RELOAD=false
    local DEBUG_SERVER=false
    local BUILD_FLAG=false
    
    # If no arguments provided, default to Poller mode with 10 replicas
    if [[ $# -eq 0 ]]; then
        MODE="--poller"
        COUNT=10
    fi
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --esm|esm)
                MODE="--esm"
                shift
                ;;
            --poller|poller)
                MODE="--poller"
                shift
                ;;
            --debug-server)
                DEBUG_SERVER=true
                MODE="--debug-server"
                shift
                ;;
            --count=*)
                COUNT="${1#*=}"
                shift
                ;;
            --hot-reload)
                HOT_RELOAD=true
                shift
                ;;
            --build|--rebuild)
                BUILD_FLAG=true
                shift
                ;;
            *)
                # If implicit mode passed as first arg (backward compatibility)
                if [[ "$1" == "--esm" ]] || [[ "$1" == "esm" ]]; then
                    # ESM mode still supported but hidden from help
                    MODE="--esm"
                elif [[ "$1" == "--poller" ]] || [[ "$1" == "poller" ]]; then
                    MODE="--poller"
                elif [[ "$1" == "--debug-server" ]]; then
                    DEBUG_SERVER=true
                    MODE="--debug-server"
                else
                    print_error "Invalid argument: $1"
                    echo "Use: --count=N, --debug-server, --build, or --hot-reload"
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # Default to 10 pollers if --poller specified without --count
    if [[ "$MODE" == "--poller" ]] && [[ "$COUNT" -eq 1 ]]; then
        COUNT=10
    fi

    # =========================================================================
    # ESM GUARD: ESM mode requires explicit opt-in via env variable.
    # The free LocalStack version has known flakiness with ESM v2
    # (mixed mode race conditions, container auto-restart conflicts).
    # See docs/guides/DEPLOYMENT-MODES.md for details.
    # =========================================================================
    if [[ "$MODE" == "--esm" ]] && [[ "${ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT:-}" != "true" ]]; then
        echo ""
        print_warning "⚠️  ESM mode is DISABLED by default"
        print_info "The free LocalStack version has known flakiness with ESM v2"
        print_info "(mixed mode race conditions, container auto-restart conflicts)"
        echo ""
        print_info "To enable ESM, explicitly set:"
        echo -e "  ${CYAN}export ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT=true${NC}"
        echo ""
        print_info "See docs/guides/DEPLOYMENT-MODES.md for details"
        echo ""
        print_info "Falling back to Poller mode..."
        MODE="--poller"
        COUNT=10
        echo ""
    fi

    print_header "${BLUE}📦 Deploying Lambda Workers${NC}"

    # Parse mode flag
    case "$MODE" in
        --esm|esm)
            export USE_POLLER=false
            local MODE_NAME="ESM"
            local MODE_DESC="parallel execution via LocalStack ESM v2"
            ;;
        --poller|poller)
            export USE_POLLER=true
            local MODE_NAME="Poller"
            local MODE_DESC="sequential execution via custom SQS poller (replicas: $COUNT)"
            ;;
        --debug-server)
            export USE_POLLER=false
            local MODE_NAME="Debug-Server"
            local MODE_DESC="🔬 Lambda handlers run IN-PROCESS (debuggable via VS Code)"
            ;;
    esac

    if [ "$HOT_RELOAD" = true ]; then
        MODE_DESC="$MODE_DESC | 🔥 Hot Reload"
    fi
    
    # Check if LocalStack is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-localstack"; then
        print_error "LocalStack is not running"
        echo ""
        echo "Start LocalStack first:"
        echo "  $0 start --standalone"
        echo "  $0 start --integrated"
        echo ""
        exit 1
    fi
    
    echo ""
    print_info "Mode: ${MODE_NAME} (${MODE_DESC})"
    echo ""
    
    # Handle debug-server mode specially
    if [ "$DEBUG_SERVER" = true ]; then
        # ====================================================================
        # DEBUG-SERVER MODE
        # ====================================================================
        # Both orchestrator and Lambda handlers run locally on the host (not in Docker)
        # This allows full breakpoint debugging in VS Code
        #
        # Key differences from normal mode:
        # - KAFKA_BROKER: localhost:9093 (Docker port mapping: 9093->9092)
        # - ORCHESTRATOR_CALLBACK_URL: http://localhost:3002 (not host.docker.internal)
        # - Lambda handlers run in-process with the poller (no LocalStack invocation)
        # ====================================================================
        
        # Debug-server mode: skip Lambda deployment, just ensure SQS queues exist
        print_info "Debug-server mode: Lambda handlers will run in-process"
        echo ""
        
        # Check for and stop orchestrator Docker container (will run locally instead)
        if docker ps --format '{{.Names}}' | grep -q "^${COMPOSE_PROJECT_NAME:-dtm}-orchestrator$"; then
            print_warning "⚠️  Orchestrator Docker container is running - stopping it..."
            print_info "In debug mode, orchestrator runs locally (not in Docker)"
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile orchestrator stop orchestrator > /dev/null 2>&1
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile orchestrator rm -f orchestrator > /dev/null 2>&1
            print_success "Orchestrator Docker container stopped"
            echo ""
        fi
        
        # Verify dev-ack-simulator is running (needed for ACKs in debug mode)
        if ! docker ps --format '{{.Names}}' | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-dev-ack-simulator"; then
            print_warning "⚠️  dev-ack-simulator is NOT running"
            print_info "Jobs will hang at WAITING_FOR_ACK without the simulator"
            print_info "Start infrastructure with: ./scripts/local-env.sh start --standalone"
            echo ""
        else
            print_success "dev-ack-simulator is running (ACKs will work)"
            echo ""
        fi
        
        # Stop any running pollers
        if docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller"; then
            print_warning "Stopping Docker SQS poller (will run locally instead)..."
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller stop sqs-poller > /dev/null 2>&1
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller rm -f sqs-poller > /dev/null 2>&1
            print_success "Docker poller stopped"
        fi
        
        # Remove any ESMs
        ESM_COUNT=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda list-event-source-mappings --region us-east-1 2>/dev/null | jq -r '.EventSourceMappings | length' || echo "0")
        if [ "$ESM_COUNT" -gt 0 ]; then
            print_warning "Removing $ESM_COUNT ESM(s)..."
            aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda list-event-source-mappings --region us-east-1 2>/dev/null | \
                jq -r '.EventSourceMappings[].UUID' | \
                while read uuid; do
                    aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda delete-event-source-mapping --uuid "$uuid" --region us-east-1 > /dev/null 2>&1
                done
            print_success "ESMs removed"
        fi
        
        echo ""
        print_success "🔬 Debug-server mode ready!"
        echo ""
        
        # Setup cleanup trap for Ctrl+C
        cleanup_debug_processes() {
            echo ""
            print_warning "Received interrupt signal - cleaning up..."
            
            # Kill tail process if it exists
            if [ -n "${TAIL_PID:-}" ]; then
                kill "$TAIL_PID" 2>/dev/null || true
            fi
            
            if [ -f /tmp/dtm-orchestrator.pid ]; then
                ORCH_PID=$(cat /tmp/dtm-orchestrator.pid)
                if kill -0 "$ORCH_PID" 2>/dev/null; then
                    print_info "Stopping orchestrator (PID: $ORCH_PID)..."
                    kill "$ORCH_PID" 2>/dev/null
                fi
                rm -f /tmp/dtm-orchestrator.pid
            fi
            
            if [ -f /tmp/dtm-poller.pid ]; then
                POLLER_PID=$(cat /tmp/dtm-poller.pid)
                if kill -0 "$POLLER_PID" 2>/dev/null; then
                    print_info "Stopping debug-server poller (PID: $POLLER_PID)..."
                    kill "$POLLER_PID" 2>/dev/null
                fi
                rm -f /tmp/dtm-poller.pid
            fi
            
            # Fallback cleanup
            pkill -f 'nest start.*orchestrator.*--debug' 2>/dev/null
            pkill -f 'tsx.*poller.ts' 2>/dev/null
            
            print_success "Debug mode stopped"
            exit 0
        }
        
        trap cleanup_debug_processes INT TERM
        
        # Start orchestrator in background with inspect enabled
        print_info "Starting orchestrator locally (port 3002, debug port 9229)..."
        cd "$PROJECT_ROOT" || exit 1
        
        # Kill any existing orchestrator process - be thorough but targeted!
        print_info "Cleaning up any existing debug processes..."
        
        # Kill processes from PID files first (these are our own processes)
        if [ -f /tmp/dtm-orchestrator.pid ]; then
            OLD_ORCH_PID=$(cat /tmp/dtm-orchestrator.pid)
            if kill -0 "$OLD_ORCH_PID" 2>/dev/null; then
                print_warning "Killing old orchestrator (PID: $OLD_ORCH_PID)..."
                kill -9 "$OLD_ORCH_PID" 2>/dev/null || true
                # Also kill child processes
                pkill -9 -P "$OLD_ORCH_PID" 2>/dev/null || true
            fi
            rm -f /tmp/dtm-orchestrator.pid
        fi
        
        if [ -f /tmp/dtm-poller.pid ]; then
            OLD_POLLER_PID=$(cat /tmp/dtm-poller.pid)
            if kill -0 "$OLD_POLLER_PID" 2>/dev/null; then
                print_warning "Killing old poller (PID: $OLD_POLLER_PID)..."
                kill -9 "$OLD_POLLER_PID" 2>/dev/null || true
                pkill -9 -P "$OLD_POLLER_PID" 2>/dev/null || true
            fi
            rm -f /tmp/dtm-poller.pid
        fi
        
        # Kill any processes with our specific patterns (fallback)
        # Use full path matching to avoid killing unrelated processes
        pkill -9 -f "services/orchestrator/dist/src/main" 2>/dev/null || true
        pkill -9 -f "nest start.*orchestrator" 2>/dev/null || true
        pkill -9 -f "sqs-poller/src/poller.ts" 2>/dev/null || true
        pkill -9 -f "tsx.*poller.ts" 2>/dev/null || true
        
        # Wait for processes to fully terminate
        sleep 3
        
        # Give Kafka consumer group time to recognize members left
        # This is critical to avoid rebalancing conflicts!
        print_info "Waiting for Kafka consumer group to stabilize..."
        sleep 5
        
        # Check and report on consumer group state
        if command -v docker &> /dev/null && docker ps | grep -q dtm-kafka; then
            CONSUMER_COUNT=$(docker exec dtm-kafka kafka-consumer-groups --bootstrap-server localhost:9093 --describe --group dtm-service-group 2>/dev/null | grep -c "dtm-orchestrator-consumer" 2>/dev/null || echo "0")
            # Trim whitespace from CONSUMER_COUNT
            CONSUMER_COUNT=$(echo "$CONSUMER_COUNT" | tr -d '[:space:]')
            if [ -n "$CONSUMER_COUNT" ] && [ "$CONSUMER_COUNT" -gt 0 ] 2>/dev/null; then
                print_warning "⚠️  Found $CONSUMER_COUNT existing consumer(s) in dtm-service-group"
                print_info "If you see rebalancing issues, wait 30s and try again (session timeout)"
            else
                print_success "No stale consumers in dtm-service-group"
            fi
        fi
        
        # Runtime detection handles environment configuration automatically!
        # The orchestrator detects it's running locally (not in Docker) and uses:
        # - localhost for database, kafka, localstack
        # - Host-mapped ports (5448, 9093, 4566)
        # - localhost callback URL
        print_info "Runtime detection will configure environment automatically"
        print_info "(Local mode: localhost with mapped ports)"
        
        pnpm --filter ./services/orchestrator run start:debug > /tmp/dtm-orchestrator-debug.log 2>&1 &
        ORCH_PID=$!
        echo "$ORCH_PID" > /tmp/dtm-orchestrator.pid
        print_success "Orchestrator started (PID: $ORCH_PID)"
        print_info "Logs: tail -f /tmp/dtm-orchestrator-debug.log"
        
        # Wait for orchestrator to be ready before starting poller
        # This prevents Kafka consumer group race conditions
        print_info "Waiting for orchestrator to initialize (15s)..."
        sleep 15
        
        # Verify orchestrator is still running
        if ! kill -0 "$ORCH_PID" 2>/dev/null; then
            print_error "Orchestrator failed to start!"
            echo ""
            echo "Last 20 lines of orchestrator log:"
            tail -20 /tmp/dtm-orchestrator-debug.log 2>/dev/null
            exit 1
        fi
        
        echo ""
        
        # Start debug-server poller in background with inspect enabled
        print_info "Starting debug-server poller with all handlers in-process..."
        cd "$PROJECT_ROOT/tools/sqs-poller" || exit 1
        
        # Start poller with debug enabled and DEBUG_SERVER_MODE=true
        # Use localhost instead of host.docker.internal since we're running on the host
        DEBUG_SERVER_MODE=true \
        AWS_SQS_ENDPOINT=http://localhost:${LOCALSTACK_PORT:-4567} \
        AWS_LAMBDA_ENDPOINT=http://localhost:${LOCALSTACK_PORT:-4567} \
        AWS_REGION=us-east-1 \
        ORDER_PROCESSING_DB_HOST=localhost \
        ORDER_PROCESSING_DB_PORT=5449 \
        IOT_SENSOR_PIPELINE_DB_HOST=localhost \
        IOT_SENSOR_PIPELINE_DB_PORT=5450 \
        INFRA_PROVISIONING_DB_HOST=localhost \
        INFRA_PROVISIONING_DB_PORT=5451 \
        ORCHESTRATOR_CALLBACK_URL=http://localhost:3002 \
        npx tsx --inspect src/poller.ts > /tmp/dtm-poller-debug.log 2>&1 &
        POLLER_PID=$!
        echo "$POLLER_PID" > /tmp/dtm-poller.pid
        print_success "Debug-server poller started (PID: $POLLER_PID)"
        print_info "Logs: tail -f /tmp/dtm-poller-debug.log"
        
        echo ""
        echo "╔════════════════════════════════════════════════════════════════════╗"
        echo "║   🎯 Debug Mode Active - VS Code Auto-Attach Enabled               ║"
        echo "╚════════════════════════════════════════════════════════════════════╝"
        echo ""
        echo "  Both processes are running with debuggers enabled:"
        echo ""
        echo "  ✅ Orchestrator (PID: $ORCH_PID)"
        echo "     • API: http://localhost:3002"
        echo "     • Debug: localhost:9229"
        echo "     • Logs: tail -f /tmp/dtm-orchestrator-debug.log"
        echo ""
        echo "  ✅ Debug-Server Poller (PID: $POLLER_PID)"
        echo "     • All workflow handlers loaded in-process (4 workflows)"
        echo "     • Debug: localhost:9230 (auto-assigned)"
        echo "     • Logs: tail -f /tmp/dtm-poller-debug.log"
        echo ""
        echo "  VS Code should auto-attach if you have 'Debug: Auto Attach' enabled."
        echo "  Press Cmd+Shift+P → 'Debug: Toggle Auto Attach' → 'Always'"
        echo ""
        echo "  Set breakpoints anywhere in:"
        echo "    • services/orchestrator/src/**/*.ts"
        echo "    • workflows/order-processing/workers/src/handlers/**/*.ts"
        echo "    • workflows/iot-sensor-pipeline/workers/src/handlers/**/*.ts"
        echo "    • workflows/infra-provisioning/workers/src/handlers/**/*.ts"
        echo ""
        echo "  📌 Press Ctrl+C to stop both processes and exit debug mode"
        echo ""
        
        # Keep script running and show logs in real-time
        print_info "Debug mode running... Showing logs below (Press Ctrl+C to stop)"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
        # Give processes a moment to start writing to logs
        sleep 2
        
        # Tail both log files in the foreground (this will run until Ctrl+C)
        # The trap will catch the interrupt and run cleanup
        tail -f /tmp/dtm-orchestrator-debug.log /tmp/dtm-poller-debug.log &
        TAIL_PID=$!
        
        # Wait for either process to exit or for Ctrl+C
        # Check every second which process is still alive
        while true; do
            ORCH_ALIVE=true
            POLLER_ALIVE=true
            
            if ! kill -0 "$ORCH_PID" 2>/dev/null; then
                ORCH_ALIVE=false
            fi
            if ! kill -0 "$POLLER_PID" 2>/dev/null; then
                POLLER_ALIVE=false
            fi
            
            # If both are dead or one died, exit the loop
            if [ "$ORCH_ALIVE" = false ] || [ "$POLLER_ALIVE" = false ]; then
                break
            fi
            
            sleep 1
        done
        
        # If we get here, one of the processes died unexpectedly
        # Kill the tail process first
        kill "$TAIL_PID" 2>/dev/null || true
        
        echo ""
        echo ""
        echo "╔════════════════════════════════════════════════════════════════════╗"
        echo "║   ❌ DEBUG PROCESS FAILURE DETECTED                                ║"
        echo "╚════════════════════════════════════════════════════════════════════╝"
        echo ""
        
        # Report which process died and show last lines of its log
        if [ "$ORCH_ALIVE" = false ]; then
            # Get exit code if possible
            wait "$ORCH_PID" 2>/dev/null
            ORCH_EXIT=$?
            print_error "Orchestrator process died (PID: $ORCH_PID, Exit code: $ORCH_EXIT)"
            echo ""
            echo "Last 20 lines of orchestrator log:"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            tail -20 /tmp/dtm-orchestrator-debug.log 2>/dev/null || echo "(log not available)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
        fi
        
        if [ "$POLLER_ALIVE" = false ]; then
            # Get exit code if possible
            wait "$POLLER_PID" 2>/dev/null
            POLLER_EXIT=$?
            print_error "Poller process died (PID: $POLLER_PID, Exit code: $POLLER_EXIT)"
            echo ""
            echo "Last 20 lines of poller log:"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            tail -20 /tmp/dtm-poller-debug.log 2>/dev/null || echo "(log not available)"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
        fi
        
        echo ""
        print_info "Cleaning up remaining processes..."
        cleanup_debug_processes
        return 1
    fi
    
    # Clean up opposite mode if running
    if [ "$USE_POLLER" = "true" ]; then
        # Switching to poller mode - remove ESMs if they exist
        print_info "Checking for existing ESMs..."
        ESM_COUNT=$(aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda list-event-source-mappings --region us-east-1 2>/dev/null | jq -r '.EventSourceMappings | length' || echo "0")
        if [ "$ESM_COUNT" -gt 0 ]; then
            print_warning "Found $ESM_COUNT ESM(s) - removing them (switching to poller mode)..."
            aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda list-event-source-mappings --region us-east-1 2>/dev/null | \
                jq -r '.EventSourceMappings[].UUID' | \
                while read uuid; do
                    aws --endpoint-url=http://localhost:${LOCALSTACK_PORT:-4567} lambda delete-event-source-mapping --uuid "$uuid" --region us-east-1 > /dev/null 2>&1
                done
            print_success "ESMs removed"
            echo ""
            print_info "Waiting 3 seconds for LocalStack to stabilize..."
            sleep 3
            print_success "Ready to deploy"
        fi
    else
        # Switching to ESM mode - stop poller if running
        if docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller"; then
            print_warning "Found running SQS poller - stopping it (switching to ESM mode)..."
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller stop sqs-poller > /dev/null 2>&1
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller rm -f sqs-poller > /dev/null 2>&1
            print_success "SQS poller stopped"
        fi
    fi
    
    echo ""
    
    # Deploy Lambda functions for every workflow that has a deploy script.
    # Each workflow's deploy-to-localstack.js packages its own handlers.
    # In poller mode, the SQS poller uses handler-registry to dispatch in-process —
    # but Lambdas still need to be deployed because the poller invokes them via
    # the LocalStack Lambda API (NORMAL mode) by default.
    print_info "Deploying Lambda workers to LocalStack..."
    DEPLOY_FAILURES=0
    for workers_dir in "$PROJECT_ROOT"/workflows/*/workers; do
        deploy_script="$workers_dir/scripts/deploy-to-localstack.js"
        [ -f "$deploy_script" ] || continue
        wf_name=$(basename "$(dirname "$workers_dir")")
        print_info "  → deploying $wf_name handlers..."
        (
            cd "$workers_dir/scripts" || exit 1
            if [ "$HOT_RELOAD" = true ]; then
                node deploy-to-localstack.js --hot-reload
            else
                node deploy-to-localstack.js
            fi
        )
        if [ $? -ne 0 ]; then
            print_error "  ✗ $wf_name deploy failed"
            DEPLOY_FAILURES=$((DEPLOY_FAILURES + 1))
        fi
    done

    if [ "$DEPLOY_FAILURES" -gt 0 ]; then
        print_error "$DEPLOY_FAILURES workflow deploy(s) failed — check logs above"
        exit 1
    fi

    cd "$PROJECT_ROOT"
    
    echo ""
    
    # Start the appropriate execution mode
    if [ "$USE_POLLER" = "true" ]; then
        # In poller mode, ensure orchestrator is running (it should be in Docker, not debug mode)
        if ! docker ps --format '{{.Names}}' | grep -q "^${COMPOSE_PROJECT_NAME:-dtm}-orchestrator$"; then
            print_warning "⚠️  Orchestrator Docker container is NOT running"
            print_info "Poller mode requires orchestrator in Docker (use --debug-server for local orchestrator)"
            echo ""
            print_info "Starting orchestrator Docker container..."
            # Need both 'db' and 'orchestrator' profiles since orchestrator depends on db
            local DEPLOY_BUILD_FLAG=""
            if [ "$BUILD_FLAG" = true ]; then DEPLOY_BUILD_FLAG="--build"; fi
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile db --profile orchestrator up -d orchestrator --wait $DEPLOY_BUILD_FLAG
            
            # Wait a bit for orchestrator to fully initialize
            print_info "Waiting for orchestrator to initialize (10s)..."
            sleep 10
            
            # Verify it's healthy
            if docker ps --format '{{.Names}}' --filter "status=running" | grep -q "^${COMPOSE_PROJECT_NAME:-dtm}-orchestrator$"; then
                print_success "Orchestrator started successfully"
            else
                print_error "Failed to start orchestrator - check logs with: docker logs ${COMPOSE_PROJECT_NAME:-dtm}-orchestrator"
                exit 1
            fi
            echo ""
        else
            print_success "Orchestrator Docker container is already running"
            echo ""
        fi
        
        print_info "Starting custom SQS poller (count: $COUNT)..."
        local DEPLOY_BUILD_FLAG=""
        if [ "$BUILD_FLAG" = true ]; then DEPLOY_BUILD_FLAG="--build"; fi
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller up -d --scale sqs-poller=$COUNT --wait sqs-poller $DEPLOY_BUILD_FLAG
        print_success "SQS poller started with $COUNT instances"
        echo ""
        print_info "To monitor poller: docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller"
    else
        print_success "ESM mode configured (native LocalStack polling)"
        echo ""
        print_info "To monitor Lambda containers: watch -n 0.5 'docker ps | grep lambda'"
    fi
    
    echo ""
    print_success "🎉 Deployment complete!"
    echo ""
    
    print_info "Next steps:"
    echo "  1. Monitor SQS queues: $0 monitor sqs"
    echo "  2. Monitor jobs: $0 monitor api"
    if [ "$USE_POLLER" = "true" ]; then
        echo "  3. Check poller logs: docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller"
    else
        echo "  3. Verify ESMs: aws --endpoint-url=http://localhost:\${LOCALSTACK_PORT:-4567} lambda list-event-source-mappings --region us-east-1"
    fi
    echo ""
}

# ============================================================================
# List Lambda Workers
# ============================================================================

list_workers() {
    print_header "${BLUE}📋 Lambda Workers${NC}"
    
    # Check if LocalStack is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-localstack"; then
        print_error "LocalStack is not running"
        echo ""
        echo "Start LocalStack first:"
        echo "  $0 start --standalone"
        echo "  $0 start --integrated"
        echo ""
        exit 1
    fi
    
    echo ""
    print_info "Fetching Lambda workers from LocalStack..."
    echo ""
    
    # Use AWS CLI to list Lambda workers from LocalStack
    AWS_ENDPOINT="http://localhost:4566"
    AWS_REGION="${AWS_REGION:-us-east-1}"
    
    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        echo ""
        echo "Install AWS CLI:"
        echo "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        echo ""
        echo "Or use Docker to run AWS CLI:"
        echo "  docker run --rm -it --network external-system_default amazon/aws-cli --endpoint-url=http://localstack:4566 lambda list-functions"
        echo ""
        exit 1
    fi
    
    # List all Lambda workers
    FUNCTIONS=$(aws lambda list-functions \
        --endpoint-url "$AWS_ENDPOINT" \
        --region "$AWS_REGION" \
        --output json 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        print_error "Failed to list Lambda workers"
        echo ""
        echo "Make sure LocalStack is running and accessible at $AWS_ENDPOINT"
        exit 1
    fi
    
    # Check if any workers exist
    FUNCTION_COUNT=$(echo "$FUNCTIONS" | jq -r '.Functions | length' 2>/dev/null)
    
    if [ -z "$FUNCTION_COUNT" ] || [ "$FUNCTION_COUNT" = "0" ]; then
        print_warning "No Lambda workers found"
        echo ""
        echo "Deploy Lambda workers first:"
        echo "  $0 deploy-workers"
        echo ""
        exit 0
    fi
    
    # Display workers in a formatted table
    echo -e "${GREEN}Found $FUNCTION_COUNT Lambda worker(s):${NC}"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    printf "%-55s %-20s %-15s\n" "WORKER NAME" "LAST MODIFIED" "MEMORY (MB)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    echo "$FUNCTIONS" | jq -r '.Functions[] | [.FunctionName, .LastModified, (.MemorySize|tostring)] | @tsv' | \
    while IFS=$'\t' read -r name modified memory; do
        # Format date
        modified_date=$(echo "$modified" | cut -d'T' -f1)
        printf "%-55s %-20s %-15s\n" "$name" "$modified_date" "$memory"
    done
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    print_info "View logs for a specific worker:"
    echo "  $0 logs <worker-name>"
    echo ""
}

# ============================================================================
# Monitor Commands
# ============================================================================

monitor_api() {
    print_header "${CYAN}📊 Monitoring Jobs (API)${NC}"
    
    # Check if monitor script exists
    if [ ! -f "$SCRIPT_DIR/monitor-jobs-api.sh" ]; then
        print_error "monitor-jobs-api.sh not found in $SCRIPT_DIR"
        exit 1
    fi
    
    # Execute the monitor script
    exec "$SCRIPT_DIR/monitor-jobs-api.sh"
}

monitor_sqs() {
    print_header "${CYAN}📊 Monitoring SQS Queues${NC}"
    
    # Check if monitor script exists
    if [ ! -f "$SCRIPT_DIR/monitor-sqs-messages.sh" ]; then
        print_error "monitor-sqs-messages.sh not found in $SCRIPT_DIR"
        exit 1
    fi
    
    # Pass optional queue prefix argument if provided
    # Usage: ./scripts/local-env.sh monitor sqs [queue-prefix]
    exec "$SCRIPT_DIR/monitor-sqs-messages.sh" "$@"
}

# ============================================================================
# Logs Command
# ============================================================================

show_logs() {
    local worker_name="$1"
    
    # If worker name is provided, show Lambda CloudWatch logs
    if [ -n "$worker_name" ]; then
        show_lambda_logs "$worker_name"
        return
    fi
    
    # Otherwise show all Docker service logs
    print_header "${CYAN}📝 Service Logs${NC}"
    
    echo ""
    print_info "Showing logs for all services (Ctrl+C to exit)..."
    echo ""
    
    # Follow logs from all compose files (including all profiles)
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_KAFKA" logs -f 2>/dev/null &
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" --profile db --profile orchestrator --profile dev-tools logs -f 2>/dev/null &
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller logs -f 2>/dev/null &
    
    wait
}

show_lambda_logs() {
    local worker_name="$1"
    
    print_header "${CYAN}📝 Lambda Worker Logs: ${worker_name}${NC}"
    
    # Check if LocalStack is running
    if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-localstack"; then
        print_error "LocalStack is not running"
        echo ""
        echo "Start LocalStack first:"
        echo "  $0 start --standalone"
        echo "  $0 start --integrated"
        echo ""
        exit 1
    fi
    
    echo ""
    print_info "Fetching CloudWatch logs for worker: $worker_name"
    echo ""
    
    # Use AWS CLI to get CloudWatch logs from LocalStack
    AWS_ENDPOINT="http://localhost:4566"
    AWS_REGION="${AWS_REGION:-us-east-1}"
    LOG_GROUP="/aws/lambda/$worker_name"
    
    # Check if AWS CLI is available
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        echo ""
        echo "Install AWS CLI:"
        echo "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
        echo ""
        exit 1
    fi
    
    # Check if the log group exists
    LOG_GROUPS=$(aws logs describe-log-groups \
        --endpoint-url "$AWS_ENDPOINT" \
        --region "$AWS_REGION" \
        --log-group-name-prefix "$LOG_GROUP" \
        --output json 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        print_error "Failed to access CloudWatch logs"
        echo ""
        echo "Make sure LocalStack is running and accessible at $AWS_ENDPOINT"
        exit 1
    fi
    
    LOG_GROUP_COUNT=$(echo "$LOG_GROUPS" | jq -r '.logGroups | length' 2>/dev/null)
    
    if [ -z "$LOG_GROUP_COUNT" ] || [ "$LOG_GROUP_COUNT" = "0" ]; then
        print_warning "No logs found for worker: $worker_name"
        echo ""
        echo "This could mean:"
        echo "  1. The worker hasn't been invoked yet"
        echo "  2. The worker name is incorrect"
        echo ""
        echo "List available workers:"
        echo "  $0 list workers"
        echo ""
        exit 0
    fi
    
    # Get log streams
    LOG_STREAMS=$(aws logs describe-log-streams \
        --endpoint-url "$AWS_ENDPOINT" \
        --region "$AWS_REGION" \
        --log-group-name "$LOG_GROUP" \
        --order-by LastEventTime \
        --descending \
        --max-items 5 \
        --output json 2>/dev/null)
    
    STREAM_COUNT=$(echo "$LOG_STREAMS" | jq -r '.logStreams | length' 2>/dev/null)
    
    if [ -z "$STREAM_COUNT" ] || [ "$STREAM_COUNT" = "0" ]; then
        print_warning "No log streams found for worker: $worker_name"
        echo ""
        echo "The worker exists but hasn't been invoked yet."
        echo ""
        exit 0
    fi
    
    print_success "Found $STREAM_COUNT recent log stream(s)"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Get the most recent log stream
    LATEST_STREAM=$(echo "$LOG_STREAMS" | jq -r '.logStreams[0].logStreamName' 2>/dev/null)
    
    # Fetch and display logs from the most recent stream
    aws logs get-log-events \
        --endpoint-url "$AWS_ENDPOINT" \
        --region "$AWS_REGION" \
        --log-group-name "$LOG_GROUP" \
        --log-stream-name "$LATEST_STREAM" \
        --output json 2>/dev/null | \
        jq -r '.events[] | "\(.timestamp | todate) | \(.message)"' 2>/dev/null
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Offer to tail logs in real-time
    print_info "To tail logs in real-time (when worker is invoked):"
    echo "  aws logs tail '$LOG_GROUP' --endpoint-url $AWS_ENDPOINT --region $AWS_REGION --follow"
    echo ""
}

# ============================================================================
# Access URLs Display
# ============================================================================

show_access_urls() {
    local mode="$1"
    
    echo -e "${GREEN}🌐 Access URLs:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    echo -e "${BOLD}Databases:${NC}"
    echo -e "  ${GREEN}→${NC} DTM Core DB:           ${BLUE}localhost:${DTM_DB_PORT_HOST:-5448}${NC}"
    echo -e "  ${GREEN}→${NC} Order Processing DB:   ${BLUE}localhost:5449${NC}"
    echo -e "  ${GREEN}→${NC} IoT Sensor DB:         ${BLUE}localhost:5450${NC}"
    echo -e "  ${GREEN}→${NC} Infra Provisioning DB: ${BLUE}localhost:5451${NC}"
    echo ""
    
    if [ "$mode" = "standalone" ]; then
        echo -e "${BOLD}Event Streaming:${NC}"
        echo -e "  ${GREEN}→${NC} Kafka Broker:    ${BLUE}localhost:9092${NC}"
        echo -e "  ${GREEN}→${NC} Kafka UI:        ${BLUE}http://localhost:8090${NC}"
        echo -e "  ${GREEN}→${NC} Zookeeper:       ${BLUE}localhost:2181${NC}"
        echo ""
    else
        echo -e "${BOLD}Event Streaming:${NC}"
        echo -e "  ${YELLOW}→${NC} Using external system's Kafka at: ${BLUE}$EXTERNAL_KAFKA_BROKER${NC}"
        echo -e "  ${YELLOW}→${NC} Network: ${BLUE}$EXTERNAL_KAFKA_NETWORK${NC}"
        echo -e "  ${GREEN}→${NC} External system Kafka UI: ${BLUE}http://localhost:8088${NC} (if the external system's kafka-ui is running)"
        echo ""
    fi
    
    echo -e "${BOLD}AWS Services (LocalStack):${NC}"
    echo -e "  ${GREEN}→${NC} LocalStack:      ${BLUE}http://localhost:${LOCALSTACK_PORT:-4567}${NC}"
    echo -e "  ${GREEN}→${NC} SQS Poller:      ${BLUE}running${NC} (docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller)"
    echo ""
    
    # Show orchestrator and monitor URLs if enabled
    if [ "$START_ORCHESTRATOR" = true ] || [ "$START_MONITOR" = true ]; then
        echo -e "${BOLD}DTM Applications:${NC}"
        if [ "$START_ORCHESTRATOR" = true ]; then
            echo -e "  ${GREEN}→${NC} Orchestrator API: ${BLUE}http://localhost:3002${NC}"
            echo -e "  ${GREEN}→${NC} Health Check:     ${BLUE}http://localhost:3002/api/v1/health${NC}"
        fi
        if [ "$START_MONITOR" = true ]; then
            echo -e "  ${GREEN}→${NC} Monitor Dashboard: ${BLUE}http://localhost:5173${NC}"
        fi
        echo ""
    fi
    
    echo -e "${GREEN}📊 Useful Commands:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${BLUE}$0 deploy-workers${NC}                              Deploy Lambda workers (10 pollers)"
    echo -e "  ${BLUE}$0 deploy-workers --count=N${NC}                    Deploy with custom poller count"
    echo -e "  ${BLUE}$0 list workers${NC}                                List all deployed Lambda workers"
    echo -e "  ${BLUE}$0 monitor api${NC}                                 Monitor DTM jobs via API"
    echo -e "  ${BLUE}$0 monitor sqs${NC}                                 Monitor all SQS queues + DLQs"
    echo -e "  ${BLUE}$0 monitor dashboard${NC}                           Start DTM Monitor dashboard (port 5173)"
    echo -e "  ${BLUE}$0 logs${NC}                                        View all service logs"
    echo -e "  ${BLUE}$0 purge${NC}                                       Clear DB, SQS, and Kafka"
    echo -e "  ${BLUE}$0 stop${NC}                                        Stop all services"
    echo -e "  ${BLUE}$0 clean${NC}                                       Stop and remove all volumes"
    echo ""
    
    echo -e "${GREEN}📦 Docker Commands:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "  ${BLUE}docker ps${NC}                                  Check running containers"
    echo -e "  ${BLUE}docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-db${NC}        View database logs"
    echo -e "  ${BLUE}docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-localstack${NC} View LocalStack logs"
    echo -e "  ${BLUE}docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller${NC} View SQS poller logs"
    echo ""
}

# ============================================================================
# Main Command Router
# ============================================================================

# Initialize optional flags
START_ORCHESTRATOR=false
START_MONITOR=false
REBUILD_FLAG=false

# Parse optional flags for start command
if [ "${1}" = "start" ]; then
    # Save the mode
    MODE="${2}"
    # Parse flags starting from the third argument
    shift 2  # Skip "start" and mode
    while [ $# -gt 0 ]; do
        case "$1" in
            --orchestrator)
                START_ORCHESTRATOR=true
                shift
                ;;
            --monitor)
                START_MONITOR=true
                shift
                ;;
            --build|--rebuild)
                REBUILD_FLAG=true
                shift
                ;;
            *)
                print_error "Unknown flag: $1"
                echo ""
                echo "Valid flags: --orchestrator, --monitor, --build"
                echo ""
                show_help
                exit 1
                ;;
        esac
    done
    # Restore positional parameters
    set -- "start" "$MODE"
fi

case "${1:-help}" in
    start)
        case "${2}" in
            --standalone)
                start_standalone
                ;;
            --integrated)
                start_integrated
                ;;
            *)
                print_error "Unknown start mode: ${2}"
                echo ""
                echo "Usage: $0 start <--standalone|--integrated> [--orchestrator] [--monitor] [--build]"
                echo ""
                echo "  --standalone    Start with local Kafka"
                echo "  --integrated    Start using the external system's Kafka (requires it running)"
                echo ""
                echo "Optional flags:"
                echo "  --orchestrator  Start orchestrator service in Docker (debug always enabled on port 9229)"
                echo "  --monitor       Start DTM Monitor dashboard (Vite dev server on port 5173)"
                echo "  --build         Force rebuild of all Docker images"
                echo ""
                echo "For integrated mode, ensure the external system is running first:"
                echo "  cd ../external-system"
                echo "  docker compose --env-file "$ENV_FILE" -f docker-compose-kafka.yaml up -d"
                echo "  docker compose --env-file "$ENV_FILE" -f docker-compose-local.yaml up -d"
                echo ""
                exit 1
                ;;
        esac
        ;;
    
    stop)
        stop_all
        ;;
    
    purge)
        purge_all "$2"  # Pass the --full flag if provided
        ;;
    
    purge-db)
        purge_db_only
        ;;
    
    clean)
        clean_all
        ;;
    
    deploy-workers)
        shift # Remove "deploy-workers"
        deploy_workers "$@"
        ;;
    
    scale-pollers)
        shift
        # Check if argument is provided
        if [ -z "$1" ]; then
            print_error "Usage: $0 scale-pollers <count>"
            exit 1
        fi
        
        COUNT=$1
        print_header "${BLUE}⚖️  Scaling SQS Pollers${NC}"
        
        # Check if LocalStack is running
        if ! docker ps | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-localstack"; then
            print_error "LocalStack is not running"
            exit 1
        fi
        
        print_info "Scaling SQS poller to $COUNT instances..."
        # Use --no-recreate to preserve existing containers where possible
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_WORKERS" --profile poller up -d --scale sqs-poller=$COUNT --no-recreate
        print_success "SQS poller scaled to $COUNT instances"
        echo ""
        print_info "Monitor pollers: docker logs -f ${COMPOSE_PROJECT_NAME:-dtm}-sqs-poller"
        echo ""
        ;;

    list)
        case "${2}" in
            workers)
                list_workers
                ;;
            *)
                print_error "Unknown list target: ${2}"
                echo ""
                echo "Usage: $0 list <workers>"
                echo ""
                echo "  workers    List all deployed Lambda workers in LocalStack"
                echo ""
                echo "Example:"
                echo "  $0 list workers"
                echo ""
                exit 1
                ;;
        esac
        ;;
    
    monitor)
        case "${2}" in
            api)
                monitor_api
                ;;
            sqs)
                # Pass any additional arguments (queue prefix) to monitor_sqs
                shift 2  # Remove "monitor" and "sqs" from arguments
                monitor_sqs "$@"
                ;;
            dashboard)
                start_monitor_dashboard
                ;;
            *)
                print_error "Unknown monitor target: ${2}"
                echo ""
                echo "Usage: $0 monitor <api|sqs|dashboard> [options]"
                echo ""
                echo "  api                  Monitor DTM jobs via API"
                echo "  sqs [queue-prefix]   Monitor SQS queues + DLQs"
                echo "  dashboard            Start DTM Monitor dashboard (Vite dev on port 5173)"
                echo ""
                echo "Examples:"
                echo "  $0 monitor sqs                # All SQS queues + DLQs"
                echo "  $0 monitor sqs customer       # Only customer queues + DLQs"
                echo "  $0 monitor sqs order           # Only order queues + DLQs"
                echo ""
                exit 1
                ;;
        esac
        ;;
    
    logs)
        # Pass optional worker name to show_logs
        # Usage: ./scripts/local-env.sh logs [worker-name]
        show_logs "${2}"
        ;;
    
    reset)
        # Reset Kafka consumer groups (useful after destructive tests or corrupted state)
        print_header "🔄 Resetting Kafka Consumer Groups"
        echo ""
        print_info "This fixes 'coordinator is not aware of this member' errors"
        echo ""
        
        # Stop dev-ack-simulator first
        print_info "1/4: Stopping dev-ack-simulator..."
        docker stop ${COMPOSE_PROJECT_NAME:-dtm}-dev-ack-simulator > /dev/null 2>&1 || true
        sleep 3
        
        # Delete the consumer group
        print_info "2/4: Deleting Kafka consumer group..."
        docker exec ${COMPOSE_PROJECT_NAME:-dtm}-kafka kafka-consumer-groups \
            --bootstrap-server dtm-kafka:29092 \
            --group dev-ack-simulator-group \
            --delete 2>&1 || print_warning "Consumer group might already be deleted"
        
        sleep 2
        
        # Restart dev-ack-simulator
        print_info "3/4: Restarting dev-ack-simulator..."
        docker start ${COMPOSE_PROJECT_NAME:-dtm}-dev-ack-simulator > /dev/null 2>&1 || true
        
        # Wait for stabilization
        print_info "4/4: Waiting 30 seconds for Kafka consumer to stabilize..."
        sleep 30
        
        # Verify health
        if curl -s "http://localhost:3001/health" > /dev/null 2>&1; then
            print_success "✅ dev-ack-simulator is healthy and ready"
        else
            print_warning "⚠️  Health check failed - simulator might need more time"
        fi
        
        # Check for any remaining errors in logs
        if docker logs ${COMPOSE_PROJECT_NAME:-dtm}-dev-ack-simulator --tail 10 2>&1 | grep -q "coordinator is not aware"; then
            print_warning "⚠️  Still seeing Kafka consumer errors"
            print_info "Try: ./scripts/local-env.sh purge --full"
        else
            print_success "✅ No Kafka consumer errors detected"
        fi
        
        echo ""
        print_info "You can now run E2E tests"
        ;;
    
    help|--help|-h)
        show_help
        ;;
    
    *)
        print_error "Unknown command: ${1}"
        echo ""
        show_help
        exit 1
        ;;
esac

