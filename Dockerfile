# Multi-stage build for Flux Atlas
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend for production
RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-build

WORKDIR /app/backend

# Copy backend package files
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
RUN npm ci

# Copy backend source
COPY backend/src ./src

# Build backend
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies for backend
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --only=production

# Copy built backend from build stage
COPY --from=backend-build /app/backend/dist ./dist

# Copy built frontend from build stage
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Set default environment variables (from backend/.env)
ENV PORT=4000 \
    FLUX_API_BASE_URL=https://api.runonflux.io \
    FLUX_DAEMON_LIST_ENDPOINT=/daemon/listfluxnodes \
    FLUX_RPC_PROTOCOL=http \
    FLUX_RPC_PORT=16127 \
    FLUX_RPC_TIMEOUT=15000 \
    FLUX_MAX_WORKERS=24 \
    FLUX_MAX_NODES=10000 \
    FLUX_QUICK_SAMPLE_NODES=0 \
    FLUX_MAX_PEERS_PER_NODE=0 \
    FLUX_MAX_EDGES=0 \
    FLUX_MAX_NODE_DEGREE=0 \
    FLUX_MAX_STUB_NODES=0 \
    FLUX_LAYOUT_NODE_CAP=4200 \
    FLUX_LAYOUT_SEED=flux-atlas \
    FLUX_UPDATE_INTERVAL=1800000 \
    FLUX_INCLUDE_EXTERNAL_PEERS=false \
    FLUX_ALLOW_INSECURE_SSL=true \
    FLUX_ENABLE_ARCANE_PROBE=true

# Install serve to host frontend
RUN npm install -g serve

# Create startup script
WORKDIR /app
RUN echo '#!/bin/sh' > start.sh && \
    echo 'serve -s /app/frontend/dist -l 3000 &' >> start.sh && \
    echo 'cd /app/backend && node dist/index.js' >> start.sh && \
    chmod +x start.sh

# Expose ports
EXPOSE 3000 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/healthz || exit 1

# Run both services
CMD ["/bin/sh", "/app/start.sh"]
