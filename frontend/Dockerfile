# ─── Stage 1: Build ───
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate

WORKDIR /app

# Copy only package files first for better layer caching
COPY package.json ./
RUN pnpm install

# Copy source
COPY . .

# Build with nginx-friendly API base (relative /api, proxied by nginx)
ENV VITE_API_BASE=/api
RUN pnpm build

# ─── Stage 2: Serve with Nginx ───
FROM nginx:alpine

# Copy the built frontend
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
