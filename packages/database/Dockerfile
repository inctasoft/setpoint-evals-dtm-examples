FROM node:22-alpine

RUN npm install -g pnpm@10.13.1

WORKDIR /app

# Copy workspace configuration files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Copy package.json for database package
COPY packages/database/package.json ./packages/database/

# Install dependencies (skip scripts like husky)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy database package source
COPY packages/database ./packages/database

# Build database package
WORKDIR /app/packages/database
RUN pnpm run build

# Run migrations
CMD ["pnpm", "run", "migration:run"]

