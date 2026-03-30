#!/bin/bash

# ============================================================================
# Clean All - Complete cleanup script
# ============================================================================
# This script:
# 1. Stops all Docker containers
# 2. Removes Docker volumes
# 3. Removes specific Docker images (init containers, workers)
# 4. Cleans pnpm cache
# ============================================================================

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║              Complete Cleanup - DTM                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# 1. Stop and remove all containers
# ============================================================================
echo "📦 Step 1: Stopping and removing all Docker containers..."
echo ""

if docker ps -aq | grep -q .; then
    # Stop all containers
    docker stop $(docker ps -aq) 2>/dev/null || true
    echo "✅ All containers stopped"
    
    # Remove all containers
    docker rm $(docker ps -aq) 2>/dev/null || true
    echo "✅ All containers removed"
else
    echo "✅ No containers found"
fi
echo ""

# ============================================================================
# 2. Remove Docker volumes
# ============================================================================
echo "🗄️  Step 2: Removing Docker volumes..."
echo ""

# Get ALL Docker volumes (not just project specific)
VOLUMES=$(docker volume ls -q)

if [ -n "$VOLUMES" ]; then
    echo "Found volumes to remove (ALL volumes):"
    echo "$VOLUMES" | sed 's/^/  - /'
    echo ""
    echo "$VOLUMES" | xargs docker volume rm 2>/dev/null || true
    echo "✅ All Docker volumes removed"
else
    echo "✅ No Docker volumes found"
fi
echo ""

# ============================================================================
# 3. Remove specific Docker images
# ============================================================================
echo "🐳 Step 3: Removing Docker images..."
echo ""

# Images to remove (init containers and workers)
IMAGES_TO_REMOVE=(
    "dtm-init-typeorm"
    "dtm-init-sqs"
    "dtm-kafka-init"
    "dtm-sqs-poller"
    "dtm-orchestrator"
    "dtm.*worker"  # Pattern for all workers
)

for IMAGE_PATTERN in "${IMAGES_TO_REMOVE[@]}"; do
    # Find images matching pattern
    IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "$IMAGE_PATTERN" || true)
    
    if [ -n "$IMAGES" ]; then
        echo "Removing images matching: $IMAGE_PATTERN"
        echo "$IMAGES" | while read -r IMAGE; do
            echo "  - $IMAGE"
            docker rmi "$IMAGE" 2>/dev/null || true
        done
    fi
done

echo "✅ Docker images cleaned"
echo ""

# ============================================================================
# 4. Clean pnpm cache
# ============================================================================
echo "🧹 Step 4: Cleaning pnpm cache..."
echo ""

pnpm store prune
echo "✅ pnpm cache cleaned"
echo ""

# ============================================================================
# Summary
# ============================================================================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    Cleanup Complete! 🎉                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ All containers stopped and removed"
echo "✅ Docker volumes removed"
echo "✅ Docker images removed"
echo "✅ pnpm cache cleaned"
echo ""
echo "Next steps:"
echo "  1. Run 'pnpm install' to restore dependencies"
echo "  2. Run './scripts/local-env.sh start' to rebuild and start services"
echo ""

