#!/bin/bash

# Script to create a new TypeORM migration
# Usage: ./scripts/migration-create.sh MigrationName

if [ -z "$1" ]; then
    echo "Error: Migration name is required"
    echo "Usage: pnpm run migration:create MigrationName"
    exit 1
fi

MIGRATION_NAME=$1

# Change to the database package directory
cd "$(dirname "$0")/.."

# Load environment variables and create migration
DATABASE_HOST=localhost dotenv -e ../../.env -- \
    typeorm-ts-node-commonjs migration:create ./migrations/$MIGRATION_NAME

echo ""
echo "Migration created successfully!"
echo "Don't forget to implement the up() and down() methods in the generated file."

