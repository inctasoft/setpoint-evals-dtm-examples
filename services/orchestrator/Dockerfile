# ============================================
# Development Dockerfile for Orchestrator
# Includes hot-reload and development tools
# ============================================
# Note: Build context should be project root to access workspace packages

FROM node:22-alpine

# Install pnpm globally
RUN npm install -g pnpm@10.13.1

WORKDIR /app

# Copy workspace configuration and lock file from root
COPY pnpm-workspace.yaml pnpm-lock.yaml .pnpmfile.cjs ./

# Copy all package.json files for dependency resolution
COPY packages/core/package.json ./packages/core/
COPY packages/errors/package.json ./packages/errors/
COPY packages/database/package.json ./packages/database/
COPY packages/kafka-producer/package.json ./packages/kafka-producer/
COPY packages/kafka-consumer/package.json ./packages/kafka-consumer/
COPY services/orchestrator/package.json ./services/orchestrator/

# Install all dependencies (using --no-frozen-lockfile for development)
RUN pnpm install --no-frozen-lockfile

# Copy workspace package sources
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src

COPY packages/errors/tsconfig.json ./packages/errors/
COPY packages/errors/src ./packages/errors/src

COPY packages/database/tsconfig.json ./packages/database/
COPY packages/database/src ./packages/database/src

COPY packages/kafka-producer/tsconfig.json ./packages/kafka-producer/
COPY packages/kafka-producer/src ./packages/kafka-producer/src

COPY packages/kafka-consumer/tsconfig.json ./packages/kafka-consumer/
COPY packages/kafka-consumer/src ./packages/kafka-consumer/src

# Build workspace dependencies (order matters: core first, then packages)
RUN pnpm --filter @dtm/core run build
RUN pnpm --filter @dtm/errors run build
RUN pnpm --filter @dtm/database run build
RUN pnpm --filter @dtm/kafka-producer run build
RUN pnpm --filter @dtm/kafka-consumer run build

# Copy orchestrator source files (exclude node_modules, dist, etc.)
COPY services/orchestrator/tsconfig.json ./services/orchestrator/
COPY services/orchestrator/tsconfig.build.json ./services/orchestrator/
COPY services/orchestrator/nest-cli.json ./services/orchestrator/
COPY services/orchestrator/src ./services/orchestrator/src

WORKDIR /app/services/orchestrator

# Expose application port
EXPOSE 3000

# Start in development mode with hot-reload
CMD ["pnpm", "run", "start:dev"]
