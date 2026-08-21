#!/bin/bash

# Fix Permissions Script
# Fixes permission issues after running services in Docker

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Fixing Docker-created file permissions...${NC}"
echo ""

# Check if running from the correct directory
if [ ! -f "pnpm-workspace.yaml" ]; then
  echo -e "${YELLOW}⚠️  Please run this script from the dtm root directory${NC}"
  exit 1
fi

echo -e "${YELLOW}This will fix permissions on build artifacts created by Docker${NC}"
echo ""

# Fix orchestrator dist folder
if [ -d "services/orchestrator/dist" ]; then
  echo -e "${BLUE}Fixing services/orchestrator/dist...${NC}"
  sudo chown -R $USER:$USER services/orchestrator/dist
  echo -e "${GREEN}✓ Fixed${NC}"
fi

# Fix database dist folder
if [ -d "packages/database/dist" ]; then
  echo -e "${BLUE}Fixing packages/database/dist...${NC}"
  sudo chown -R $USER:$USER packages/database/dist
  echo -e "${GREEN}✓ Fixed${NC}"
fi

# Fix node_modules if they exist and have permission issues
if [ -d "node_modules" ]; then
  echo -e "${BLUE}Checking root node_modules...${NC}"
  if ! touch node_modules/.permission_test 2>/dev/null; then
    echo -e "${YELLOW}Fixing root node_modules...${NC}"
    sudo chown -R $USER:$USER node_modules
    echo -e "${GREEN}✓ Fixed${NC}"
  else
    rm -f node_modules/.permission_test
    echo -e "${GREEN}✓ Already correct${NC}"
  fi
fi

if [ -d "services/orchestrator/node_modules" ]; then
  echo -e "${BLUE}Checking orchestrator node_modules...${NC}"
  if ! touch services/orchestrator/node_modules/.permission_test 2>/dev/null; then
    echo -e "${YELLOW}Fixing orchestrator node_modules...${NC}"
    sudo chown -R $USER:$USER services/orchestrator/node_modules
    echo -e "${GREEN}✓ Fixed${NC}"
  else
    rm -f services/orchestrator/node_modules/.permission_test
    echo -e "${GREEN}✓ Already correct${NC}"
  fi
fi

if [ -d "packages/database/node_modules" ]; then
  echo -e "${BLUE}Checking database node_modules...${NC}"
  if ! touch packages/database/node_modules/.permission_test 2>/dev/null; then
    echo -e "${YELLOW}Fixing database node_modules...${NC}"
    sudo chown -R $USER:$USER packages/database/node_modules
    echo -e "${GREEN}✓ Fixed${NC}"
  else
    rm -f packages/database/node_modules/.permission_test
    echo -e "${GREEN}✓ Already correct${NC}"
  fi
fi

echo ""
echo -e "${GREEN}✅ All permissions fixed!${NC}"
echo ""
echo -e "${BLUE}You can now run:${NC}"
echo "  cd services/orchestrator && pnpm start:dev"

