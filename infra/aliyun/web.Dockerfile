FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --fetch-retries=2 --fetch-timeout=30000
COPY apps/web/ ./
RUN npm run build

FROM node:24-bookworm-slim AS admin-builder
WORKDIR /app
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --fetch-retries=2 --fetch-timeout=30000
COPY apps/admin/ ./
RUN npm run build

FROM caddy:2
COPY infra/aliyun/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
COPY --from=admin-builder /app/dist /srv/admin
EXPOSE 80 443
