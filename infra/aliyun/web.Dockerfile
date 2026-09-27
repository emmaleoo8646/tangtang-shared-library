FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --fetch-retries=2 --fetch-timeout=30000
COPY apps/web/ ./
RUN npm run build

FROM caddy:2
COPY infra/aliyun/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
EXPOSE 80 443
