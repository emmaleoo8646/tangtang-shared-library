FROM node:24-bookworm-slim
WORKDIR /app
RUN sed -i 's|http://deb.debian.org|http://mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --fetch-retries=2 --fetch-timeout=30000
COPY services/api/prisma ./prisma
RUN npx prisma generate
COPY services/api/tsconfig*.json services/api/nest-cli.json ./
COPY services/api/src ./src
COPY services/api/scripts ./scripts
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
