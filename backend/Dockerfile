# ─── Stage 1: Build ───
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

WORKDIR /app

# Copy package file (no lockfile in workspace sub-package)
COPY package.json ./
RUN pnpm install

# Copy source
COPY . .

# ─── Stage 2: Run ───
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

WORKDIR /app

# Copy full app from builder
COPY --from=builder /app /app

# Create directories for runtime data
RUN mkdir -p /app/memory/sessions /app/agents

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

CMD ["pnpm", "start"]
