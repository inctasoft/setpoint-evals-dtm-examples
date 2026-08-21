FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies.
# NOTE (zeromq): prebuilt N-API binaries (incl. linux-x64 musl, Node 22) ship
# inside the zeromq tarball — no apk build toolchain required. If a future
# zeromq bump drops the in-tarball prebuild, add:
#   RUN apk add --no-cache python3 make g++
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Run the worker host
CMD ["npm", "start"]
