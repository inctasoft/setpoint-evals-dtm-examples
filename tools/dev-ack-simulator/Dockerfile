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

FROM node:20-alpine AS base

# Install pnpm
RUN npm install -g pnpm

# ═══════════════════════════════════════════════════════════════════════════
# Dependencies Stage
# ═══════════════════════════════════════════════════════════════════════════

FROM base AS dependencies

WORKDIR /app

# Copy package.json
COPY package.json ./

# Install dependencies (no lockfile for standalone service)
RUN pnpm install --prod=false

# ═══════════════════════════════════════════════════════════════════════════
# Build Stage
# ═══════════════════════════════════════════════════════════════════════════

FROM base AS build

WORKDIR /app

# Copy dependencies from previous stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
COPY . .

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

