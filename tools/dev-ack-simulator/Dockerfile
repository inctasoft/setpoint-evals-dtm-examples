# ═══════════════════════════════════════════════════════════════════════════
# Development Acknowledgement Simulator - Dockerfile
# ═══════════════════════════════════════════════════════════════════════════
# ⚠️  DEVELOPMENT ONLY - Do not deploy to production!
#
# This service simulates external system acknowledgements for testing purposes.
# In production, real acknowledgements come from external systems.
#
# Features:
# - Auto-acknowledges completed workflow steps
# - Supports simulated delays
# - Supports custom acknowledgement payloads
# - Enables end-to-end testing without external system integration
#
# ═══════════════════════════════════════════════════════════════════════════

# node:22-alpine (was node:20-alpine): the zeromq npm package ships prebuilt
# musl N-API binaries inside its tarball for Node 22 (ABI 127) ONLY — Node 20
# (ABI 115) musl is not covered and would force a from-source cmake build.
FROM node:22-alpine AS base

# Install pnpm
RUN npm install -g pnpm

# ═══════════════════════════════════════════════════════════════════════════
# Dependencies Stage
# ═══════════════════════════════════════════════════════════════════════════

FROM base AS dependencies

WORKDIR /app

# Copy package.json (build context is the REPO ROOT so @dtm/core is
# available for the TypeScript build — see tsconfig paths)
COPY tools/dev-ack-simulator/package.json ./
# @dtm/core is an optionalDependency (standalone install cannot resolve
# workspace:*); tsc type-checks against its SOURCE via tsconfig paths, and the
# runtime resolves it from the compose volume mount (node_modules/@dtm/core).
COPY packages/core/package.json /packages/core/package.json
COPY packages/core/tsconfig.json /packages/core/tsconfig.json
COPY packages/core/src /packages/core/src

# Install dependencies (no lockfile for standalone service).
# --ignore-scripts: explicit choice (avoids pnpm 10's ERR_PNPM_IGNORED_BUILDS
# fatal); zeromq needs no install script — its prebuilt musl/glibc N-API
# binaries ship inside the tarball. Same pattern as the orchestrator's
# Dockerfile.dev.
RUN pnpm install --prod=false --ignore-scripts

# Build @dtm/core's dist and place it in node_modules as a REAL directory (a
# symlink would break COPY --from across stages). tsc then resolves @dtm/core
# via the normal node_modules lookup — no tsconfig paths needed — and the
# simulator build keeps rootDir=src (dist/main.js layout preserved).
RUN /app/node_modules/.bin/tsc -p /packages/core/tsconfig.json \
    && mkdir -p /app/node_modules/@dtm \
    && cp -r /packages/core /app/node_modules/@dtm/core

# ═══════════════════════════════════════════════════════════════════════════
# Build Stage
# ═══════════════════════════════════════════════════════════════════════════

FROM base AS build

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules
# The @dtm/core sources for the TypeScript paths mapping live in the
# dependencies stage's filesystem root — stages do NOT inherit each other's
# files, so carry them over explicitly.
COPY --from=dependencies /packages/core /packages/core

# Copy source code
COPY tools/dev-ack-simulator/ ./

# Build application
RUN pnpm run build

# Remove dev dependencies
RUN pnpm prune --prod

# ═══════════════════════════════════════════════════════════════════════════
# Production Stage
# ═══════════════════════════════════════════════════════════════════════════

FROM base AS production

WORKDIR /app

# Copy only necessary files
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 && \
    chown -R nestjs:nodejs /app

USER nestjs

# Expose health check port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/main"]

