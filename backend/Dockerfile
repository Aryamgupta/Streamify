# Stage 1: Build & Compile TypeScript
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for sqlite3 native bindings
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune devDependencies to keep node_modules small for production
RUN npm prune --production

# Stage 2: Production runtime
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies (ffmpeg)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy build output and dependencies from builder stage
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create necessary runtime directories
RUN mkdir -p /app/data /app/recordings /app/live

# Environment variables with sensible defaults for container environment
ENV NODE_ENV=production \
    PORT=5000 \
    DB_PATH=/app/data/cctv.db \
    LIVE_PATH=/app/live \
    MOCK_MODE=false

EXPOSE 5000

# Default command starts the API backend, can be overridden for the recorder daemon
CMD ["node", "dist/index.js"]
