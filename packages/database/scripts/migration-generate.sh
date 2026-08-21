#!/bin/bash

# Script to generate a TypeORM migration from entity changes
# Usage: ./scripts/migration-generate.sh MigrationName

if [ -z "$1" ]; then
    echo "Error: Migration name is required"
    echo "Usage: pnpm run migration:generate MigrationName"
    exit 1
fi

MIGRATION_NAME=$1

# Change to the database package directory
cd "$(dirname "$0")/.."

# Build the package first to ensure entities are up to date
echo "Building database package..."
pnpm run build

# Load environment variables and generate migration
DATABASE_HOST=localhost dotenv -e ../../.env -- \
    typeorm-ts-node-commonjs migration:generate ./migrations/$MIGRATION_NAME -d src/config/typeorm.config.ts

if [ $? -eq 0 ]; then
    echo ""
    echo "Migration generated successfully!"
else
    echo ""
    echo "No changes detected in database schema, or an error occurred."
fi

