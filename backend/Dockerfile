# Multi-stage image: builds the React frontend, installs production-only
# backend dependencies, and ships both in a small non-root runtime image.
# Build context is the repository root:
#   docker build -f backend/Dockerfile -t cc-checkout .
#
# Node 22 LTS is used because Node 20 reached end-of-life in April 2026.

# ---- Stage 1: build the React SPA -----------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: production backend dependencies -----------------------------
FROM node:22-alpine AS backend-deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    PUBLIC_DIR=/app/public
WORKDIR /app

COPY --from=backend-deps /build/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY --from=frontend /build/frontend/dist ./public

# Run as the unprivileged "node" user that ships with the base image.
USER node
EXPOSE 3000

# Container-level liveness (the ALB performs its own check on AWS).
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

# Exec form so Node is PID 1 and receives SIGTERM for graceful shutdown.
CMD ["node", "src/server.js"]
