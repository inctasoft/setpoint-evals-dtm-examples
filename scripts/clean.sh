#!/bin/bash

# ============================================================================
# Clean - Build artifacts and cache cleanup
# ============================================================================
# This script cleans:
# 1. Built directories (dist, build, .next, etc.)
# 2. Node modules (optional with --deps flag)
# 3. pnpm cache
# 
# Does NOT touch Docker containers/volumes/images
# ============================================================================

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           Build Cleanup - DTM                                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ============================================================================
# 1. Clean built directories
# ============================================================================
echo "🧹 Step 1: Cleaning built directories..."
echo ""

# Find and remove dist directories
DIST_DIRS=$(find . -type d -name "dist" -not -path "*/node_modules/*" 2>/dev/null || true)
if [ -n "$DIST_DIRS" ]; then
    echo "Removing dist directories:"
    echo "$DIST_DIRS" | sed 's/^/  - /'
    echo "$DIST_DIRS" | xargs rm -rf
else
    echo "  No dist directories found"
fi

# Find and remove build directories
BUILD_DIRS=$(find . -type d -name "build" -not -path "*/node_modules/*" 2>/dev/null || true)
if [ -n "$BUILD_DIRS" ]; then
    echo "Removing build directories:"
    echo "$BUILD_DIRS" | sed 's/^/  - /'
    echo "$BUILD_DIRS" | xargs rm -rf
else
    echo "  No build directories found"
fi

# Remove .next directories (Next.js)
NEXT_DIRS=$(find . -type d -name ".next" -not -path "*/node_modules/*" 2>/dev/null || true)
if [ -n "$NEXT_DIRS" ]; then
    echo "Removing .next directories:"
    echo "$NEXT_DIRS" | sed 's/^/  - /'
    echo "$NEXT_DIRS" | xargs rm -rf
else
    echo "  No .next directories found"
fi

echo "✅ Built directories cleaned"
echo ""

# ============================================================================
# 2. Clean node_modules (optional)
# ============================================================================
if [ "$1" = "--deps" ]; then
    echo "🗑️  Step 2: Removing node_modules..."
    echo ""
    
    NODE_MODULES=$(find . -type d -name "node_modules" -not -path "*/node_modules/node_modules/*" 2>/dev/null || true)
    if [ -n "$NODE_MODULES" ]; then
        echo "Removing node_modules:"
        echo "$NODE_MODULES" | sed 's/^/  - /'
        echo "$NODE_MODULES" | xargs rm -rf
        echo "✅ node_modules removed"
    else
        echo "✅ No node_modules found"
    fi
    echo ""
fi

# ============================================================================
# 3. Clean pnpm cache
# ============================================================================
echo "🧹 Step 3: Cleaning pnpm cache..."
echo ""

pnpm store prune
echo "✅ pnpm cache cleaned"
echo ""

# ============================================================================
# Summary
# ============================================================================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                  Build Cleanup Complete! 🎉                    ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Built directories cleaned"
if [ "$1" = "--deps" ]; then
    echo "✅ node_modules removed"
fi
echo "✅ pnpm cache cleaned"
echo ""
echo "Next steps:"
if [ "$1" = "--deps" ]; then
    echo "  Run 'pnpm install' to restore dependencies"
fi
echo "  Run 'pnpm build' to rebuild packages"
echo ""

