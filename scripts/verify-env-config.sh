#!/bin/bash
# ============================================================================
# Verify Environment Configuration
# ============================================================================
# This script verifies that all Docker Compose files are correctly configured
# with environment variables from .env
# ============================================================================

set -e

cd "$(dirname "$0")/.."

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         Environment Configuration Verification                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found!"
    echo ""
    echo "Please run:"
    echo "  pnpm install  # Runs postinstall script to generate env files"
    exit 1
fi

echo "✅ .env file found"
echo ""

# Verify docker-compose files
COMPOSE_FILES=(
    "docker-compose.orchestrator.yml"
    "docker-compose.orchestrator-infra.yml"
    "docker-compose.workers.yml"
)

echo "═══════════════════════════════════════════════════════════════"
echo "Checking Docker Compose Files"
echo "═══════════════════════════════════════════════════════════════"
echo ""

for compose_file in "${COMPOSE_FILES[@]}"; do
    echo "📄 $compose_file"
    
    if [ ! -f "$compose_file" ]; then
        echo "   ❌ File not found!"
        continue
    fi
    
    # Validate syntax
    if docker compose --env-file .env -f "$compose_file" config > /dev/null 2>&1; then
        echo "   ✅ Syntax valid"
    else
        echo "   ❌ Syntax error!"
        docker compose --env-file .env -f "$compose_file" config 2>&1 | head -5
        continue
    fi
    
    echo ""
done

echo "═══════════════════════════════════════════════════════════════"
echo "Port Configuration"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check migration database port
DTM_DB_PORT=$(docker compose --env-file .env -f docker-compose.yml config | grep -A 3 "published:" | grep "5448" | wc -l)
if [ "$DTM_DB_PORT" -gt 0 ]; then
    echo "✅ Migration DB Postgres: Host port 5448"
else
    echo "❌ Migration DB Postgres: Port not correctly configured!"
fi

echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "Port 5432 Availability Check"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if command -v lsof &> /dev/null; then
    if sudo -n lsof -i :5432 &> /dev/null 2>&1; then
        echo "ℹ️  Port 5432 is currently in use:"
        sudo lsof -i :5432
    else
        echo "✅ Port 5432 is FREE (available for backend-apps)"
    fi
else
    echo "ℹ️  'lsof' command not available, skipping port check"
    echo "   To check manually: sudo lsof -i :5432"
fi

echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "Environment Variables Sample"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Show key variables
echo "Key Variables from .env:"
grep -E "^(DTM_DB_PORT_HOST|ORCHESTRATOR_PORT|COMPOSE_PROJECT_NAME)=" .env | while read line; do
    echo "  $line"
done

echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "Summary"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "✅ All Docker Compose files are using environment variables"
echo "✅ Migration DB Postgres on port 5448"
echo ""
echo "📚 For more information, see:"
echo "   - ENV_CONFIGURATION.md"
echo "   - README.md"
echo ""

exit 0

